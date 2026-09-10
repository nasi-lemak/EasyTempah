import { Router } from 'express';
import { db } from '../db/connection';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { guestSubmitOrder, guestTableState, type AddLineInput } from '../services/orders';
import { printKitchenTickets } from '../services/printer';
import { getBusinessSettings, getTaxSettings } from '../services/settings';
import type { Category, Item, Modifier, ModifierGroup } from '../types';

/**
 * Public, unauthenticated endpoints for QR table ordering. Everything is
 * scoped by a per-table random token; rotating the token invalidates
 * printed codes. No prices or mutations are trusted from the client —
 * the same server-side validation as the staff POS applies.
 */
export const guestRouter = Router();

const TOKEN_RE = /^[a-f0-9]{16,64}$/;

function requireToken(raw: string): string {
  if (!TOKEN_RE.test(raw)) throw notFound('This ordering code is no longer valid');
  return raw;
}

guestRouter.get('/:token/menu', (req, res) => {
  const token = requireToken(req.params.token);
  const { table } = guestTableState(token); // validates the token
  const categories = db
    .prepare('SELECT id, name, sort FROM categories WHERE active = 1 ORDER BY sort, name')
    .all() as Category[];
  const items = db
    .prepare(
      `SELECT id, category_id, name, price_cents, station, track_stock, stock_qty, low_stock_threshold, sort, is_combo,
        (SELECT strftime('%s', updated_at) FROM item_images WHERE item_id = items.id) AS image_v
       FROM items WHERE active = 1 ORDER BY sort, name`,
    )
    .all() as Item[];
  const comboGroups = db.prepare('SELECT * FROM combo_groups ORDER BY sort, id').all();
  const comboItems = db.prepare('SELECT * FROM combo_group_items').all();
  const groups = db.prepare('SELECT * FROM modifier_groups').all() as ModifierGroup[];
  const modifiers = db
    .prepare('SELECT * FROM modifiers WHERE active = 1 ORDER BY sort, name')
    .all() as Modifier[];
  const links = db.prepare('SELECT * FROM item_modifier_groups').all();
  const business = getBusinessSettings();
  const tax = getTaxSettings();
  res.json({
    table: { name: table.name, zone: table.zone },
    business: { name: business.name, currencySymbol: business.currencySymbol, accentColor: business.accentColor },
    tax: { taxLabel: tax.taxLabel, serviceLabel: tax.serviceLabel },
    menu: { categories, items, groups, modifiers, links, comboGroups, comboItems },
  });
});

/** The table's current tab, so guests can see what has been ordered and the running total. */
guestRouter.get('/:token/order', (req, res) => {
  const token = requireToken(req.params.token);
  const { order } = guestTableState(token);
  if (!order) {
    res.json({ order: null });
    return;
  }
  // Strip staff-only detail; guests see their items and totals.
  res.json({
    order: {
      order_no: order.order_no,
      status: order.status,
      subtotal_cents: order.subtotal_cents,
      discount_cents: order.discount_cents,
      promo_name: order.promo_name,
      promo_cents: order.promo_cents,
      service_cents: order.service_cents,
      tax_cents: order.tax_cents,
      total_cents: order.total_cents,
      items: order.items
        .filter((i) => i.status !== 'cancelled' && !i.parent_line_id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          modifiers_json: i.modifiers_json,
          notes: i.notes,
          status: i.status,
          line_total_cents: i.line_total_cents,
          source: i.source,
        })),
    },
  });
});

/** Call a waiter to the table (water, help, or the bill). Rate-limited per table. */
guestRouter.post('/:token/call', (req, res) => {
  const token = requireToken(req.params.token);
  const { table } = guestTableState(token);
  const reason = (req.body as { reason?: string }).reason === 'bill' ? 'bill' : 'service';
  const recent = db
    .prepare(
      "SELECT 1 FROM service_calls WHERE table_id = ? AND created_at > datetime('now', '-30 seconds')",
    )
    .get(table.id);
  if (recent) {
    res.status(429).json({ error: 'Already called — someone is on the way' });
    return;
  }
  db.prepare('INSERT INTO service_calls (table_id, reason) VALUES (?, ?)').run(table.id, reason);
  publish('tables');
  res.status(201).json({ ok: true });
});

// Per-table flood guard on guest submissions. A whole table often scans and
// sends at the same moment, so this is a burst allowance, not a cooldown:
// up to 8 submissions in any 2-minute window sail through (covers everyone
// at a big table ordering at once, plus a second round), while someone
// hammering a photographed QR code is stopped and has to wait the window
// out. In-memory is fine — a restart resetting the window is harmless.
const ORDER_WINDOW_MS = 2 * 60_000;
const ORDER_BURST = 8;
const orderTimes = new Map<number, number[]>();

guestRouter.post('/:token/order', (req, res) => {
  const token = requireToken(req.params.token);
  const lines = (req.body as { lines?: AddLineInput[] }).lines;
  if (!Array.isArray(lines)) throw badRequest('lines[] required');
  const { table } = guestTableState(token);
  const now = Date.now();
  const recent = (orderTimes.get(table.id) ?? []).filter((t) => now - t < ORDER_WINDOW_MS);
  if (recent.length >= ORDER_BURST) {
    res.status(429).json({ error: 'Lots of orders just went in for this table — please wait a minute, or ask a member of staff' });
    return;
  }
  const { orderId, lineIds } = guestSubmitOrder(token, lines);
  recent.push(now);
  orderTimes.set(table.id, recent);
  publish('kds');
  publish('orders');
  publish('tables');
  publish('inventory');
  void printKitchenTickets(orderId, lineIds); // fire-and-forget; logs on failure
  res.status(201).json({ ok: true, order_id: orderId });
});

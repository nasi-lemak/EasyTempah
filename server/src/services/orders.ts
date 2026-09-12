import { db } from '../db/connection';
import { badRequest, conflict, notFound } from '../middleware/errors';
import type {
  Customer,
  Item,
  Modifier,
  ModifierGroup,
  Order,
  OrderItem,
  OrderItemModifierSnapshot,
  OrderType,
  Payment,
  PaymentMethod,
  Refund,
} from '../types';
import { audit } from './audit';
import { cashRoundingAdjustment, computeTotals } from './orderMath';
import { bestPromo } from './promotions';
import {
  getLoyaltySettings,
  stationKeys,
  getPlatformsSettings,
  getReceiptsSettings,
  getSetting,
  getTaxSettings,
  setSetting,
} from './settings';

export interface OrderWithLines extends Order {
  items: OrderItem[];
  payments: Payment[];
  refunds: (Refund & { user_name: string | null; approved_by_name: string | null })[];
  table_name: string | null;
  opened_by_name: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  customer_points: number | null;
}

export function getOrder(id: number): OrderWithLines {
  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, u.name AS opened_by_name,
        c.phone AS customer_phone, c.name AS customer_name, c.points AS customer_points
       FROM orders o
       LEFT JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u ON u.id = o.opened_by
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
    )
    .get(id) as OrderWithLines | undefined;
  if (!order) throw notFound('Order not found');
  order.items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(id) as OrderItem[];
  order.payments = db
    .prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id')
    .all(id) as Payment[];
  order.refunds = db
    .prepare(
      `SELECT r.*, u.name AS user_name, a.name AS approved_by_name
       FROM refunds r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN users a ON a.id = r.approved_by
       WHERE r.order_id = ? ORDER BY r.id`,
    )
    .all(id) as OrderWithLines['refunds'];
  return order;
}

function requireOpenOrder(id: number): Order {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | undefined;
  if (!order) throw notFound('Order not found');
  if (order.status !== 'open') throw conflict(`Order is ${order.status}`);
  return order;
}

/** Recompute and persist order totals from its non-cancelled lines. Call inside a transaction. */
function recomputeTotals(orderId: number): void {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order;
  const lines = db
    .prepare(
      `SELECT oi.*, i.category_id FROM order_items oi
       LEFT JOIN items i ON i.id = oi.item_id
       WHERE oi.order_id = ? AND oi.status != 'cancelled'`,
    )
    .all(orderId) as (OrderItem & { category_id: number | null })[];
  // Set-meal children are zero-priced carriers; only parent lines count for promos.
  const promo = order.platform
    ? { id: null, name: null, cents: 0 }
    : bestPromo(
        lines
          .filter((l) => !l.parent_line_id)
          .map((l) => ({ line_total_cents: l.line_total_cents, item_id: l.item_id, category_id: l.category_id })),
        order.type,
      );
  const totals = computeTotals({
    lines: lines.map((l) => ({
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      modifiers: JSON.parse(l.modifiers_json) as OrderItemModifierSnapshot[],
    })),
    discountType: order.discount_type,
    discountValue: order.discount_value,
    promoCents: promo.cents,
    orderType: order.type,
    tax: getTaxSettings(),
  });
  const total = totals.total_cents + order.rounding_cents;
  db.prepare(
    `UPDATE orders SET subtotal_cents = ?, discount_cents = ?, promo_id = ?, promo_name = ?,
     promo_cents = ?, service_cents = ?, tax_cents = ?, total_cents = ? WHERE id = ?`,
  ).run(
    totals.subtotal_cents, totals.discount_cents,
    totals.promo_cents > 0 ? promo.id : null, totals.promo_cents > 0 ? promo.name : null,
    totals.promo_cents, totals.service_cents, totals.tax_cents, total, orderId,
  );
}

function nextOrderNo(): string {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE order_no LIKE ?")
    .get(`${ymd}-%`) as { n: number };
  return `${ymd}-${String(row.n + 1).padStart(4, '0')}`;
}

function currentShiftId(): number | null {
  const row = db.prepare("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

export const createOrder = db.transaction(
  (
    input: {
      type: OrderType;
      table_id?: number | null;
      covers?: number;
      notes?: string | null;
      platform?: string | null;
      platform_ref?: string | null;
    },
    userId: number,
  ): number => {
    if (input.type === 'dine_in') {
      if (!input.table_id) throw badRequest('Dine-in orders require a table');
      const open = db
        .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open'")
        .get(input.table_id) as { id: number } | undefined;
      if (open) throw conflict('Table already has an open order');
    }
    let platform: string | null = null;
    if (input.platform) {
      if (input.type !== 'delivery') throw badRequest('Only delivery orders belong to a platform');
      const known = getPlatformsSettings().platforms.find(
        (p) => p.key === input.platform && p.enabled,
      );
      if (!known) throw badRequest('Unknown or disabled delivery platform');
      platform = known.key;
    }
    const info = db
      .prepare(
        `INSERT INTO orders (order_no, type, table_id, covers, notes, shift_id, opened_by, platform, platform_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nextOrderNo(),
        input.type,
        input.type === 'dine_in' ? input.table_id : null,
        input.covers ?? 1,
        input.notes ?? null,
        currentShiftId(),
        userId,
        platform,
        platform ? (input.platform_ref?.trim() || null) : null,
      );
    return Number(info.lastInsertRowid);
  },
);

export interface AddLineInput {
  item_id?: number;
  qty: number;
  modifier_ids?: number[];
  /** For combo items: one chosen component per choice group. */
  combo_choices?: { group_id: number; item_id: number }[];
  /** Off-menu line (staff only): "special of the day, RM8". No stock/recipe ties. */
  custom?: { name: string; price_cents: number; station?: string };
  notes?: string | null;
}

interface InsertOpts {
  status: 'pending' | 'sent'; // 'sent' fires straight to the kitchen and deducts stock
  source: 'staff' | 'guest';
  userId: number | null;
}

/** Validate and insert order lines. Call inside a transaction; caller recomputes totals. */
function insertLines(orderId: number, lines: AddLineInput[], opts: InsertOpts): number[] {
  if (!lines.length) throw badRequest('No items to add');
  const insertedIds: number[] = [];

  const itemStmt = db.prepare('SELECT * FROM items WHERE id = ? AND active = 1');
  const modStmt = db.prepare(
    `SELECT m.*, g.name AS group_name, g.id AS group_id
     FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id
     WHERE m.id = ? AND m.active = 1`,
  );
  const allowedStmt = db.prepare(
    'SELECT 1 FROM item_modifier_groups WHERE item_id = ? AND group_id = ?',
  );

  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 999) {
      throw badRequest('Invalid quantity');
    }

    if (line.custom) {
      if (opts.source !== 'staff') throw badRequest('Open items are staff-only');
      const name = line.custom.name?.trim();
      const price = line.custom.price_cents;
      if (!name) throw badRequest('Open item needs a name');
      if (!Number.isInteger(price) || price < 0 || price > 1_000_000) {
        throw badRequest('Open item price must be 0 – 10,000.00');
      }
      const keys = stationKeys();
      const station = keys.includes(line.custom.station ?? '') ? (line.custom.station as string) : keys[0];
      const info = db.prepare(
        `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes,
           station, line_total_cents, source, status, sent_at)
         VALUES (?, NULL, ?, ?, ?, '[]', ?, ?, ?, 'staff', ?, ?)`,
      ).run(
        orderId, name, line.qty, price, line.notes ?? null, station, line.qty * price, opts.status,
        opts.status === 'sent' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      );
      insertedIds.push(Number(info.lastInsertRowid));
      audit(opts.userId, 'order.open_item', { orderId, name, price_cents: price, qty: line.qty });
      continue;
    }

    const item = itemStmt.get(line.item_id) as Item | undefined;
    if (!item) throw badRequest(`Item ${line.item_id} not found or inactive`);

    if (item.is_combo) {
      insertComboLine(orderId, item, line, opts);
      continue;
    }

    const snapshots: OrderItemModifierSnapshot[] = [];
    for (const modId of line.modifier_ids ?? []) {
      const mod = modStmt.get(modId) as (Modifier & { group_name: string }) | undefined;
      if (!mod) throw badRequest(`Modifier ${modId} not found`);
      if (!allowedStmt.get(item.id, mod.group_id)) {
        throw badRequest(`Modifier "${mod.name}" is not available for "${item.name}"`);
      }
      snapshots.push({
        modifier_id: mod.id,
        group_name: mod.group_name,
        name: mod.name,
        price_delta_cents: mod.price_delta_cents,
      });
    }

    if (opts.status === 'sent' && item.track_stock) {
      if (item.stock_qty < line.qty) {
        throw conflict(`Not enough stock for "${item.name}" (have ${item.stock_qty}, need ${line.qty})`);
      }
      db.prepare('UPDATE items SET stock_qty = stock_qty - ? WHERE id = ?').run(line.qty, item.id);
      db.prepare(
        'INSERT INTO stock_movements (item_id, delta, reason, ref, user_id) VALUES (?, ?, ?, ?, ?)',
      ).run(item.id, -line.qty, 'sale', `order:${orderId}`, opts.userId);
    }

    const modSum = snapshots.reduce((s, m) => s + m.price_delta_cents, 0);
    const info = db.prepare(
      `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes,
         station, line_total_cents, source, status, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orderId,
      item.id,
      item.name,
      line.qty,
      item.price_cents,
      JSON.stringify(snapshots),
      line.notes ?? null,
      item.station,
      line.qty * (item.price_cents + modSum),
      opts.source,
      opts.status,
      opts.status === 'sent' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
    );
    insertedIds.push(Number(info.lastInsertRowid));
    if (opts.status === 'sent') {
      applyLineIngredients(
        item.id,
        line.qty,
        snapshots.map((s) => s.modifier_id).filter((id) => id > 0),
        -1,
        `order:${orderId}`,
        opts.userId,
      );
    }
  }
  return insertedIds;
}

/**
 * A set meal inserts one parent line at the bundle price (component choices
 * stored as modifier-style snapshots so receipts and the cart render them),
 * plus zero-priced child lines per component for KDS station routing and
 * stock deduction.
 */
function insertComboLine(orderId: number, item: Item, line: AddLineInput, opts: InsertOpts): void {
  if (line.modifier_ids?.length) throw badRequest('Set meals do not take modifiers');
  const groups = db
    .prepare('SELECT * FROM combo_groups WHERE item_id = ? ORDER BY sort, id')
    .all(item.id) as { id: number; name: string }[];
  if (!groups.length) throw badRequest(`"${item.name}" has no set choices configured`);

  const chosen: { group: { id: number; name: string }; component: Item; surcharge: number }[] = [];
  for (const group of groups) {
    const pick = (line.combo_choices ?? []).find((c) => c.group_id === group.id);
    if (!pick) throw badRequest(`Choose an option for "${group.name}"`);
    const eligible = db
      .prepare('SELECT surcharge_cents FROM combo_group_items WHERE group_id = ? AND item_id = ?')
      .get(group.id, pick.item_id) as { surcharge_cents: number } | undefined;
    if (!eligible) throw badRequest(`That option is not available for "${group.name}"`);
    const component = db
      .prepare('SELECT * FROM items WHERE id = ? AND active = 1')
      .get(pick.item_id) as Item | undefined;
    if (!component) throw badRequest(`Component for "${group.name}" is unavailable`);
    chosen.push({ group, component, surcharge: eligible.surcharge_cents });
  }

  const unit = item.price_cents + chosen.reduce((s, c) => s + c.surcharge, 0);
  const snapshots: OrderItemModifierSnapshot[] = chosen.map((c) => ({
    modifier_id: 0,
    group_name: c.group.name,
    name: c.component.name,
    price_delta_cents: c.surcharge,
  }));
  const sentAt = opts.status === 'sent' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;

  const parentInfo = db
    .prepare(
      `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes,
         station, line_total_cents, source, status, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(orderId, item.id, item.name, line.qty, item.price_cents, JSON.stringify(snapshots),
      line.notes ?? null, item.station, line.qty * unit, opts.source, opts.status, sentAt);
  const parentId = Number(parentInfo.lastInsertRowid);

  for (const c of chosen) {
    if (opts.status === 'sent' && c.component.track_stock) {
      if (c.component.stock_qty < line.qty) {
        throw conflict(`Not enough stock for "${c.component.name}" (have ${c.component.stock_qty}, need ${line.qty})`);
      }
      db.prepare('UPDATE items SET stock_qty = stock_qty - ? WHERE id = ?').run(line.qty, c.component.id);
      db.prepare(
        'INSERT INTO stock_movements (item_id, delta, reason, ref, user_id) VALUES (?, ?, ?, ?, ?)',
      ).run(c.component.id, -line.qty, 'sale', `order:${orderId}`, opts.userId);
    }
    db.prepare(
      `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes,
         station, line_total_cents, source, status, sent_at, parent_line_id)
       VALUES (?, ?, ?, ?, 0, '[]', ?, ?, 0, ?, ?, ?, ?)`,
    ).run(orderId, c.component.id, c.component.name, line.qty, line.notes ?? null,
      c.component.station, opts.source, opts.status, sentAt, parentId);
    if (opts.status === 'sent') {
      applyLineIngredients(c.component.id, line.qty, [], -1, `order:${orderId}`, opts.userId);
    }
  }
  if (opts.status === 'sent') {
    applyLineIngredients(item.id, line.qty, [], -1, `order:${orderId}`, opts.userId);
  }
}

export const addItems = db.transaction((orderId: number, lines: AddLineInput[]): void => {
  requireOpenOrder(orderId);
  insertLines(orderId, lines, { status: 'pending', source: 'staff', userId: null });
  recomputeTotals(orderId);
});

/** Look up (or lazily create) the system user that owns QR guest orders. */
function getGuestUserId(): number {
  const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('guest_user') as
    | { value: string }
    | undefined;
  if (stored) {
    const id = (JSON.parse(stored.value) as { id: number }).id;
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return id;
  }
  const info = db
    .prepare('INSERT INTO users (name, role, pin_hash, active) VALUES (?, ?, ?, 0)')
    .run('QR Guest', 'kitchen', 'disabled');
  const id = Number(info.lastInsertRowid);
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('guest_user', JSON.stringify({ id }));
  return id;
}

const MAX_GUEST_LINES = 20;
const MAX_GUEST_QTY = 20;

/**
 * A guest at a table (identified by its QR token) submits items. They land on
 * the table's open tab — created if needed — already fired to the kitchen.
 */
export const guestSubmitOrder = db.transaction(
  (token: string, lines: AddLineInput[]): { orderId: number; lineIds: number[] } => {
  const table = db
    .prepare('SELECT * FROM dining_tables WHERE qr_token = ? AND active = 1')
    .get(token) as { id: number } | undefined;
  if (!table) throw notFound('This ordering code is no longer valid');
  if (!Array.isArray(lines) || lines.length === 0) throw badRequest('No items to order');
  if (lines.length > MAX_GUEST_LINES) throw badRequest(`At most ${MAX_GUEST_LINES} lines per submission`);
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_GUEST_QTY) throw badRequest('Invalid quantity');
    if (typeof l.notes === 'string' && l.notes.length > 200) throw badRequest('Note too long');
  }

  const guestId = getGuestUserId();
  let order = db
    .prepare("SELECT * FROM orders WHERE table_id = ? AND status = 'open' ORDER BY id LIMIT 1")
    .get(table.id) as Order | undefined;
  if (!order) {
    const id = createOrder({ type: 'dine_in', table_id: table.id, covers: 1 }, guestId);
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order;
  }

    const lineIds = insertLines(order.id, lines, { status: 'sent', source: 'guest', userId: guestId });
    recomputeTotals(order.id);
    return { orderId: order.id, lineIds };
  },
);

/** The table (and its open order, if any) behind a QR token — for the guest view. */
export function guestTableState(token: string): {
  table: { id: number; name: string; zone: string };
  order: OrderWithLines | null;
} {
  const table = db
    .prepare('SELECT id, name, zone FROM dining_tables WHERE qr_token = ? AND active = 1')
    .get(token) as { id: number; name: string; zone: string } | undefined;
  if (!table) throw notFound('This ordering code is no longer valid');
  // After a bill split, several open orders can share the table; guests see
  // (and add to) the original bill.
  const open = db
    .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open' ORDER BY id LIMIT 1")
    .get(table.id) as { id: number } | undefined;
  return { table, order: open ? getOrder(open.id) : null };
}

export const updateLine = db.transaction(
  (
    orderId: number,
    lineId: number,
    patch: { qty?: number; notes?: string | null; unit_price_cents?: number },
    userId: number,
  ): void => {
    requireOpenOrder(orderId);
    const line = db
      .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
      .get(lineId, orderId) as OrderItem | undefined;
    if (!line) throw notFound('Order line not found');
    if (line.parent_line_id) throw conflict('This line is part of a set — edit the set instead');
    if (line.status !== 'pending') throw conflict('Only pending lines can be edited; cancel instead');

    const mods = JSON.parse(line.modifiers_json) as OrderItemModifierSnapshot[];
    const modSum = mods.reduce((s, m) => s + m.price_delta_cents, 0);

    // Manager price override / per-item discount: the route gates this by role.
    if (patch.unit_price_cents !== undefined) {
      if (!Number.isInteger(patch.unit_price_cents) || patch.unit_price_cents < 0) {
        throw badRequest('Invalid price');
      }
      db.prepare('UPDATE order_items SET unit_price_cents = ? WHERE id = ?').run(
        patch.unit_price_cents,
        lineId,
      );
      line.unit_price_cents = patch.unit_price_cents;
      audit(userId, 'order_line.price_override', {
        orderId,
        lineId,
        name: line.name,
        newPrice: patch.unit_price_cents,
      });
    }
    if (patch.qty !== undefined) {
      if (!Number.isInteger(patch.qty) || patch.qty < 1 || patch.qty > 999) throw badRequest('Invalid quantity');
      db.prepare('UPDATE order_items SET qty = ? WHERE id = ?').run(patch.qty, lineId);
      line.qty = patch.qty;
    }
    db.prepare('UPDATE order_items SET line_total_cents = ? WHERE id = ?').run(
      line.qty * (line.unit_price_cents + modSum),
      lineId,
    );
    // Set-meal components track their parent's quantity.
    db.prepare('UPDATE order_items SET qty = ? WHERE parent_line_id = ?').run(line.qty, lineId);
    if (patch.notes !== undefined) {
      db.prepare('UPDATE order_items SET notes = ? WHERE id = ?').run(patch.notes, lineId);
    }
    recomputeTotals(orderId);
    audit(userId, 'order_line.update', { orderId, lineId, patch });
  },
);

export const cancelLine = db.transaction((orderId: number, lineId: number, userId: number): void => {
  requireOpenOrder(orderId);
  const line = db
    .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
    .get(lineId, orderId) as OrderItem | undefined;
  if (!line) throw notFound('Order line not found');
  if (line.parent_line_id) throw conflict('This line is part of a set — cancel the whole set');
  if (line.status === 'cancelled') return;
  const wasSent = line.status !== 'pending';
  db.prepare("UPDATE order_items SET status = 'cancelled' WHERE id = ?").run(lineId);
  if (wasSent && line.item_id) {
    restock(line.item_id, line.qty, 'line_cancelled', `order:${orderId}`, userId);
    applyLineIngredients(line.item_id, line.qty, modifierIdsFromSnapshot(line.modifiers_json), 1, `order:${orderId}`, userId);
  }
  // Cascade to set-meal components, restocking each fired component.
  const children = db
    .prepare("SELECT * FROM order_items WHERE parent_line_id = ? AND status != 'cancelled'")
    .all(lineId) as OrderItem[];
  for (const child of children) {
    db.prepare("UPDATE order_items SET status = 'cancelled' WHERE id = ?").run(child.id);
    if (child.status !== 'pending' && child.item_id) {
      restock(child.item_id, child.qty, 'line_cancelled', `order:${orderId}`, userId);
      applyLineIngredients(child.item_id, child.qty, [], 1, `order:${orderId}`, userId);
    }
  }
  recomputeTotals(orderId);
  audit(userId, 'order_line.cancel', { orderId, lineId, name: line.name, qty: line.qty, wasSent });
});

/**
 * Consume (sign −1) or return (sign +1) the ingredients behind one fired line:
 * the item's recipe plus the recipes of its chosen modifiers. Ingredient stock
 * is informational — it may go negative (the kitchen doesn't stop cooking
 * because the system says zero rice); low/negative levels surface in the
 * back office. Item-level stock remains the hard sell-out enforcement.
 */
function applyLineIngredients(
  itemId: number | null,
  qty: number,
  modifierIds: number[],
  sign: 1 | -1,
  ref: string,
  userId: number | null,
): void {
  const uses: { ingredient_id: number; qty: number }[] = [];
  if (itemId) {
    uses.push(
      ...(db
        .prepare('SELECT ingredient_id, qty FROM recipe_lines WHERE item_id = ?')
        .all(itemId) as { ingredient_id: number; qty: number }[]),
    );
  }
  for (const modId of modifierIds) {
    uses.push(
      ...(db
        .prepare('SELECT ingredient_id, qty FROM modifier_recipe_lines WHERE modifier_id = ?')
        .all(modId) as { ingredient_id: number; qty: number }[]),
    );
  }
  const update = db.prepare('UPDATE ingredients SET stock_qty = stock_qty + ? WHERE id = ?');
  const log = db.prepare(
    'INSERT INTO ingredient_movements (ingredient_id, delta, reason, ref, user_id) VALUES (?, ?, ?, ?, ?)',
  );
  for (const use of uses) {
    const delta = sign * use.qty * qty;
    update.run(delta, use.ingredient_id);
    log.run(use.ingredient_id, delta, sign < 0 ? 'sale' : 'returned', ref, userId);
  }
}

function modifierIdsFromSnapshot(modifiersJson: string): number[] {
  return (JSON.parse(modifiersJson) as OrderItemModifierSnapshot[])
    .map((m) => m.modifier_id)
    .filter((id) => id > 0); // combo-choice snapshots use id 0
}

function restock(itemId: number, qty: number, reason: string, ref: string, userId: number | null): void {
  const item = db.prepare('SELECT track_stock FROM items WHERE id = ?').get(itemId) as
    | { track_stock: number }
    | undefined;
  if (!item?.track_stock) return;
  db.prepare('UPDATE items SET stock_qty = stock_qty + ? WHERE id = ?').run(qty, itemId);
  db.prepare(
    'INSERT INTO stock_movements (item_id, delta, reason, ref, user_id) VALUES (?, ?, ?, ?, ?)',
  ).run(itemId, qty, reason, ref, userId);
}

/** Fire all pending lines to the kitchen, deducting tracked stock. Returns the fired line ids. */
export const sendToKitchen = db.transaction((orderId: number, userId: number): number[] => {
  requireOpenOrder(orderId);
  const pending = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status = 'pending'")
    .all(orderId) as OrderItem[];
  if (!pending.length) return [];

  for (const line of pending) {
    if (!line.item_id) continue;
    applyLineIngredients(
      line.item_id,
      line.qty,
      modifierIdsFromSnapshot(line.modifiers_json),
      -1,
      `order:${orderId}`,
      userId,
    );
    const item = db
      .prepare('SELECT track_stock, stock_qty, name FROM items WHERE id = ?')
      .get(line.item_id) as { track_stock: number; stock_qty: number; name: string };
    if (item.track_stock) {
      if (item.stock_qty < line.qty) {
        throw conflict(`Not enough stock for "${item.name}" (have ${item.stock_qty}, need ${line.qty})`);
      }
      db.prepare('UPDATE items SET stock_qty = stock_qty - ? WHERE id = ?').run(line.qty, line.item_id);
      db.prepare(
        'INSERT INTO stock_movements (item_id, delta, reason, ref, user_id) VALUES (?, ?, ?, ?, ?)',
      ).run(line.item_id, -line.qty, 'sale', `order:${orderId}`, userId);
    }
  }
  db.prepare(
    `UPDATE order_items SET status = 'sent', sent_at = datetime('now')
     WHERE order_id = ? AND status = 'pending'`,
  ).run(orderId);
  return pending.map((l) => l.id);
});

export const setDiscount = db.transaction(
  (
    orderId: number,
    discount: { type: 'percent' | 'fixed' | null; value: number },
    userId: number,
  ): void => {
    requireOpenOrder(orderId);
    if (discount.type === 'percent' && (discount.value < 0 || discount.value > 100)) {
      throw badRequest('Percent discount must be 0-100');
    }
    if (discount.type === 'fixed' && discount.value < 0) throw badRequest('Invalid discount');
    db.prepare('UPDATE orders SET discount_type = ?, discount_value = ? WHERE id = ?').run(
      discount.type,
      discount.type ? discount.value : 0,
      orderId,
    );
    recomputeTotals(orderId);
    audit(userId, 'order.discount', { orderId, discount });
  },
);

export interface PayInput {
  method: PaymentMethod;
  channel?: string | null; // specific channel label, e.g. "GrabPay"; kind stays in `method`
  amount_cents: number;
  tendered_cents?: number;
  reference?: string | null;
}

export const addPayment = db.transaction(
  (orderId: number, input: PayInput, userId: number): { change_cents: number; paid: boolean } => {
    const order = requireOpenOrder(orderId);
    const hasPending = db
      .prepare("SELECT 1 FROM order_items WHERE order_id = ? AND status = 'pending' LIMIT 1")
      .get(orderId);
    if (hasPending) throw conflict('Order has unsent items — send or cancel them before payment');
    if (order.subtotal_cents <= 0) throw conflict('Order has no items');
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw badRequest('Invalid payment amount');
    }

    let balance = order.total_cents - order.paid_cents;

    // Cash rounding applies once, when cash settles the (rounded) remaining balance.
    if (input.method === 'cash') {
      const tax = getTaxSettings();
      const adj = cashRoundingAdjustment(balance, tax.cashRoundingCents);
      if (adj !== 0 && input.amount_cents >= balance + adj) {
        db.prepare(
          'UPDATE orders SET rounding_cents = rounding_cents + ?, total_cents = total_cents + ? WHERE id = ?',
        ).run(adj, adj, orderId);
        balance += adj;
      }
    }

    const amount = Math.min(input.amount_cents, balance);
    if (amount <= 0) throw conflict('Order is already fully paid');

    let change = 0;
    let tendered: number | null = null;
    if (input.method === 'cash') {
      tendered = input.tendered_cents ?? input.amount_cents;
      if (tendered < amount) throw badRequest('Tendered amount is less than the payment');
      change = tendered - amount;
    }

    db.prepare(
      `INSERT INTO payments (order_id, method, channel, amount_cents, tendered_cents, change_cents, reference, user_id, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, input.method, input.channel ?? null, amount, tendered,
      input.method === 'cash' ? change : null, input.reference ?? null, userId, currentShiftId());

    db.prepare('UPDATE orders SET paid_cents = paid_cents + ? WHERE id = ?').run(amount, orderId);

    const updated = db.prepare('SELECT total_cents, paid_cents, table_id FROM orders WHERE id = ?').get(orderId) as {
      total_cents: number;
      paid_cents: number;
      table_id: number | null;
    };
    const fullyPaid = updated.paid_cents >= updated.total_cents;
    if (fullyPaid) {
      db.prepare(
        `UPDATE orders SET status = 'paid', closed_at = datetime('now') WHERE id = ?`,
      ).run(orderId);
      // Dine-in settles after the meal, so payment tidies every line to
      // served. Counter orders (takeaway/delivery) are often PAID FIRST —
      // their lines keep cooking on the KDS and the collection board until
      // the pass taps Serve at handover.
      if (order.type === 'dine_in') {
        db.prepare(
          `UPDATE order_items SET status = 'served' WHERE order_id = ? AND status NOT IN ('cancelled','served')`,
        ).run(orderId);
      }
      assignReceiptSerial(orderId);
      earnLoyaltyPoints(orderId, userId);
    }
    return { change_cents: change, paid: fullyPaid };
  },
);

/**
 * On settlement: stamp the next sequential receipt/invoice serial (e.g. INV-000123).
 * Runs inside the payment transaction, so the settings-backed counter is race-free.
 * Reprints reuse the stored serial; voids never consume one.
 */
function assignReceiptSerial(orderId: number): void {
  const cfg = getReceiptsSettings();
  if (!cfg.serialEnabled) return;
  const already = db.prepare('SELECT receipt_no FROM orders WHERE id = ?').get(orderId) as {
    receipt_no: string | null;
  };
  if (already.receipt_no) return;
  const counter = getSetting<{ next: number }>('receipt_seq', { next: 1 });
  const serial = `${cfg.serialPrefix}${String(counter.next).padStart(6, '0')}`;
  setSetting('receipt_seq', { next: counter.next + 1 });
  db.prepare('UPDATE orders SET receipt_no = ? WHERE id = ?').run(serial, orderId);
}

/** On full settlement: credit the attached member's points on net spend (excluding points tender). */
function earnLoyaltyPoints(orderId: number, userId: number): void {
  const loyalty = getLoyaltySettings();
  if (!loyalty.enabled) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order;
  if (!order.customer_id) return;
  const redeemedValue = Math.round(
    (order.points_redeemed * 100) / Math.max(1, loyalty.redeemPointsPerRm),
  );
  const earnBase = Math.max(0, order.total_cents - redeemedValue);
  const points = Math.floor((earnBase / 100) * loyalty.earnPointsPerRm);
  db.prepare(
    `UPDATE customers SET points = points + ?, visits = visits + 1,
       total_spent_cents = total_spent_cents + ?, last_visit_at = datetime('now')
     WHERE id = ?`,
  ).run(points, order.total_cents, order.customer_id);
  db.prepare('UPDATE orders SET points_earned = ? WHERE id = ?').run(points, orderId);
  if (points > 0) {
    db.prepare(
      "INSERT INTO point_movements (customer_id, delta, reason, order_id, user_id) VALUES (?, ?, 'earn', ?, ?)",
    ).run(order.customer_id, points, orderId, userId);
  }
}

/**
 * Attach a member to an open order — by id (till lookup found them), or by
 * phone. Creating a NEW member requires PDPA consent: the cashier confirms the
 * customer agreed to the privacy notice, and the moment is stored.
 */
export const attachCustomer = db.transaction(
  (
    orderId: number,
    phone: string,
    name: string | undefined,
    userId: number,
    opts: { customerId?: number; consent?: boolean } = {},
  ): Customer => {
    if (!getLoyaltySettings().enabled) throw conflict('Loyalty is not enabled in Settings');
    const order = requireOpenOrder(orderId);
    if (order.platform) throw conflict('Platform orders do not earn loyalty points');
    let customer: Customer | undefined;
    if (opts.customerId != null) {
      customer = db
        .prepare("SELECT * FROM customers WHERE id = ? AND phone NOT LIKE 'deleted-%'")
        .get(opts.customerId) as Customer | undefined;
      if (!customer) throw notFound('Member not found');
    } else {
      const clean = phone.replace(/[^\d+]/g, '');
      if (!/^\+?\d{8,15}$/.test(clean)) throw badRequest('Phone number looks invalid');
      customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(clean) as
        | Customer
        | undefined;
      if (!customer) {
        if (!opts.consent) {
          throw badRequest('Customer must agree to the privacy notice before joining');
        }
        const info = db
          .prepare("INSERT INTO customers (phone, name, consent_at) VALUES (?, ?, datetime('now'))")
          .run(clean, name?.trim() || null);
        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid) as Customer;
        audit(userId, 'customer.create', { phone: clean, consent: true });
      }
    }
    if (name?.trim() && !customer.name) {
      db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name.trim(), customer.id);
      customer.name = name.trim();
    }
    db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customer.id, orderId);
    return customer;
  },
);

/**
 * Redeem points as tender: converts points to RM value and records it as a
 * payment (kind other, channel "Points") — drawer math untouched, split and
 * settlement logic identical to any other payment.
 */
export const redeemPoints = db.transaction(
  (orderId: number, points: number, userId: number): { value_cents: number; paid: boolean } => {
    const loyalty = getLoyaltySettings();
    if (!loyalty.enabled) throw conflict('Loyalty is not enabled');
    const order = requireOpenOrder(orderId);
    if (!order.customer_id) throw conflict('Attach a member to the order first');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer;
    if (!Number.isInteger(points) || points <= 0) throw badRequest('Invalid points');
    if (points < loyalty.minRedeemPoints) {
      throw badRequest(`Minimum redemption is ${loyalty.minRedeemPoints} points`);
    }
    if (points > customer.points) throw badRequest(`Member only has ${customer.points} points`);
    const value = Math.round((points * 100) / Math.max(1, loyalty.redeemPointsPerRm));
    const balance = order.total_cents - order.paid_cents;
    if (value > balance) throw badRequest('Redemption exceeds the remaining balance');

    db.prepare('UPDATE customers SET points = points - ? WHERE id = ?').run(points, customer.id);
    db.prepare(
      "INSERT INTO point_movements (customer_id, delta, reason, order_id, user_id) VALUES (?, ?, 'redeem', ?, ?)",
    ).run(customer.id, -points, orderId, userId);
    db.prepare('UPDATE orders SET points_redeemed = points_redeemed + ? WHERE id = ?').run(points, orderId);
    audit(userId, 'loyalty.redeem', { orderId, customerId: customer.id, points, value });

    const result = addPayment(
      orderId,
      { method: 'other', channel: 'Points', amount_cents: value, reference: `points:${points}` },
      userId,
    );
    return { value_cents: value, paid: result.paid };
  },
);

export interface RefundInput {
  method: PaymentMethod;
  amount_cents: number;
  reason: string;
}

/** Refund part or all of a PAID order's takings. approvedBy must already be verified as manager+. Returns the refund id. */
export const addRefund = db.transaction(
  (orderId: number, input: RefundInput, userId: number, approvedBy: number): number => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order | undefined;
    if (!order) throw notFound('Order not found');
    if (order.status !== 'paid') throw conflict('Only paid orders can be refunded');
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw badRequest('Invalid refund amount');
    }
    const refundable = order.paid_cents - order.refunded_cents;
    if (input.amount_cents > refundable) {
      throw badRequest(`Refund exceeds the refundable balance (${refundable} sen left)`);
    }
    if (!input.reason.trim()) throw badRequest('Refund reason required');
    const info = db.prepare(
      `INSERT INTO refunds (order_id, method, amount_cents, reason, user_id, approved_by, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, input.method, input.amount_cents, input.reason.trim(), userId, approvedBy, currentShiftId());
    db.prepare('UPDATE orders SET refunded_cents = refunded_cents + ? WHERE id = ?').run(
      input.amount_cents,
      orderId,
    );
    audit(userId, 'order.refund', {
      orderId,
      method: input.method,
      amount: input.amount_cents,
      reason: input.reason.trim(),
      approvedBy,
    });
    return Number(info.lastInsertRowid);
  },
);

export const voidOrder = db.transaction((orderId: number, reason: string, userId: number): void => {
  const order = requireOpenOrder(orderId);
  if (order.paid_cents > 0) throw conflict('Order has payments — use a refund instead of voiding');
  const sentLines = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('pending','cancelled')")
    .all(orderId) as OrderItem[];
  for (const line of sentLines) {
    if (line.item_id) {
      restock(line.item_id, line.qty, 'order_void', `order:${orderId}`, userId);
      applyLineIngredients(line.item_id, line.qty, modifierIdsFromSnapshot(line.modifiers_json), 1, `order:${orderId}`, userId);
    }
  }
  db.prepare(
    `UPDATE orders SET status = 'void', void_reason = ?, closed_at = datetime('now') WHERE id = ?`,
  ).run(reason, orderId);
  db.prepare(
    `UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status != 'cancelled'`,
  ).run(orderId);
  audit(userId, 'order.void', { orderId, reason });
});

export interface SplitPick {
  line_id: number;
  qty: number;
}

/**
 * Split a bill by items: move the picked lines (whole or partial quantities)
 * onto a new sibling order on the same table, so each party pays separately.
 * The table stays occupied until every sibling is settled.
 */
export const splitOrder = db.transaction((orderId: number, picks: SplitPick[], userId: number): number => {
  const order = requireOpenOrder(orderId);
  if (order.paid_cents > 0) throw conflict('Cannot split after partial payment — settle or refund first');
  if (!Array.isArray(picks) || picks.length === 0) throw badRequest('Choose items to split off');

  const allActive = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
    .all(orderId) as OrderItem[];
  const childrenOf = new Map<number, OrderItem[]>();
  for (const l of allActive) {
    if (l.parent_line_id) {
      if (!childrenOf.has(l.parent_line_id)) childrenOf.set(l.parent_line_id, []);
      childrenOf.get(l.parent_line_id)!.push(l);
    }
  }
  // Splits are picked from top-level lines; set components travel with their set.
  const active = allActive.filter((l) => !l.parent_line_id);
  const byId = new Map(active.map((l) => [l.id, l]));
  const totalUnits = active.reduce((s, l) => s + l.qty, 0);
  let movedUnits = 0;
  const seen = new Set<number>();
  for (const p of picks) {
    const line = byId.get(p.line_id);
    if (!line) throw badRequest('Line not found on this order');
    if (seen.has(p.line_id)) throw badRequest('Duplicate line in split');
    seen.add(p.line_id);
    if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > line.qty) throw badRequest('Invalid split quantity');
    movedUnits += p.qty;
  }
  if (movedUnits >= totalUnits) throw badRequest('Cannot move every item — just pay the whole bill');

  const info = db
    .prepare(
      `INSERT INTO orders (order_no, type, table_id, covers, notes, shift_id, opened_by, platform, platform_ref)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      nextOrderNo(),
      order.type,
      order.table_id,
      order.notes,
      currentShiftId(),
      userId,
      order.platform,
      order.platform_ref,
    );
  const newId = Number(info.lastInsertRowid);

  const cloneLine = (line: OrderItem, qty: number, perUnit: number, parentLineId: number | null): number => {
    const info = db
      .prepare(
        `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes,
           status, station, line_total_cents, source, sent_at, created_at, parent_line_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        line.item_id,
        line.name,
        qty,
        line.unit_price_cents,
        line.modifiers_json,
        line.notes,
        line.status,
        line.station,
        qty * perUnit,
        line.source,
        line.sent_at,
        line.created_at,
        parentLineId,
      );
    return Number(info.lastInsertRowid);
  };

  for (const p of picks) {
    const line = byId.get(p.line_id)!;
    const children = childrenOf.get(line.id) ?? [];
    if (p.qty === line.qty) {
      db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(newId, line.id);
      for (const child of children) {
        db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(newId, child.id);
      }
    } else {
      // Partial quantity: shrink the original row (and its set components),
      // clone the moved units — components go with their new parent.
      const mods = JSON.parse(line.modifiers_json) as OrderItemModifierSnapshot[];
      const perUnit = line.unit_price_cents + mods.reduce((s, m) => s + m.price_delta_cents, 0);
      db.prepare('UPDATE order_items SET qty = ?, line_total_cents = ? WHERE id = ?').run(
        line.qty - p.qty,
        (line.qty - p.qty) * perUnit,
        line.id,
      );
      const newParentId = cloneLine(line, p.qty, perUnit, null);
      for (const child of children) {
        db.prepare('UPDATE order_items SET qty = ? WHERE id = ?').run(line.qty - p.qty, child.id);
        cloneLine(child, p.qty, 0, newParentId);
      }
    }
  }
  recomputeTotals(orderId);
  recomputeTotals(newId);
  audit(userId, 'order.split', { orderId, newId, picks });
  return newId;
});

export const moveTable = db.transaction((orderId: number, tableId: number, userId: number): void => {
  const order = requireOpenOrder(orderId);
  if (order.type !== 'dine_in') throw badRequest('Only dine-in orders have tables');
  const clash = db
    .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open' AND id != ?")
    .get(tableId, orderId);
  if (clash) throw conflict('Target table already has an open order');
  db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(tableId, orderId);
  audit(userId, 'order.move_table', { orderId, tableId });
});

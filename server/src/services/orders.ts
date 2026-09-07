import { db } from '../db/connection';
import { badRequest, conflict, notFound } from '../middleware/errors';
import type {
  Item,
  Modifier,
  ModifierGroup,
  Order,
  OrderItem,
  OrderItemModifierSnapshot,
  OrderType,
  Payment,
  PaymentMethod,
} from '../types';
import { audit } from './audit';
import { cashRoundingAdjustment, computeTotals } from './orderMath';
import { getTaxSettings } from './settings';

export interface OrderWithLines extends Order {
  items: OrderItem[];
  payments: Payment[];
  table_name: string | null;
  opened_by_name: string | null;
}

export function getOrder(id: number): OrderWithLines {
  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, u.name AS opened_by_name
       FROM orders o
       LEFT JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u ON u.id = o.opened_by
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
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
    .all(orderId) as OrderItem[];
  const totals = computeTotals({
    lines: lines.map((l) => ({
      qty: l.qty,
      unit_price_cents: l.unit_price_cents,
      modifiers: JSON.parse(l.modifiers_json) as OrderItemModifierSnapshot[],
    })),
    discountType: order.discount_type,
    discountValue: order.discount_value,
    tax: getTaxSettings(),
  });
  const total = totals.total_cents + order.rounding_cents;
  db.prepare(
    `UPDATE orders SET subtotal_cents = ?, discount_cents = ?, service_cents = ?,
     tax_cents = ?, total_cents = ? WHERE id = ?`,
  ).run(totals.subtotal_cents, totals.discount_cents, totals.service_cents, totals.tax_cents, total, orderId);
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
  (input: { type: OrderType; table_id?: number | null; covers?: number; notes?: string | null }, userId: number): number => {
    if (input.type === 'dine_in') {
      if (!input.table_id) throw badRequest('Dine-in orders require a table');
      const open = db
        .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open'")
        .get(input.table_id) as { id: number } | undefined;
      if (open) throw conflict('Table already has an open order');
    }
    const info = db
      .prepare(
        `INSERT INTO orders (order_no, type, table_id, covers, notes, shift_id, opened_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nextOrderNo(),
        input.type,
        input.type === 'dine_in' ? input.table_id : null,
        input.covers ?? 1,
        input.notes ?? null,
        currentShiftId(),
        userId,
      );
    return Number(info.lastInsertRowid);
  },
);

export interface AddLineInput {
  item_id: number;
  qty: number;
  modifier_ids?: number[];
  notes?: string | null;
}

export const addItems = db.transaction((orderId: number, lines: AddLineInput[]): void => {
  requireOpenOrder(orderId);
  if (!lines.length) throw badRequest('No items to add');

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
    const item = itemStmt.get(line.item_id) as Item | undefined;
    if (!item) throw badRequest(`Item ${line.item_id} not found or inactive`);

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

    const modSum = snapshots.reduce((s, m) => s + m.price_delta_cents, 0);
    db.prepare(
      `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json, notes, station, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  }
  recomputeTotals(orderId);
});

export const updateLine = db.transaction(
  (orderId: number, lineId: number, patch: { qty?: number; notes?: string | null }, userId: number): void => {
    requireOpenOrder(orderId);
    const line = db
      .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
      .get(lineId, orderId) as OrderItem | undefined;
    if (!line) throw notFound('Order line not found');
    if (line.status !== 'pending') throw conflict('Only pending lines can be edited; cancel instead');
    if (patch.qty !== undefined) {
      if (!Number.isInteger(patch.qty) || patch.qty < 1 || patch.qty > 999) throw badRequest('Invalid quantity');
      const mods = JSON.parse(line.modifiers_json) as OrderItemModifierSnapshot[];
      const modSum = mods.reduce((s, m) => s + m.price_delta_cents, 0);
      db.prepare('UPDATE order_items SET qty = ?, line_total_cents = ? WHERE id = ?').run(
        patch.qty,
        patch.qty * (line.unit_price_cents + modSum),
        lineId,
      );
    }
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
  if (line.status === 'cancelled') return;
  const wasSent = line.status !== 'pending';
  db.prepare("UPDATE order_items SET status = 'cancelled' WHERE id = ?").run(lineId);
  if (wasSent && line.item_id) restock(line.item_id, line.qty, 'line_cancelled', `order:${orderId}`, userId);
  recomputeTotals(orderId);
  audit(userId, 'order_line.cancel', { orderId, lineId, name: line.name, qty: line.qty, wasSent });
});

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

/** Fire all pending lines to the kitchen, deducting tracked stock. */
export const sendToKitchen = db.transaction((orderId: number, userId: number): number => {
  requireOpenOrder(orderId);
  const pending = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status = 'pending'")
    .all(orderId) as OrderItem[];
  if (!pending.length) return 0;

  for (const line of pending) {
    if (!line.item_id) continue;
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
  return pending.length;
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
      `INSERT INTO payments (order_id, method, amount_cents, tendered_cents, change_cents, reference, user_id, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, input.method, amount, tendered, input.method === 'cash' ? change : null,
      input.reference ?? null, userId, currentShiftId());

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
      db.prepare(
        `UPDATE order_items SET status = 'served' WHERE order_id = ? AND status NOT IN ('cancelled','served')`,
      ).run(orderId);
    }
    return { change_cents: change, paid: fullyPaid };
  },
);

export const voidOrder = db.transaction((orderId: number, reason: string, userId: number): void => {
  const order = requireOpenOrder(orderId);
  if (order.paid_cents > 0) throw conflict('Order has payments — refund is not supported, close the shift with a note');
  const sentLines = db
    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('pending','cancelled')")
    .all(orderId) as OrderItem[];
  for (const line of sentLines) {
    if (line.item_id) restock(line.item_id, line.qty, 'order_void', `order:${orderId}`, userId);
  }
  db.prepare(
    `UPDATE orders SET status = 'void', void_reason = ?, closed_at = datetime('now') WHERE id = ?`,
  ).run(reason, orderId);
  db.prepare(
    `UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status != 'cancelled'`,
  ).run(orderId);
  audit(userId, 'order.void', { orderId, reason });
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

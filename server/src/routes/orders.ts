import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { audit } from '../services/audit';
import {
  addItems,
  addPayment,
  cancelLine,
  createOrder,
  getOrder,
  moveTable,
  sendToKitchen,
  setDiscount,
  updateLine,
  voidOrder,
  type AddLineInput,
  type PayInput,
} from '../services/orders';
import { getBusinessSettings, getTaxSettings } from '../services/settings';
import type { OrderType } from '../types';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const ORDER_TYPES: OrderType[] = ['dine_in', 'takeaway', 'delivery'];

ordersRouter.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const date = typeof req.query.date === 'string' ? req.query.date : null; // YYYY-MM-DD (local server date)
  const limit = Math.min(200, Number(req.query.limit) || 100);

  const where: string[] = [];
  const params: unknown[] = [];
  if (status && ['open', 'paid', 'void'].includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    where.push("date(o.opened_at, 'localtime') = ?");
    params.push(date);
  }
  const rows = db
    .prepare(
      `SELECT o.*, t.name AS table_name, u.name AS opened_by_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'cancelled') AS item_count
       FROM orders o
       LEFT JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN users u ON u.id = o.opened_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  res.json({ orders: rows });
});

ordersRouter.post('/', (req: AuthedRequest, res) => {
  const b = req.body as { type?: OrderType; table_id?: number; covers?: number; notes?: string };
  if (!b.type || !ORDER_TYPES.includes(b.type)) throw badRequest('Invalid order type');
  const id = createOrder(
    { type: b.type, table_id: b.table_id ?? null, covers: b.covers, notes: b.notes ?? null },
    req.user!.id,
  );
  publish('orders');
  publish('tables');
  res.status(201).json({ order: getOrder(id) });
});

ordersRouter.get('/:id', (req, res) => {
  res.json({ order: getOrder(Number(req.params.id)) });
});

ordersRouter.post('/:id/items', (req: AuthedRequest, res) => {
  const lines = (req.body as { lines?: AddLineInput[] }).lines;
  if (!Array.isArray(lines)) throw badRequest('lines[] required');
  addItems(Number(req.params.id), lines);
  publish('orders');
  res.json({ order: getOrder(Number(req.params.id)) });
});

ordersRouter.patch('/:id/items/:lineId', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const b = req.body as { qty?: number; notes?: string | null; cancel?: boolean };
  if (b.cancel) {
    cancelLine(orderId, lineId, req.user!.id);
  } else {
    updateLine(orderId, lineId, { qty: b.qty, notes: b.notes }, req.user!.id);
  }
  publish('orders');
  publish('kds');
  res.json({ order: getOrder(orderId) });
});

ordersRouter.post('/:id/send', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const count = sendToKitchen(orderId, req.user!.id);
  if (count > 0) {
    publish('kds');
    publish('orders');
    publish('inventory');
  }
  res.json({ sent: count, order: getOrder(orderId) });
});

ordersRouter.patch('/:id', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const b = req.body as {
    discount?: { type: 'percent' | 'fixed' | null; value: number };
    notes?: string | null;
    covers?: number;
    table_id?: number;
  };
  if (b.discount !== undefined) {
    // Discounts above 20% need manager rights.
    const big =
      (b.discount.type === 'percent' && b.discount.value > 20) || b.discount.type === 'fixed';
    if (big && !['manager', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Manager approval required for this discount' });
      return;
    }
    setDiscount(orderId, b.discount, req.user!.id);
  }
  if (b.notes !== undefined) {
    db.prepare("UPDATE orders SET notes = ? WHERE id = ? AND status = 'open'").run(b.notes, orderId);
  }
  if (b.covers !== undefined) {
    db.prepare("UPDATE orders SET covers = ? WHERE id = ? AND status = 'open'").run(
      Math.max(1, b.covers),
      orderId,
    );
  }
  if (b.table_id !== undefined) {
    moveTable(orderId, b.table_id, req.user!.id);
    publish('tables');
  }
  publish('orders');
  res.json({ order: getOrder(orderId) });
});

ordersRouter.post('/:id/payments', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const b = req.body as PayInput;
  if (!['cash', 'card', 'ewallet', 'other'].includes(b.method)) throw badRequest('Invalid payment method');
  const result = addPayment(orderId, b, req.user!.id);
  audit(req.user!.id, 'order.payment', { orderId, method: b.method, amount: b.amount_cents });
  publish('orders');
  if (result.paid) publish('tables');
  res.json({ ...result, order: getOrder(orderId) });
});

ordersRouter.post('/:id/void', requireRole('manager'), (req: AuthedRequest, res) => {
  const reason = (req.body as { reason?: string }).reason?.trim();
  if (!reason) throw badRequest('Void reason required');
  const orderId = Number(req.params.id);
  voidOrder(orderId, reason, req.user!.id);
  publish('orders');
  publish('tables');
  publish('kds');
  publish('inventory');
  res.json({ order: getOrder(orderId) });
});

/** Receipt payload: order + business/tax settings, ready for the print view. */
ordersRouter.get('/:id/receipt', (req, res) => {
  const order = getOrder(Number(req.params.id));
  res.json({ order, business: getBusinessSettings(), tax: getTaxSettings() });
});

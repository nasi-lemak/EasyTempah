import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole, verifyPin } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { audit } from '../services/audit';
import {
  addItems,
  addPayment,
  addRefund,
  attachCustomer,
  redeemPoints,
  cancelLine,
  createOrder,
  getOrder,
  moveTable,
  sendToKitchen,
  setDiscount,
  splitOrder,
  updateLine,
  voidOrder,
  type AddLineInput,
  type PayInput,
  type RefundInput,
  type SplitPick,
} from '../services/orders';
import { createCreditNoteForRefund, einvoiceWithPortal } from '../services/einvoice';
import { printKitchenTickets } from '../services/printer';
import { getBusinessSettings, getPaymentsSettings, getTaxSettings } from '../services/settings';
import type { Order, OrderType } from '../types';

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
  // Search overrides the date filter: "the customer is back with a receipt"
  // shouldn't require knowing which day it was.
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
  if (q) {
    const like = `%${q}%`;
    where.push('(o.order_no LIKE ? OR o.receipt_no LIKE ? OR o.platform_ref LIKE ?)');
    params.push(like, like, like);
  } else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
  const b = req.body as {
    type?: OrderType;
    table_id?: number;
    covers?: number;
    notes?: string;
    platform?: string;
    platform_ref?: string;
  };
  if (!b.type || !ORDER_TYPES.includes(b.type)) throw badRequest('Invalid order type');
  const id = createOrder(
    {
      type: b.type,
      table_id: b.table_id ?? null,
      covers: b.covers,
      notes: b.notes ?? null,
      platform: b.platform ?? null,
      platform_ref: b.platform_ref ?? null,
    },
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
  const b = req.body as {
    qty?: number;
    notes?: string | null;
    cancel?: boolean;
    unit_price_cents?: number;
  };
  if (b.unit_price_cents !== undefined && !['manager', 'admin'].includes(req.user!.role)) {
    res.status(403).json({ error: 'Manager rights required to override a price' });
    return;
  }
  if (b.cancel) {
    cancelLine(orderId, lineId, req.user!.id);
  } else {
    updateLine(
      orderId,
      lineId,
      { qty: b.qty, notes: b.notes, unit_price_cents: b.unit_price_cents },
      req.user!.id,
    );
  }
  publish('orders');
  publish('kds');
  res.json({ order: getOrder(orderId) });
});

ordersRouter.post('/:id/send', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const lineIds = sendToKitchen(orderId, req.user!.id);
  if (lineIds.length > 0) {
    publish('kds');
    publish('orders');
    publish('inventory');
    void printKitchenTickets(orderId, lineIds); // fire-and-forget; logs on failure
  }
  res.json({ sent: lineIds.length, order: getOrder(orderId) });
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

/**
 * Key a collection-pager number against an open order (null clears it). The
 * pass reads it off the KDS card / kitchen ticket and rings that pager when
 * the food is up. One pager per live order — a duplicate is exactly the
 * mix-up pagers exist to prevent, so it 409s naming the clashing order.
 */
ordersRouter.post('/:id/pager', (req: AuthedRequest, res) => {
  const { pager_no } = req.body as { pager_no?: number | null };
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id)) as Order | undefined;
  if (!order) throw notFound('Order not found');
  if (order.status !== 'open') throw conflict('Only open orders can hold a pager');
  if (pager_no != null) {
    if (!Number.isInteger(pager_no) || pager_no < 1 || pager_no > 999) {
      throw badRequest('Pager number must be 1-999');
    }
    const clash = db
      .prepare("SELECT order_no FROM orders WHERE pager_no = ? AND status = 'open' AND id != ?")
      .get(pager_no, order.id) as { order_no: string } | undefined;
    if (clash) throw conflict(`Pager ${pager_no} is already on open order #${clash.order_no}`);
  }
  db.prepare('UPDATE orders SET pager_no = ? WHERE id = ?').run(pager_no ?? null, order.id);
  audit(req.user!.id, 'order.pager', { orderId: order.id, pager_no: pager_no ?? null });
  publish('orders');
  publish('kds');
  res.json({ order: getOrder(order.id) });
});

/** Attach a loyalty member (existing by id, or new by phone + consent) to an open order. */
ordersRouter.post('/:id/customer', (req: AuthedRequest, res) => {
  const { phone, name, customer_id, consent } = req.body as {
    phone?: string;
    name?: string;
    customer_id?: number;
    consent?: boolean;
  };
  if (!phone && customer_id == null) throw badRequest('phone or customer_id required');
  const customer = attachCustomer(Number(req.params.id), phone ?? '', name, req.user!.id, {
    customerId: customer_id ?? undefined,
    consent: !!consent,
  });
  publish('orders');
  res.json({ customer, order: getOrder(Number(req.params.id)) });
});

/** Redeem points as tender against the order's balance. */
ordersRouter.post('/:id/redeem', (req: AuthedRequest, res) => {
  const { points } = req.body as { points?: number };
  const result = redeemPoints(Number(req.params.id), Number(points), req.user!.id);
  publish('orders');
  if (result.paid) publish('tables');
  res.json({ ...result, order: getOrder(Number(req.params.id)) });
});

/** Split selected items (whole or partial quantities) onto a new sibling bill. */
ordersRouter.post('/:id/split', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const lines = (req.body as { lines?: SplitPick[] }).lines;
  if (!Array.isArray(lines)) throw badRequest('lines[] required');
  const newId = splitOrder(orderId, lines, req.user!.id);
  publish('orders');
  publish('tables');
  publish('kds');
  res.status(201).json({ order: getOrder(newId), origin: getOrder(orderId) });
});

ordersRouter.post('/:id/payments', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const b = req.body as PayInput & { channel_key?: string };
  // Preferred: a configured channel key; its kind becomes the payment method.
  if (b.channel_key) {
    const channel = getPaymentsSettings().channels.find((c) => c.key === b.channel_key && c.enabled);
    if (!channel) throw badRequest('Unknown or disabled payment channel');
    b.method = channel.kind;
    b.channel = channel.label;
  }
  if (!['cash', 'card', 'ewallet', 'other'].includes(b.method)) throw badRequest('Invalid payment method');
  const result = addPayment(orderId, b, req.user!.id);
  audit(req.user!.id, 'order.payment', { orderId, method: b.method, amount: b.amount_cents });
  publish('orders');
  if (result.paid) publish('tables');
  res.json({ ...result, order: getOrder(orderId) });
});

/**
 * Refund a paid order. Managers/admins approve with their own session;
 * cashiers must supply a manager's PIN (`manager_pin`) for approval.
 */
ordersRouter.post('/:id/refunds', (req: AuthedRequest, res) => {
  const orderId = Number(req.params.id);
  const b = req.body as RefundInput & { manager_pin?: string };
  if (!['cash', 'card', 'ewallet', 'other'].includes(b.method)) throw badRequest('Invalid refund method');

  let approvedBy: number | null = null;
  if (['manager', 'admin'].includes(req.user!.role)) {
    approvedBy = req.user!.id;
  } else if (b.manager_pin && /^\d{4,8}$/.test(b.manager_pin)) {
    const managers = db
      .prepare("SELECT id, pin_hash FROM users WHERE active = 1 AND role IN ('manager','admin')")
      .all() as { id: number; pin_hash: string }[];
    approvedBy = managers.find((m) => verifyPin(b.manager_pin!, m.pin_hash))?.id ?? null;
  }
  if (!approvedBy) {
    res.status(403).json({ error: 'Manager approval required — enter a valid manager PIN' });
    return;
  }

  const refundId = addRefund(
    orderId,
    { method: b.method, amount_cents: b.amount_cents, reason: b.reason ?? '' },
    req.user!.id,
    approvedBy,
  );
  // LHDN compliance: an e-invoiced sale that is refunded needs a credit note.
  // Fire-and-forget — a slow/down LHDN must not hold the refund; failures land
  // as retriable error rows in the e-invoice registry.
  void createCreditNoteForRefund(refundId, req.user!.id).catch((err) =>
    console.error('Credit note creation failed:', err instanceof Error ? err.message : err),
  );
  publish('orders');
  publish('shifts');
  res.status(201).json({ order: getOrder(orderId) });
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

/** Receipt payload: order + business/tax settings + e-invoice link, ready for the print view. */
ordersRouter.get('/:id/receipt', (req, res) => {
  const order = getOrder(Number(req.params.id));
  let einvoice: { uuid: string; status: string; portal_url: string | null } | null = null;
  const row = db
    .prepare(
      "SELECT * FROM einvoices WHERE order_id = ? AND status IN ('submitted','valid') ORDER BY id DESC LIMIT 1",
    )
    .get(order.id) as import('../types').EinvoiceRow | undefined;
  if (row?.uuid) {
    const summary = einvoiceWithPortal(row);
    einvoice = { uuid: row.uuid, status: row.status, portal_url: summary.portal_url };
  }
  res.json({ order, business: getBusinessSettings(), tax: getTaxSettings(), einvoice });
});

import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { audit } from '../services/audit';
import type { Shift } from '../types';

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

function openShift(): Shift | undefined {
  return db.prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").get() as
    | Shift
    | undefined;
}

interface ShiftSummary {
  cash_sales_cents: number;
  card_sales_cents: number;
  ewallet_sales_cents: number;
  other_sales_cents: number;
  total_sales_cents: number;
  orders_paid: number;
  cash_in_cents: number;
  cash_out_cents: number;
  refunds_cents: number;
  cash_refunds_cents: number;
  expected_cash_cents: number;
  by_channel: { channel: string; payments: number; amount_cents: number }[];
}

function summarize(shift: Shift): ShiftSummary {
  const pay = db
    .prepare(
      `SELECT method, SUM(amount_cents) AS amount, COUNT(DISTINCT order_id) AS orders
       FROM payments WHERE shift_id = ? GROUP BY method`,
    )
    .all(shift.id) as { method: string; amount: number; orders: number }[];
  const byMethod: Record<string, number> = {};
  let orders = 0;
  for (const p of pay) {
    byMethod[p.method] = p.amount;
    orders += p.orders;
  }
  const moves = db
    .prepare('SELECT type, SUM(amount_cents) AS amt FROM cash_movements WHERE shift_id = ? GROUP BY type')
    .all(shift.id) as { type: string; amt: number }[];
  const cashIn = moves.find((m) => m.type === 'in')?.amt ?? 0;
  const cashOut = moves.find((m) => m.type === 'out')?.amt ?? 0;
  const cash = byMethod.cash ?? 0;
  const card = byMethod.card ?? 0;
  const ewallet = byMethod.ewallet ?? 0;
  const other = byMethod.other ?? 0;
  const refunds = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_cents ELSE 0 END), 0) AS cash
       FROM refunds WHERE shift_id = ?`,
    )
    .get(shift.id) as { total: number; cash: number };
  const byChannel = db
    .prepare(
      `SELECT COALESCE(channel, method) AS channel, COUNT(*) AS payments, SUM(amount_cents) AS amount_cents
       FROM payments WHERE shift_id = ? GROUP BY COALESCE(channel, method) ORDER BY amount_cents DESC`,
    )
    .all(shift.id) as { channel: string; payments: number; amount_cents: number }[];
  return {
    by_channel: byChannel,
    cash_sales_cents: cash,
    card_sales_cents: card,
    ewallet_sales_cents: ewallet,
    other_sales_cents: other,
    total_sales_cents: cash + card + ewallet + other,
    orders_paid: orders,
    cash_in_cents: cashIn,
    cash_out_cents: cashOut,
    refunds_cents: refunds.total,
    cash_refunds_cents: refunds.cash,
    expected_cash_cents: shift.opening_float_cents + cash + cashIn - cashOut - refunds.cash,
  };
}

shiftsRouter.get('/current', (_req, res) => {
  const shift = openShift();
  if (!shift) {
    res.json({ shift: null });
    return;
  }
  res.json({
    shift,
    summary: summarize(shift),
    movements: db
      .prepare(
        `SELECT cm.*, u.name AS user_name FROM cash_movements cm
         JOIN users u ON u.id = cm.user_id WHERE cm.shift_id = ? ORDER BY cm.id DESC`,
      )
      .all(shift.id),
  });
});

shiftsRouter.post('/open', (req: AuthedRequest, res) => {
  if (openShift()) throw conflict('A shift is already open');
  const { opening_float_cents } = req.body as { opening_float_cents?: number };
  const float = opening_float_cents ?? 0;
  if (!Number.isInteger(float) || float < 0) throw badRequest('Invalid opening float');
  const info = db
    .prepare('INSERT INTO shifts (opened_by, opening_float_cents) VALUES (?, ?)')
    .run(req.user!.id, float);
  audit(req.user!.id, 'shift.open', { float });
  publish('shifts');
  res.status(201).json({ shift: db.prepare('SELECT * FROM shifts WHERE id = ?').get(info.lastInsertRowid) });
});

shiftsRouter.post('/close', (req: AuthedRequest, res) => {
  const shift = openShift();
  if (!shift) throw conflict('No open shift');
  const openOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'").get() as { n: number };
  if (openOrders.n > 0) throw conflict(`${openOrders.n} order(s) still open — close or void them first`);
  const { counted_cash_cents, notes } = req.body as { counted_cash_cents?: number; notes?: string };
  if (!Number.isInteger(counted_cash_cents) || (counted_cash_cents as number) < 0) {
    throw badRequest('Counted cash required');
  }
  const summary = summarize(shift);
  const variance = (counted_cash_cents as number) - summary.expected_cash_cents;
  db.prepare(
    `UPDATE shifts SET status = 'closed', closed_by = ?, closed_at = datetime('now'),
     expected_cash_cents = ?, counted_cash_cents = ?, variance_cents = ?, notes = ? WHERE id = ?`,
  ).run(req.user!.id, summary.expected_cash_cents, counted_cash_cents, variance, notes ?? null, shift.id);
  audit(req.user!.id, 'shift.close', { shiftId: shift.id, variance });
  publish('shifts');
  res.json({
    shift: db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id),
    summary,
    variance_cents: variance,
  });
});

shiftsRouter.post('/cash-movements', (req: AuthedRequest, res) => {
  const shift = openShift();
  if (!shift) throw conflict('No open shift');
  const { type, amount_cents, reason } = req.body as {
    type?: 'in' | 'out';
    amount_cents?: number;
    reason?: string;
  };
  if (type !== 'in' && type !== 'out') throw badRequest('type must be "in" or "out"');
  if (!Number.isInteger(amount_cents) || (amount_cents as number) <= 0) throw badRequest('Invalid amount');
  if (!reason?.trim()) throw badRequest('Reason required');
  db.prepare(
    'INSERT INTO cash_movements (shift_id, type, amount_cents, reason, user_id) VALUES (?, ?, ?, ?, ?)',
  ).run(shift.id, type, amount_cents, reason.trim(), req.user!.id);
  audit(req.user!.id, 'shift.cash_movement', { type, amount_cents, reason });
  publish('shifts');
  res.status(201).json({ ok: true });
});

shiftsRouter.get('/history', requireRole('manager'), (_req, res) => {
  const shifts = db
    .prepare(
      `SELECT s.*, uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM shifts s
       JOIN users uo ON uo.id = s.opened_by
       LEFT JOIN users uc ON uc.id = s.closed_by
       ORDER BY s.id DESC LIMIT 50`,
    )
    .all();
  res.json({ shifts });
});

shiftsRouter.get('/:id/report', requireRole('manager'), (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id) as Shift | undefined;
  if (!shift) throw notFound('Shift not found');
  res.json({ shift, summary: summarize(shift) });
});

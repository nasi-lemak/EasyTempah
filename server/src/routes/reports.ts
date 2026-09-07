import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole('manager'));

function dateRange(req: { query: Record<string, unknown> }): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw badRequest('Dates must be YYYY-MM-DD');
  }
  return { from, to };
}

const PAID_IN_RANGE = `o.status = 'paid' AND date(o.closed_at, 'localtime') BETWEEN ? AND ?`;

reportsRouter.get('/summary', (req, res) => {
  const { from, to } = dateRange(req);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS gross_cents,
              COALESCE(SUM(o.discount_cents), 0) AS discounts_cents,
              COALESCE(SUM(o.tax_cents), 0) AS tax_cents,
              COALESCE(SUM(o.service_cents), 0) AS service_cents,
              COALESCE(SUM(o.rounding_cents), 0) AS rounding_cents,
              COALESCE(SUM(o.covers), 0) AS covers
       FROM orders o WHERE ${PAID_IN_RANGE}`,
    )
    .get(from, to) as Record<string, number>;

  const voids = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o
       WHERE o.status = 'void' AND date(o.closed_at, 'localtime') BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };

  const byType = db
    .prepare(
      `SELECT o.type, COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE} GROUP BY o.type`,
    )
    .all(from, to);

  const avg = totals.orders > 0 ? Math.round(totals.gross_cents / totals.orders) : 0;
  res.json({ from, to, ...totals, void_orders: voids.n, avg_order_cents: avg, by_type: byType });
});

reportsRouter.get('/items', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS total_cents
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE ${PAID_IN_RANGE} AND oi.status != 'cancelled'
       GROUP BY oi.name ORDER BY qty DESC LIMIT 50`,
    )
    .all(from, to);
  res.json({ from, to, items: rows });
});

reportsRouter.get('/payments', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT p.method, COUNT(*) AS payments, SUM(p.amount_cents) AS total_cents
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE ${PAID_IN_RANGE}
       GROUP BY p.method ORDER BY total_cents DESC`,
    )
    .all(from, to);
  res.json({ from, to, payments: rows });
});

reportsRouter.get('/hourly', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT strftime('%H', o.closed_at, 'localtime') AS hour,
              COUNT(*) AS orders, SUM(o.total_cents) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE}
       GROUP BY hour ORDER BY hour`,
    )
    .all(from, to);
  res.json({ from, to, hours: rows });
});

reportsRouter.get('/daily', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT date(o.closed_at, 'localtime') AS day,
              COUNT(*) AS orders, SUM(o.total_cents) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE}
       GROUP BY day ORDER BY day`,
    )
    .all(from, to);
  res.json({ from, to, days: rows });
});

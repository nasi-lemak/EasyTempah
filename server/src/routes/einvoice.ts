import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { notFound } from '../middleware/errors';
import {
  createConsolidatedEinvoice,
  createOrderEinvoice,
  einvoiceWithPortal,
  refreshRow,
} from '../services/einvoice';
import type { EinvoiceBuyer, EinvoiceRow } from '../types';

export const einvoiceRouter = Router();
einvoiceRouter.use(requireAuth);

/** Buyer-requested e-invoice for a paid order (any till role can capture it). */
einvoiceRouter.post('/orders/:orderId', (req: AuthedRequest, res, next) => {
  const buyer = (req.body as { buyer?: Partial<EinvoiceBuyer> }).buyer ?? {};
  createOrderEinvoice(Number(req.params.orderId), buyer, req.user!.id)
    .then((row) => res.status(201).json({ einvoice: einvoiceWithPortal(row) }))
    .catch(next);
});

einvoiceRouter.get('/orders/:orderId', (req, res) => {
  const row = db
    .prepare('SELECT * FROM einvoices WHERE order_id = ? ORDER BY id DESC LIMIT 1')
    .get(req.params.orderId) as EinvoiceRow | undefined;
  res.json({ einvoice: row ? einvoiceWithPortal(row) : null });
});

einvoiceRouter.post('/:id/refresh', (req, res, next) => {
  refreshRow(Number(req.params.id))
    .then((row) => res.json({ einvoice: einvoiceWithPortal(row) }))
    .catch(next);
});

// ---- back office (manager+) ----

einvoiceRouter.get('/', requireRole('manager'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*, o.order_no, u.name AS created_by_name
       FROM einvoices e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN users u ON u.id = e.created_by
       ORDER BY e.id DESC LIMIT 200`,
    )
    .all() as (EinvoiceRow & { order_no: string | null; created_by_name: string | null })[];
  res.json({ einvoices: rows.map((r) => ({ ...einvoiceWithPortal(r), order_no: r.order_no, created_by_name: r.created_by_name })) });
});

einvoiceRouter.post('/consolidate', requireRole('manager'), (req: AuthedRequest, res, next) => {
  const period = String((req.body as { period?: string }).period ?? '');
  createConsolidatedEinvoice(period, req.user!.id)
    .then((row) => res.status(201).json({ einvoice: einvoiceWithPortal(row) }))
    .catch(next);
});

/** Orders in a month still awaiting consolidation (preview before submitting). */
einvoiceRouter.get('/consolidate/preview', requireRole('manager'), (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : '';
  if (!/^\d{4}-\d{2}$/.test(period)) throw notFound('period=YYYY-MM required');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS total_cents
       FROM orders
       WHERE status = 'paid' AND einvoice_id IS NULL AND platform IS NULL
         AND strftime('%Y-%m', closed_at, 'localtime') = ?`,
    )
    .get(period) as { orders: number; total_cents: number };
  res.json({ period, ...row });
});

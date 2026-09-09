import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { audit } from '../services/audit';
import type { Customer } from '../types';

export const customersRouter = Router();
customersRouter.use(requireAuth);

/** Till lookup by phone (any staff role that can sell). */
customersRouter.get('/lookup', (req, res) => {
  const phone = String(req.query.phone ?? '').replace(/[^\d+]/g, '');
  if (phone.length < 4) throw badRequest('Enter at least 4 digits');
  const customer = db
    .prepare('SELECT * FROM customers WHERE phone LIKE ? ORDER BY last_visit_at DESC LIMIT 1')
    .get(`%${phone}`) as Customer | undefined;
  res.json({ customer: customer ?? null });
});

// ---- back office (manager+) ----

customersRouter.get('/', requireRole('manager'), (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM customers WHERE phone LIKE ? OR name LIKE ?
           ORDER BY last_visit_at DESC LIMIT 100`,
        )
        .all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM customers ORDER BY last_visit_at DESC LIMIT 100').all();
  res.json({ customers: rows });
});

customersRouter.get('/:id/movements', requireRole('manager'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT pm.*, o.order_no, u.name AS user_name
       FROM point_movements pm
       LEFT JOIN orders o ON o.id = pm.order_id
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.customer_id = ? ORDER BY pm.id DESC LIMIT 100`,
    )
    .all(req.params.id);
  res.json({ movements: rows });
});

/** Manual points adjustment (goodwill, correction after refund, migration). */
customersRouter.post('/:id/adjust', requireRole('manager'), (req: AuthedRequest, res) => {
  const { delta, reason } = req.body as { delta?: number; reason?: string };
  if (!Number.isInteger(delta) || delta === 0) throw badRequest('Non-zero integer delta required');
  if (!reason?.trim()) throw badRequest('Reason required');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as
    | Customer
    | undefined;
  if (!customer) throw notFound('Customer not found');
  if (customer.points + (delta as number) < 0) throw badRequest('Points cannot go negative');
  db.prepare('UPDATE customers SET points = points + ? WHERE id = ?').run(delta, customer.id);
  db.prepare(
    "INSERT INTO point_movements (customer_id, delta, reason, user_id) VALUES (?, ?, ?, ?)",
  ).run(customer.id, delta, `adjust: ${reason.trim()}`, req.user!.id);
  audit(req.user!.id, 'loyalty.adjust', { customerId: customer.id, delta, reason });
  res.json({ ok: true, points: customer.points + (delta as number) });
});

import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { audit } from '../services/audit';
import { anonymiseCustomer } from '../services/customers';
import type { Customer } from '../types';

export const customersRouter = Router();
customersRouter.use(requireAuth);

const NOT_DELETED = "phone NOT LIKE 'deleted-%'";

/**
 * Till lookup by phone (any staff role that can sell). Returns only what the
 * till needs — never the full record; the phone comes back masked.
 */
customersRouter.get('/lookup', (req, res) => {
  const phone = String(req.query.phone ?? '').replace(/[^\d+]/g, '');
  if (phone.length < 4) throw badRequest('Enter at least 4 digits');
  const customer = db
    .prepare(`SELECT * FROM customers WHERE phone LIKE ? AND ${NOT_DELETED} ORDER BY last_visit_at DESC LIMIT 1`)
    .get(`%${phone}`) as Customer | undefined;
  res.json({
    customer: customer
      ? { id: customer.id, name: customer.name, points: customer.points, phone_tail: customer.phone.slice(-4) }
      : null,
  });
});

// ---- back office (manager+) ----

customersRouter.get('/', requireRole('manager'), (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM customers WHERE (phone LIKE ? OR name LIKE ?) AND ${NOT_DELETED}
           ORDER BY last_visit_at DESC LIMIT 100`,
        )
        .all(`%${q}%`, `%${q}%`)
    : db.prepare(`SELECT * FROM customers WHERE ${NOT_DELETED} ORDER BY last_visit_at DESC LIMIT 100`).all();
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

/** PDPA access right: everything held about one member, ready to print. */
customersRouter.get('/:id/export', requireRole('manager'), (req, res) => {
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND ${NOT_DELETED}`)
    .get(req.params.id) as Customer | undefined;
  if (!customer) throw notFound('Member not found');
  const movements = db
    .prepare('SELECT delta, reason, created_at FROM point_movements WHERE customer_id = ? ORDER BY id')
    .all(customer.id);
  const orders = db
    .prepare(
      `SELECT order_no, receipt_no, closed_at, total_cents FROM orders
       WHERE customer_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 100`,
    )
    .all(customer.id);
  audit((req as AuthedRequest).user!.id, 'customer.export', { customerId: customer.id });
  res.json({ customer, movements, orders });
});

/** Correction right: fix a name or phone; record consent after the fact. */
customersRouter.put('/:id', requireRole('manager'), (req: AuthedRequest, res) => {
  const { name, phone, consent } = req.body as { name?: string; phone?: string; consent?: boolean };
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND ${NOT_DELETED}`)
    .get(req.params.id) as Customer | undefined;
  if (!customer) throw notFound('Member not found');
  if (phone !== undefined) {
    const clean = phone.replace(/[^\d+]/g, '');
    if (!/^\+?\d{8,15}$/.test(clean)) throw badRequest('Phone number looks invalid');
    const clash = db
      .prepare('SELECT id FROM customers WHERE phone = ? AND id != ?')
      .get(clean, customer.id);
    if (clash) throw conflict('Another member already uses that phone number');
    db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(clean, customer.id);
  }
  if (name !== undefined) {
    db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name.trim() || null, customer.id);
  }
  if (consent === true && !customer.consent_at) {
    db.prepare("UPDATE customers SET consent_at = datetime('now') WHERE id = ?").run(customer.id);
  }
  audit(req.user!.id, 'customer.update', {
    customerId: customer.id,
    fields: [phone !== undefined && 'phone', name !== undefined && 'name', consent === true && 'consent'].filter(Boolean),
  });
  res.json({ customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id) });
});

/** Erasure right: anonymise the member; the points ledger keeps its integrity. */
customersRouter.delete('/:id', requireRole('manager'), (req: AuthedRequest, res) => {
  anonymiseCustomer(Number(req.params.id), req.user!.id, 'request');
  res.json({ ok: true });
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

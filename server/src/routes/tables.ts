import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { DiningTable } from '../types';

export const tablesRouter = Router();
tablesRouter.use(requireAuth);

/** Tables with live occupancy derived from open orders. */
tablesRouter.get('/', (_req, res) => {
  const tables = db
    .prepare(
      `SELECT t.*, o.id AS order_id, o.order_no, o.total_cents, o.covers, o.opened_at AS order_opened_at
       FROM dining_tables t
       LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
       WHERE t.active = 1
       ORDER BY t.zone, t.name`,
    )
    .all();
  res.json({ tables });
});

tablesRouter.post('/', requireRole('manager'), (req, res) => {
  const { name, zone, seats } = req.body as Partial<DiningTable>;
  if (!name?.trim()) throw badRequest('Table name required');
  const info = db
    .prepare('INSERT INTO dining_tables (name, zone, seats) VALUES (?, ?, ?)')
    .run(name.trim(), zone?.trim() || 'Main', seats ?? 2);
  publish('tables');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

tablesRouter.patch('/:id', requireRole('manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(req.params.id) as
    | DiningTable
    | undefined;
  if (!t) throw notFound();
  const b = req.body as Partial<DiningTable>;
  db.prepare('UPDATE dining_tables SET name = ?, zone = ?, seats = ?, active = ? WHERE id = ?').run(
    b.name?.trim() || t.name,
    b.zone?.trim() || t.zone,
    b.seats ?? t.seats,
    b.active !== undefined ? (b.active ? 1 : 0) : t.active,
    t.id,
  );
  publish('tables');
  res.json({ ok: true });
});

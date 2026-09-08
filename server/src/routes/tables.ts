import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { DiningTable } from '../types';

export const tablesRouter = Router();
tablesRouter.use(requireAuth);

/** Tables with live occupancy and kitchen progress derived from open orders. */
tablesRouter.get('/', (_req, res) => {
  const tables = db
    .prepare(
      `SELECT t.*, o.id AS order_id, o.order_no, o.total_cents, o.covers, o.opened_at AS order_opened_at,
        (SELECT COUNT(*) FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status IN ('sent','preparing')) AS cooking_lines,
        (SELECT COUNT(*) FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_lines
       FROM dining_tables t
       LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
       WHERE t.active = 1
       ORDER BY t.zone, t.name`,
    )
    .all();
  res.json({ tables });
});

/** Bulk-save floor plan positions (drag-and-drop layout editor). */
tablesRouter.post('/layout', requireRole('manager'), (req, res) => {
  const positions = (req.body as { positions?: unknown }).positions;
  if (!Array.isArray(positions) || positions.length === 0) throw badRequest('positions[] required');
  const stmt = db.prepare(
    'UPDATE dining_tables SET pos_x = ?, pos_y = ?, shape = ? WHERE id = ?',
  );
  const save = db.transaction((rows: { id: number; pos_x: number | null; pos_y: number | null; shape?: string }[]) => {
    for (const p of rows) {
      if (!Number.isInteger(p.id)) throw badRequest('Invalid table id');
      const placed = p.pos_x != null && p.pos_y != null;
      if (placed && (p.pos_x! < 0 || p.pos_x! > 100 || p.pos_y! < 0 || p.pos_y! > 100)) {
        throw badRequest('Positions must be 0-100 (percent of the floor)');
      }
      const shape = p.shape === 'round' ? 'round' : 'square';
      const info = stmt.run(placed ? p.pos_x : null, placed ? p.pos_y : null, shape, p.id);
      if (info.changes === 0) throw badRequest(`Table ${p.id} not found`);
    }
  });
  save(positions as { id: number; pos_x: number | null; pos_y: number | null; shape?: string }[]);
  publish('tables');
  res.json({ ok: true, saved: positions.length });
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
  db.prepare(
    'UPDATE dining_tables SET name = ?, zone = ?, seats = ?, active = ?, pos_x = ?, pos_y = ?, shape = ? WHERE id = ?',
  ).run(
    b.name?.trim() || t.name,
    b.zone?.trim() || t.zone,
    b.seats ?? t.seats,
    b.active !== undefined ? (b.active ? 1 : 0) : t.active,
    b.pos_x !== undefined ? b.pos_x : t.pos_x,
    b.pos_y !== undefined ? b.pos_y : t.pos_y,
    b.shape === 'round' || b.shape === 'square' ? b.shape : t.shape,
    t.id,
  );
  publish('tables');
  res.json({ ok: true });
});

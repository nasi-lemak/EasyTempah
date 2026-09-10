import { Router } from 'express';
import { db, newQrToken } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { DiningTable } from '../types';

export const tablesRouter = Router();
tablesRouter.use(requireAuth);

/**
 * Tables with live occupancy and kitchen progress. A table can carry several
 * open sibling orders after a bill split, so open-order data is aggregated:
 * order_id points at the original (lowest id) bill, totals/covers are summed.
 */
tablesRouter.get('/', (_req, res) => {
  const tables = db
    .prepare(
      `SELECT t.*,
        (SELECT MIN(o.id) FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS order_id,
        (SELECT o.order_no FROM orders o WHERE o.table_id = t.id AND o.status = 'open' ORDER BY o.id LIMIT 1) AS order_no,
        (SELECT COUNT(*) FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS open_orders,
        (SELECT SUM(o.total_cents) FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS total_cents,
        (SELECT SUM(o.covers) FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS covers,
        (SELECT MIN(o.opened_at) FROM orders o WHERE o.table_id = t.id AND o.status = 'open') AS order_opened_at,
        (SELECT COUNT(*) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
          WHERE o2.table_id = t.id AND o2.status = 'open' AND oi.status IN ('sent','preparing')) AS cooking_lines,
        (SELECT COUNT(*) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
          WHERE o2.table_id = t.id AND o2.status = 'open' AND oi.status = 'ready') AS ready_lines,
        (SELECT sc.reason FROM service_calls sc WHERE sc.table_id = t.id AND sc.acked_at IS NULL
          ORDER BY sc.id DESC LIMIT 1) AS call_reason,
        (SELECT sc.created_at FROM service_calls sc WHERE sc.table_id = t.id AND sc.acked_at IS NULL
          ORDER BY sc.id DESC LIMIT 1) AS call_at,
        (SELECT r.name FROM reservations r WHERE r.table_id = t.id AND r.status = 'booked'
          AND r.reserved_at BETWEEN datetime('now', 'localtime', '-30 minutes') AND datetime('now', 'localtime', '+2 hours')
          ORDER BY r.reserved_at LIMIT 1) AS reservation_name,
        (SELECT r.reserved_at FROM reservations r WHERE r.table_id = t.id AND r.status = 'booked'
          AND r.reserved_at BETWEEN datetime('now', 'localtime', '-30 minutes') AND datetime('now', 'localtime', '+2 hours')
          ORDER BY r.reserved_at LIMIT 1) AS reservation_at
       FROM dining_tables t
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
    .prepare('INSERT INTO dining_tables (name, zone, seats, qr_token) VALUES (?, ?, ?, ?)')
    .run(name.trim(), zone?.trim() || 'Main', seats ?? 2, newQrToken());
  publish('tables');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

/** Acknowledge a guest's call-waiter request (any signed-in staff). */
tablesRouter.post('/:id/ack-call', (req, res) => {
  const authed = req as import('../middleware/auth').AuthedRequest;
  db.prepare(
    "UPDATE service_calls SET acked_at = datetime('now'), acked_by = ? WHERE table_id = ? AND acked_at IS NULL",
  ).run(authed.user!.id, req.params.id);
  publish('tables');
  res.json({ ok: true });
});

/** Rotate a table's QR ordering token, invalidating any printed codes. */
tablesRouter.post('/:id/qr-rotate', requireRole('manager'), (req, res) => {
  const info = db
    .prepare('UPDATE dining_tables SET qr_token = ? WHERE id = ?')
    .run(newQrToken(), req.params.id);
  if (info.changes === 0) throw notFound();
  publish('tables');
  res.json({ ok: true });
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

import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { OrderItemStatus } from '../types';

export const kdsRouter = Router();
kdsRouter.use(requireAuth);

/** Active kitchen tickets: sent/preparing/ready lines of open orders, grouped by order. */
kdsRouter.get('/tickets', (req, res) => {
  const station = typeof req.query.station === 'string' ? req.query.station : null;
  const params: unknown[] = [];
  let stationFilter = '';
  if (station === 'kitchen' || station === 'bar') {
    stationFilter = 'AND oi.station = ?';
    params.push(station);
  }
  const lines = db
    .prepare(
      `SELECT oi.*, o.order_no, o.type, o.notes AS order_notes, t.name AS table_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN dining_tables t ON t.id = o.table_id
       WHERE o.status = 'open' AND oi.status IN ('sent','preparing','ready') ${stationFilter}
       ORDER BY oi.sent_at, oi.id`,
    )
    .all(...params) as Record<string, unknown>[];

  const byOrder = new Map<number, { order_id: number; order_no: string; type: string; table_name: string | null; order_notes: string | null; sent_at: string | null; lines: unknown[] }>();
  for (const line of lines) {
    const orderId = line.order_id as number;
    let ticket = byOrder.get(orderId);
    if (!ticket) {
      ticket = {
        order_id: orderId,
        order_no: line.order_no as string,
        type: line.type as string,
        table_name: (line.table_name as string) ?? null,
        order_notes: (line.order_notes as string) ?? null,
        sent_at: (line.sent_at as string) ?? null,
        lines: [],
      };
      byOrder.set(orderId, ticket);
    }
    ticket.lines.push(line);
  }
  res.json({ tickets: [...byOrder.values()] });
});

const BUMP_FLOW: Record<string, OrderItemStatus> = {
  sent: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

kdsRouter.post('/lines/:lineId/bump', (req: AuthedRequest, res) => {
  const line = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.lineId) as
    | { id: number; status: string }
    | undefined;
  if (!line) throw notFound('Line not found');
  const target = (req.body as { status?: OrderItemStatus }).status ?? BUMP_FLOW[line.status];
  if (!target || !['preparing', 'ready', 'served'].includes(target)) {
    throw badRequest(`Cannot bump a line in status "${line.status}"`);
  }
  db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run(target, line.id);
  publish('kds');
  publish('orders');
  res.json({ ok: true, status: target });
});

/** Bump every remaining line on a ticket (order) at once. */
kdsRouter.post('/tickets/:orderId/bump', (req: AuthedRequest, res) => {
  const info = db
    .prepare(
      `UPDATE order_items SET status = 'served'
       WHERE order_id = ? AND status IN ('sent','preparing','ready')`,
    )
    .run(req.params.orderId);
  publish('kds');
  publish('orders');
  res.json({ ok: true, bumped: info.changes });
});

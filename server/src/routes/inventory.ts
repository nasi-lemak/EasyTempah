import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { audit } from '../services/audit';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireRole('manager'));

inventoryRouter.get('/', (_req, res) => {
  const items = db
    .prepare(
      `SELECT i.id, i.name, c.name AS category, i.track_stock, i.stock_qty, i.low_stock_threshold, i.active
       FROM items i JOIN categories c ON c.id = i.category_id
       ORDER BY c.sort, c.name, i.name`,
    )
    .all();
  res.json({ items });
});

inventoryRouter.get('/movements/:itemId', (req, res) => {
  const rows = db
    .prepare(
      `SELECT sm.*, u.name AS user_name FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.item_id = ? ORDER BY sm.id DESC LIMIT 100`,
    )
    .all(req.params.itemId);
  res.json({ movements: rows });
});

const adjust = db.transaction(
  (itemId: number, delta: number, reason: string, userId: number): number => {
    const item = db.prepare('SELECT id, stock_qty FROM items WHERE id = ?').get(itemId) as
      | { id: number; stock_qty: number }
      | undefined;
    if (!item) throw notFound('Item not found');
    const newQty = item.stock_qty + delta;
    if (newQty < 0) throw badRequest(`Adjustment would make stock negative (current: ${item.stock_qty})`);
    db.prepare('UPDATE items SET stock_qty = ?, track_stock = 1 WHERE id = ?').run(newQty, itemId);
    db.prepare(
      'INSERT INTO stock_movements (item_id, delta, reason, user_id) VALUES (?, ?, ?, ?)',
    ).run(itemId, delta, reason, userId);
    return newQty;
  },
);

inventoryRouter.post('/adjust', (req: AuthedRequest, res) => {
  const { item_id, delta, reason } = req.body as { item_id?: number; delta?: number; reason?: string };
  if (!item_id || !Number.isInteger(delta) || delta === 0) throw badRequest('item_id and non-zero integer delta required');
  if (!reason?.trim()) throw badRequest('Reason required');
  const newQty = adjust(item_id, delta as number, reason.trim(), req.user!.id);
  audit(req.user!.id, 'inventory.adjust', { item_id, delta, reason });
  publish('inventory');
  res.json({ ok: true, stock_qty: newQty });
});

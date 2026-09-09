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

// ---- Ingredients (recipe-level inventory) ----

inventoryRouter.get('/ingredients', (_req, res) => {
  res.json({
    ingredients: db.prepare('SELECT * FROM ingredients ORDER BY name').all(),
  });
});

inventoryRouter.post('/ingredients', (req: AuthedRequest, res) => {
  const b = req.body as {
    name?: string;
    unit?: string;
    stock_qty?: number;
    low_stock_threshold?: number;
    cost_per_unit_cents?: number;
  };
  if (!b.name?.trim()) throw badRequest('Ingredient name required');
  const info = db
    .prepare(
      'INSERT INTO ingredients (name, unit, stock_qty, low_stock_threshold, cost_per_unit_cents) VALUES (?, ?, ?, ?, ?)',
    )
    .run(b.name.trim(), b.unit?.trim() || 'g', b.stock_qty ?? 0, b.low_stock_threshold ?? 0, b.cost_per_unit_cents ?? 0);
  audit(req.user!.id, 'ingredient.create', { name: b.name.trim() });
  publish('inventory');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

inventoryRouter.patch('/ingredients/:id', (req: AuthedRequest, res) => {
  const ing = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!ing) throw notFound('Ingredient not found');
  const b = req.body as Record<string, unknown>;
  db.prepare(
    'UPDATE ingredients SET name = ?, unit = ?, low_stock_threshold = ?, cost_per_unit_cents = ?, active = ? WHERE id = ?',
  ).run(
    typeof b.name === 'string' && b.name.trim() ? b.name.trim() : ing.name,
    typeof b.unit === 'string' && b.unit.trim() ? b.unit.trim() : ing.unit,
    typeof b.low_stock_threshold === 'number' ? b.low_stock_threshold : ing.low_stock_threshold,
    typeof b.cost_per_unit_cents === 'number' ? b.cost_per_unit_cents : ing.cost_per_unit_cents,
    b.active !== undefined ? (b.active ? 1 : 0) : ing.active,
    req.params.id,
  );
  publish('inventory');
  res.json({ ok: true });
});

inventoryRouter.post('/ingredients/adjust', (req: AuthedRequest, res) => {
  const { ingredient_id, delta, reason } = req.body as {
    ingredient_id?: number;
    delta?: number;
    reason?: string;
  };
  if (!ingredient_id || typeof delta !== 'number' || delta === 0) {
    throw badRequest('ingredient_id and non-zero delta required');
  }
  if (!reason?.trim()) throw badRequest('Reason required');
  const ing = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(ingredient_id);
  if (!ing) throw notFound('Ingredient not found');
  db.prepare('UPDATE ingredients SET stock_qty = stock_qty + ? WHERE id = ?').run(delta, ingredient_id);
  db.prepare(
    'INSERT INTO ingredient_movements (ingredient_id, delta, reason, user_id) VALUES (?, ?, ?, ?)',
  ).run(ingredient_id, delta, reason.trim(), req.user!.id);
  audit(req.user!.id, 'ingredient.adjust', { ingredient_id, delta, reason });
  publish('inventory');
  const row = db.prepare('SELECT stock_qty FROM ingredients WHERE id = ?').get(ingredient_id) as {
    stock_qty: number;
  };
  res.json({ ok: true, stock_qty: row.stock_qty });
});

inventoryRouter.get('/ingredients/:id/movements', (req, res) => {
  const rows = db
    .prepare(
      `SELECT im.*, u.name AS user_name FROM ingredient_movements im
       LEFT JOIN users u ON u.id = im.user_id
       WHERE im.ingredient_id = ? ORDER BY im.id DESC LIMIT 100`,
    )
    .all(req.params.id);
  res.json({ movements: rows });
});

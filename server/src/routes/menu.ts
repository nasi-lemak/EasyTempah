import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { Category, Item, Modifier, ModifierGroup } from '../types';

export const menuRouter = Router();
menuRouter.use(requireAuth);

/** Full menu tree for the POS screen: categories → items → modifier groups → modifiers. */
menuRouter.get('/', (_req, res) => {
  const categories = db
    .prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name')
    .all() as Category[];
  const items = db
    .prepare('SELECT * FROM items WHERE active = 1 ORDER BY sort, name')
    .all() as Item[];
  const groups = db.prepare('SELECT * FROM modifier_groups').all() as ModifierGroup[];
  const modifiers = db
    .prepare('SELECT * FROM modifiers WHERE active = 1 ORDER BY sort, name')
    .all() as Modifier[];
  const links = db.prepare('SELECT * FROM item_modifier_groups').all() as {
    item_id: number;
    group_id: number;
  }[];
  const comboGroups = db.prepare('SELECT * FROM combo_groups ORDER BY sort, id').all();
  const comboItems = db.prepare('SELECT * FROM combo_group_items').all();
  res.json({ categories, items, groups, modifiers, links, comboGroups, comboItems });
});

// ---- Admin CRUD (manager+) ----

menuRouter.get('/admin', requireRole('manager'), (_req, res) => {
  res.json({
    categories: db.prepare('SELECT * FROM categories ORDER BY sort, name').all(),
    items: db.prepare('SELECT * FROM items ORDER BY sort, name').all(),
    groups: db.prepare('SELECT * FROM modifier_groups ORDER BY name').all(),
    modifiers: db.prepare('SELECT * FROM modifiers ORDER BY sort, name').all(),
    links: db.prepare('SELECT * FROM item_modifier_groups').all(),
    comboGroups: db.prepare('SELECT * FROM combo_groups ORDER BY sort, id').all(),
    comboItems: db.prepare('SELECT * FROM combo_group_items').all(),
  });
});

/** Replace a combo item's choice groups wholesale (simplest correct admin semantics). */
const saveCombo = db.transaction(
  (itemId: number, groups: { name: string; items: { item_id: number; surcharge_cents?: number }[] }[]): void => {
    db.prepare('DELETE FROM combo_groups WHERE item_id = ?').run(itemId); // cascades to group items
    groups.forEach((g, idx) => {
      if (!g.name?.trim()) throw badRequest('Choice group name required');
      if (!Array.isArray(g.items) || g.items.length === 0) {
        throw badRequest(`"${g.name}" needs at least one option`);
      }
      const info = db
        .prepare('INSERT INTO combo_groups (item_id, name, sort) VALUES (?, ?, ?)')
        .run(itemId, g.name.trim(), idx);
      const groupId = Number(info.lastInsertRowid);
      for (const opt of g.items) {
        const component = db
          .prepare('SELECT id, is_combo FROM items WHERE id = ?')
          .get(opt.item_id) as { id: number; is_combo: number } | undefined;
        if (!component) throw badRequest('Component item not found');
        if (component.is_combo || component.id === itemId) {
          throw badRequest('A set cannot contain another set (or itself)');
        }
        db.prepare(
          'INSERT OR IGNORE INTO combo_group_items (group_id, item_id, surcharge_cents) VALUES (?, ?, ?)',
        ).run(groupId, opt.item_id, Math.max(0, Math.round(opt.surcharge_cents ?? 0)));
      }
    });
  },
);

menuRouter.put('/items/:id/combo', requireRole('manager'), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as Item | undefined;
  if (!item) throw notFound();
  const groups = (req.body as { groups?: { name: string; items: { item_id: number; surcharge_cents?: number }[] }[] })
    .groups;
  if (!Array.isArray(groups)) throw badRequest('groups[] required');
  db.prepare('UPDATE items SET is_combo = ? WHERE id = ?').run(groups.length > 0 ? 1 : 0, item.id);
  saveCombo(item.id, groups);
  publish('menu');
  res.json({ ok: true, is_combo: groups.length > 0 });
});

menuRouter.post('/categories', requireRole('manager'), (req, res) => {
  const { name, sort } = req.body as { name?: string; sort?: number };
  if (!name?.trim()) throw badRequest('Category name required');
  const info = db
    .prepare('INSERT INTO categories (name, sort) VALUES (?, ?)')
    .run(name.trim(), sort ?? 0);
  publish('menu');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

menuRouter.patch('/categories/:id', requireRole('manager'), (req, res) => {
  const { name, sort, active } = req.body as Partial<Category>;
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) as Category | undefined;
  if (!cat) throw notFound();
  db.prepare('UPDATE categories SET name = ?, sort = ?, active = ? WHERE id = ?').run(
    name ?? cat.name,
    sort ?? cat.sort,
    active !== undefined ? (active ? 1 : 0) : cat.active,
    cat.id,
  );
  publish('menu');
  res.json({ ok: true });
});

menuRouter.post('/items', requireRole('manager'), (req: AuthedRequest, res) => {
  const b = req.body as Partial<Item> & { modifier_group_ids?: number[] };
  if (!b.name?.trim()) throw badRequest('Item name required');
  if (!b.category_id) throw badRequest('Category required');
  if (!Number.isInteger(b.price_cents) || (b.price_cents as number) < 0) throw badRequest('Invalid price');
  const info = db
    .prepare(
      `INSERT INTO items (category_id, name, price_cents, sku, station, track_stock, stock_qty, low_stock_threshold, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.category_id,
      b.name.trim(),
      b.price_cents,
      b.sku ?? null,
      b.station === 'bar' ? 'bar' : 'kitchen',
      b.track_stock ? 1 : 0,
      b.stock_qty ?? 0,
      b.low_stock_threshold ?? 5,
      b.sort ?? 0,
    );
  const itemId = Number(info.lastInsertRowid);
  for (const gid of b.modifier_group_ids ?? []) {
    db.prepare('INSERT OR IGNORE INTO item_modifier_groups (item_id, group_id) VALUES (?, ?)').run(itemId, gid);
  }
  publish('menu');
  res.status(201).json({ id: itemId });
});

menuRouter.patch('/items/:id', requireRole('manager'), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as Item | undefined;
  if (!item) throw notFound();
  const b = req.body as Partial<Item> & { modifier_group_ids?: number[] };
  if (b.price_cents !== undefined && (!Number.isInteger(b.price_cents) || b.price_cents < 0)) {
    throw badRequest('Invalid price');
  }
  db.prepare(
    `UPDATE items SET category_id = ?, name = ?, price_cents = ?, sku = ?, station = ?,
     active = ?, track_stock = ?, low_stock_threshold = ?, sort = ? WHERE id = ?`,
  ).run(
    b.category_id ?? item.category_id,
    b.name?.trim() || item.name,
    b.price_cents ?? item.price_cents,
    b.sku !== undefined ? b.sku : item.sku,
    b.station ?? item.station,
    b.active !== undefined ? (b.active ? 1 : 0) : item.active,
    b.track_stock !== undefined ? (b.track_stock ? 1 : 0) : item.track_stock,
    b.low_stock_threshold ?? item.low_stock_threshold,
    b.sort ?? item.sort,
    item.id,
  );
  if (b.modifier_group_ids) {
    db.prepare('DELETE FROM item_modifier_groups WHERE item_id = ?').run(item.id);
    for (const gid of b.modifier_group_ids) {
      db.prepare('INSERT OR IGNORE INTO item_modifier_groups (item_id, group_id) VALUES (?, ?)').run(item.id, gid);
    }
  }
  publish('menu');
  res.json({ ok: true });
});

menuRouter.post('/modifier-groups', requireRole('manager'), (req, res) => {
  const { name, min_select, max_select } = req.body as Partial<ModifierGroup>;
  if (!name?.trim()) throw badRequest('Group name required');
  const info = db
    .prepare('INSERT INTO modifier_groups (name, min_select, max_select) VALUES (?, ?, ?)')
    .run(name.trim(), min_select ?? 0, max_select ?? 0);
  publish('menu');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

menuRouter.patch('/modifier-groups/:id', requireRole('manager'), (req, res) => {
  const g = db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(req.params.id) as
    | ModifierGroup
    | undefined;
  if (!g) throw notFound();
  const b = req.body as Partial<ModifierGroup>;
  db.prepare('UPDATE modifier_groups SET name = ?, min_select = ?, max_select = ? WHERE id = ?').run(
    b.name?.trim() || g.name,
    b.min_select ?? g.min_select,
    b.max_select ?? g.max_select,
    g.id,
  );
  publish('menu');
  res.json({ ok: true });
});

menuRouter.post('/modifiers', requireRole('manager'), (req, res) => {
  const b = req.body as Partial<Modifier>;
  if (!b.name?.trim() || !b.group_id) throw badRequest('Modifier name and group required');
  const info = db
    .prepare('INSERT INTO modifiers (group_id, name, price_delta_cents, sort) VALUES (?, ?, ?, ?)')
    .run(b.group_id, b.name.trim(), b.price_delta_cents ?? 0, b.sort ?? 0);
  publish('menu');
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

menuRouter.patch('/modifiers/:id', requireRole('manager'), (req, res) => {
  const m = db.prepare('SELECT * FROM modifiers WHERE id = ?').get(req.params.id) as Modifier | undefined;
  if (!m) throw notFound();
  const b = req.body as Partial<Modifier>;
  db.prepare(
    'UPDATE modifiers SET name = ?, price_delta_cents = ?, sort = ?, active = ? WHERE id = ?',
  ).run(
    b.name?.trim() || m.name,
    b.price_delta_cents ?? m.price_delta_cents,
    b.sort ?? m.sort,
    b.active !== undefined ? (b.active ? 1 : 0) : m.active,
    m.id,
  );
  publish('menu');
  res.json({ ok: true });
});

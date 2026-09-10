import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { audit } from '../services/audit';
import type { OrderType, Promotion } from '../types';

export const promotionsRouter = Router();
promotionsRouter.use(requireAuth, requireRole('manager'));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_TYPES: OrderType[] = ['dine_in', 'takeaway', 'delivery'];

interface PromoBody {
  name?: string;
  active?: boolean;
  type?: 'percent' | 'amount';
  value?: number;
  scope?: 'order' | 'category' | 'item';
  category_id?: number | null;
  item_id?: number | null;
  days?: number[];
  start_time?: string | null;
  end_time?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  order_types?: OrderType[];
}

/** Validate and normalize a promotion payload (whole-object semantics). */
function validate(body: PromoBody) {
  const name = body.name?.trim();
  if (!name) throw badRequest('Promotion name required');
  if (body.type !== 'percent' && body.type !== 'amount') throw badRequest('type must be percent or amount');
  if (!Number.isInteger(body.value) || body.value! <= 0) throw badRequest('value must be a positive integer');
  if (body.type === 'percent' && body.value! > 100) throw badRequest('Percent promotions are 1-100');
  const scope = body.scope ?? 'order';
  if (!['order', 'category', 'item'].includes(scope)) throw badRequest('scope must be order, category or item');
  let categoryId: number | null = null;
  let itemId: number | null = null;
  if (scope === 'category') {
    if (!body.category_id || !db.prepare('SELECT id FROM categories WHERE id = ?').get(body.category_id)) {
      throw badRequest('A valid category_id is required for category scope');
    }
    categoryId = body.category_id;
  }
  if (scope === 'item') {
    if (!body.item_id || !db.prepare('SELECT id FROM items WHERE id = ?').get(body.item_id)) {
      throw badRequest('A valid item_id is required for item scope');
    }
    itemId = body.item_id;
  }
  const days = Array.isArray(body.days) && body.days.length > 0 ? body.days : [0, 1, 2, 3, 4, 5, 6];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw badRequest('days must be weekdays 0-6');
  const startTime = body.start_time?.trim() || null;
  const endTime = body.end_time?.trim() || null;
  if ((startTime === null) !== (endTime === null)) {
    throw badRequest('start_time and end_time must be set together');
  }
  if (startTime && (!TIME_RE.test(startTime) || !TIME_RE.test(endTime!))) {
    throw badRequest('Times must be HH:MM (24h)');
  }
  if (startTime && startTime === endTime) throw badRequest('Time window cannot be zero-length');
  const startsOn = body.starts_on?.trim() || null;
  const endsOn = body.ends_on?.trim() || null;
  if ((startsOn && !DATE_RE.test(startsOn)) || (endsOn && !DATE_RE.test(endsOn))) {
    throw badRequest('Dates must be YYYY-MM-DD');
  }
  if (startsOn && endsOn && endsOn < startsOn) throw badRequest('ends_on is before starts_on');
  const orderTypes =
    Array.isArray(body.order_types) && body.order_types.length > 0 ? body.order_types : ORDER_TYPES;
  if (orderTypes.some((t) => !ORDER_TYPES.includes(t))) throw badRequest('Invalid order type');
  return {
    name,
    active: body.active === undefined ? 1 : body.active ? 1 : 0,
    type: body.type,
    value: body.value!,
    scope,
    category_id: categoryId,
    item_id: itemId,
    days_json: JSON.stringify([...new Set(days)].sort()),
    start_time: startTime,
    end_time: endTime,
    starts_on: startsOn,
    ends_on: endsOn,
    order_types_json: JSON.stringify(orderTypes),
  };
}

function listPromos(): Promotion[] {
  return db
    .prepare(
      `SELECT p.*, c.name AS category_name, i.name AS item_name FROM promotions p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN items i ON i.id = p.item_id
       ORDER BY p.active DESC, p.id DESC`,
    )
    .all() as Promotion[];
}

promotionsRouter.get('/', (_req, res) => {
  res.json({ promotions: listPromos() });
});

promotionsRouter.post('/', (req: AuthedRequest, res) => {
  const v = validate(req.body as PromoBody);
  const id = Number(
    db
      .prepare(
        `INSERT INTO promotions (name, active, type, value, scope, category_id, item_id,
           days_json, start_time, end_time, starts_on, ends_on, order_types_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        v.name, v.active, v.type, v.value, v.scope, v.category_id, v.item_id,
        v.days_json, v.start_time, v.end_time, v.starts_on, v.ends_on, v.order_types_json,
      ).lastInsertRowid,
  );
  audit(req.user!.id, 'promo.create', { id, name: v.name });
  res.status(201).json({ promotions: listPromos(), id });
});

promotionsRouter.put('/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as Promotion | undefined;
  if (!existing) throw notFound('Promotion not found');
  // Allow a bare active toggle without resubmitting the whole form.
  const body = req.body as PromoBody;
  const merged: PromoBody = {
    name: body.name ?? existing.name,
    active: body.active ?? !!existing.active,
    type: body.type ?? existing.type,
    value: body.value ?? existing.value,
    scope: body.scope ?? existing.scope,
    category_id: body.category_id !== undefined ? body.category_id : existing.category_id,
    item_id: body.item_id !== undefined ? body.item_id : existing.item_id,
    days: body.days ?? (JSON.parse(existing.days_json) as number[]),
    start_time: body.start_time !== undefined ? body.start_time : existing.start_time,
    end_time: body.end_time !== undefined ? body.end_time : existing.end_time,
    starts_on: body.starts_on !== undefined ? body.starts_on : existing.starts_on,
    ends_on: body.ends_on !== undefined ? body.ends_on : existing.ends_on,
    order_types: body.order_types ?? (JSON.parse(existing.order_types_json) as OrderType[]),
  };
  const v = validate(merged);
  db.prepare(
    `UPDATE promotions SET name = ?, active = ?, type = ?, value = ?, scope = ?, category_id = ?,
       item_id = ?, days_json = ?, start_time = ?, end_time = ?, starts_on = ?, ends_on = ?,
       order_types_json = ? WHERE id = ?`,
  ).run(
    v.name, v.active, v.type, v.value, v.scope, v.category_id, v.item_id,
    v.days_json, v.start_time, v.end_time, v.starts_on, v.ends_on, v.order_types_json, id,
  );
  audit(req.user!.id, 'promo.update', { id, name: v.name, active: v.active });
  res.json({ promotions: listPromos() });
});

promotionsRouter.delete('/:id', (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as Promotion | undefined;
  if (!existing) throw notFound('Promotion not found');
  const used = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE promo_id = ?').get(id) as { n: number };
  if (used.n > 0) {
    throw conflict('This promotion was applied to past orders — deactivate it instead of deleting');
  }
  db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
  audit(req.user!.id, 'promo.delete', { id, name: existing.name });
  res.json({ promotions: listPromos() });
});

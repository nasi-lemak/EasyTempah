import { Router } from 'express';
import { db } from '../db/connection';
import { getBusinessSettings, getPlatformsSettings } from '../services/settings';

/**
 * Public collection board — a TV at the counter. Shows today's counter
 * orders (takeaway + delivery) as Preparing / Ready for collection, so
 * waiting customers and platform drivers can see their order's state
 * without asking staff. Deliberately public and deliberately minimal:
 * queue numbers, platform references and pager numbers only — never
 * names, phone numbers or amounts.
 */
export const boardRouter = Router();

interface BoardRow {
  id: number;
  order_no: string;
  type: string;
  platform: string | null;
  platform_ref: string | null;
  pager_no: number | null;
  cooking: number;
  ready: number;
}

boardRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.order_no, o.type, o.platform, o.platform_ref, o.pager_no,
        SUM(CASE WHEN oi.status IN ('sent','preparing') THEN 1 ELSE 0 END) AS cooking,
        SUM(CASE WHEN oi.status = 'ready' THEN 1 ELSE 0 END) AS ready
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.type IN ('takeaway','delivery') AND o.status != 'void'
         AND date(o.opened_at, 'localtime') = date('now', 'localtime')
         AND oi.status IN ('sent','preparing','ready')
         AND NOT EXISTS (SELECT 1 FROM order_items c WHERE c.parent_line_id = oi.id)
       GROUP BY o.id ORDER BY o.id`,
    )
    .all() as BoardRow[];
  const platformLabels = new Map(getPlatformsSettings().platforms.map((p) => [p.key, p.label]));
  const orders = rows.map((r) => ({
    id: r.id,
    queue: parseInt(r.order_no.slice(-4), 10) || null,
    platform: r.platform ? platformLabels.get(r.platform) ?? r.platform : null,
    platform_ref: r.platform ? r.platform_ref : null,
    pager_no: r.pager_no,
    state: r.cooking > 0 ? 'preparing' : 'ready',
  }));
  res.json({ business: getBusinessSettings().name, orders });
});

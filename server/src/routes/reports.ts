import { Router } from 'express';
import { db } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { getPlatformsSettings } from '../services/settings';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole('manager'));

function dateRange(req: { query: Record<string, unknown> }): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw badRequest('Dates must be YYYY-MM-DD');
  }
  return { from, to };
}

const PAID_IN_RANGE = `o.status = 'paid' AND date(o.closed_at, 'localtime') BETWEEN ? AND ?`;

reportsRouter.get('/summary', (req, res) => {
  const { from, to } = dateRange(req);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS gross_cents,
              COALESCE(SUM(o.discount_cents), 0) AS discounts_cents,
              COALESCE(SUM(o.promo_cents), 0) AS promos_cents,
              COALESCE(SUM(o.tax_cents), 0) AS tax_cents,
              COALESCE(SUM(o.service_cents), 0) AS service_cents,
              COALESCE(SUM(o.rounding_cents), 0) AS rounding_cents,
              COALESCE(SUM(o.covers), 0) AS covers
       FROM orders o WHERE ${PAID_IN_RANGE}`,
    )
    .get(from, to) as Record<string, number>;

  const voids = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o
       WHERE o.status = 'void' AND date(o.closed_at, 'localtime') BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };

  const byType = db
    .prepare(
      `SELECT o.type, COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE} GROUP BY o.type`,
    )
    .all(from, to);

  const refunds = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
       FROM refunds WHERE date(created_at, 'localtime') BETWEEN ? AND ?`,
    )
    .get(from, to) as { total: number; n: number };

  const platformCfg = getPlatformsSettings().platforms;
  const byPlatform = (
    db
      .prepare(
        `SELECT o.platform, COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS gross_cents
         FROM orders o WHERE ${PAID_IN_RANGE} AND o.platform IS NOT NULL
         GROUP BY o.platform ORDER BY gross_cents DESC`,
      )
      .all(from, to) as { platform: string; orders: number; gross_cents: number }[]
  ).map((row) => {
    const cfg = platformCfg.find((p) => p.key === row.platform);
    const commission = Math.round((row.gross_cents * (cfg?.commissionPct ?? 0)) / 100);
    return {
      ...row,
      label: cfg?.label ?? row.platform,
      commission_pct: cfg?.commissionPct ?? 0,
      est_commission_cents: commission,
      est_net_cents: row.gross_cents - commission,
    };
  });

  const avg = totals.orders > 0 ? Math.round(totals.gross_cents / totals.orders) : 0;
  res.json({
    from,
    to,
    ...totals,
    void_orders: voids.n,
    avg_order_cents: avg,
    refunds_cents: refunds.total,
    refund_count: refunds.n,
    net_cents: totals.gross_cents - refunds.total,
    by_type: byType,
    by_platform: byPlatform,
  });
});

reportsRouter.get('/items', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS total_cents
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE ${PAID_IN_RANGE} AND oi.status != 'cancelled'
       GROUP BY oi.name ORDER BY qty DESC LIMIT 50`,
    )
    .all(from, to);
  res.json({ from, to, items: rows });
});

reportsRouter.get('/payments', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT COALESCE(p.channel, p.method) AS method, COUNT(*) AS payments, SUM(p.amount_cents) AS total_cents
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE ${PAID_IN_RANGE}
       GROUP BY COALESCE(p.channel, p.method) ORDER BY total_cents DESC`,
    )
    .all(from, to);
  res.json({ from, to, payments: rows });
});

reportsRouter.get('/hourly', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT strftime('%H', o.closed_at, 'localtime') AS hour,
              COUNT(*) AS orders, SUM(o.total_cents) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE}
       GROUP BY hour ORDER BY hour`,
    )
    .all(from, to);
  res.json({ from, to, hours: rows });
});

/** Sales attribution per staff member: orders opened, payments taken, refunds given. */
reportsRouter.get('/cashiers', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT u.id, u.name,
        (SELECT COUNT(*) FROM orders o WHERE o.opened_by = u.id AND ${PAID_IN_RANGE.replace(/o\./g, 'o.')}) AS orders_opened,
        (SELECT COUNT(*) FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.user_id = u.id AND ${PAID_IN_RANGE}) AS payments_taken,
        (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.user_id = u.id AND ${PAID_IN_RANGE}) AS collected_cents,
        (SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r
          WHERE r.user_id = u.id AND date(r.created_at, 'localtime') BETWEEN ? AND ?) AS refunded_cents
       FROM users u
       ORDER BY collected_cents DESC`,
    )
    .all(from, to, from, to, from, to, from, to) as {
    id: number;
    name: string;
    orders_opened: number;
    payments_taken: number;
    collected_cents: number;
    refunded_cents: number;
  }[];
  res.json({ from, to, cashiers: rows.filter((r) => r.orders_opened || r.payments_taken || r.refunded_cents) });
});

// ---- CSV exports (for the accountant) ----

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

const rm = (cents: number | null) => ((cents ?? 0) / 100).toFixed(2);

reportsRouter.get('/export', (req, res) => {
  const { from, to } = dateRange(req);
  const kind = typeof req.query.type === 'string' ? req.query.type : 'orders';
  let rows: (string | number | null)[][];
  if (kind === 'orders') {
    const data = db
      .prepare(
        `SELECT o.*, t.name AS table_name, u.name AS opened_by_name,
          (SELECT GROUP_CONCAT(COALESCE(p.channel, p.method), ' + ') FROM payments p WHERE p.order_id = o.id) AS channels
         FROM orders o
         LEFT JOIN dining_tables t ON t.id = o.table_id
         LEFT JOIN users u ON u.id = o.opened_by
         WHERE o.status IN ('paid','void') AND date(COALESCE(o.closed_at, o.opened_at), 'localtime') BETWEEN ? AND ?
         ORDER BY o.id`,
      )
      .all(from, to) as (Record<string, string | number | null>)[];
    rows = [
      ['Order No', 'Opened', 'Closed', 'Type', 'Platform', 'Table', 'Status', 'Subtotal (RM)', 'Discount (RM)',
        'Promo', 'Promo (RM)', 'Service (RM)', 'Tax (RM)', 'Rounding (RM)', 'Total (RM)', 'Refunded (RM)',
        'Payment Channels', 'Opened By'],
      ...data.map((o) => [
        o.order_no, o.opened_at, o.closed_at, o.type, o.platform, o.table_name, o.status,
        rm(o.subtotal_cents as number), rm(o.discount_cents as number),
        o.promo_name, rm(o.promo_cents as number), rm(o.service_cents as number),
        rm(o.tax_cents as number), rm(o.rounding_cents as number), rm(o.total_cents as number),
        rm(o.refunded_cents as number), o.channels, o.opened_by_name,
      ]),
    ];
  } else if (kind === 'items') {
    const data = db
      .prepare(
        `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total_cents) AS total_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE ${PAID_IN_RANGE} AND oi.status != 'cancelled'
         GROUP BY oi.name ORDER BY total_cents DESC`,
      )
      .all(from, to) as { name: string; qty: number; total_cents: number }[];
    rows = [['Item', 'Qty Sold', 'Revenue (RM)'], ...data.map((i) => [i.name, i.qty, rm(i.total_cents)])];
  } else if (kind === 'payments') {
    const data = db
      .prepare(
        `SELECT p.created_at, o.order_no, COALESCE(p.channel, p.method) AS channel, p.amount_cents, p.reference, u.name AS cashier
         FROM payments p JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = p.user_id
         WHERE date(p.created_at, 'localtime') BETWEEN ? AND ? ORDER BY p.id`,
      )
      .all(from, to) as (Record<string, string | number | null>)[];
    rows = [
      ['When', 'Order No', 'Channel', 'Amount (RM)', 'Reference', 'Cashier'],
      ...data.map((p) => [p.created_at, p.order_no, p.channel, rm(p.amount_cents as number), p.reference, p.cashier]),
    ];
  } else {
    throw badRequest('type must be orders, items or payments');
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="easytempah-${kind}-${from}-to-${to}.csv"`);
  res.send('﻿' + csv(rows)); // BOM so Excel opens UTF-8 correctly
});

reportsRouter.get('/daily', (req, res) => {
  const { from, to } = dateRange(req);
  const rows = db
    .prepare(
      `SELECT date(o.closed_at, 'localtime') AS day,
              COUNT(*) AS orders, SUM(o.total_cents) AS total_cents
       FROM orders o WHERE ${PAID_IN_RANGE}
       GROUP BY day ORDER BY day`,
    )
    .all(from, to);
  res.json({ from, to, days: rows });
});

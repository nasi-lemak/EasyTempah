/**
 * E-invoice orchestration: create + submit + track LHDN MyInvois documents.
 *
 * Two document types:
 *  - invoice:      buyer-requested individual e-invoice for one paid order
 *  - consolidated: monthly roll-up of paid orders that were not individually
 *                  invoiced (LHDN's consolidated e-invoice for B2C receipts)
 */
import { db } from '../../db/connection';
import { badRequest, conflict, notFound } from '../../middleware/errors';
import type { EinvoiceBuyer, EinvoiceRow, Order } from '../../types';
import { audit } from '../audit';
import { getOrder } from '../orders';
import { getBusinessSettings, getEinvoiceSettings } from '../settings';
import { getDocumentDetails, portalUrl, submitDocument } from './client';
import { buildConsolidatedInvoice, buildOrderInvoice, type ConsolidatedOrder } from './ubl';

const TIN_RE = /^(C\d{10,11}|IG\d{10,12}|D\d{10,11}|E\d{10,11}|F\d{10,11}|EI\d{11})$/;
const ID_TYPES = ['BRN', 'NRIC', 'PASSPORT', 'ARMY'];

function requireConfigured() {
  const settings = getEinvoiceSettings();
  if (!settings.enabled) throw conflict('E-invoicing is not enabled in Settings');
  if (!settings.supplierTin) throw conflict('Supplier TIN is not configured in Settings');
  if (settings.environment !== 'mock' && (!settings.clientId || !settings.clientSecret)) {
    throw conflict('MyInvois client ID/secret are not configured');
  }
  return settings;
}

export function validateBuyer(buyer: Partial<EinvoiceBuyer>): EinvoiceBuyer {
  if (!buyer.name?.trim()) throw badRequest('Buyer name required');
  if (!buyer.tin?.trim() || !TIN_RE.test(buyer.tin.trim().toUpperCase())) {
    throw badRequest('Buyer TIN looks invalid (e.g. C1234567890 or IG1234567890)');
  }
  if (!buyer.idType || !ID_TYPES.includes(buyer.idType)) throw badRequest('Buyer ID type required');
  if (!buyer.idValue?.trim()) throw badRequest('Buyer registration/IC number required');
  return {
    tin: buyer.tin.trim().toUpperCase(),
    idType: buyer.idType,
    idValue: buyer.idValue.trim(),
    name: buyer.name.trim(),
    email: buyer.email?.trim() || undefined,
    phone: buyer.phone?.trim() || undefined,
    address: buyer.address?.trim() || undefined,
    sstNo: buyer.sstNo?.trim() || undefined,
  };
}

export function einvoiceWithPortal(row: EinvoiceRow) {
  const env = getEinvoiceSettings().environment;
  return {
    ...row,
    document_json: undefined, // heavy; fetch is internal-only
    portal_url: row.uuid && row.long_id ? portalUrl(env, row.uuid, row.long_id) : null,
  };
}

/** Submit stored document to LHDN and persist the outcome. */
async function submitRow(rowId: number): Promise<EinvoiceRow> {
  const settings = getEinvoiceSettings();
  const row = db.prepare('SELECT * FROM einvoices WHERE id = ?').get(rowId) as EinvoiceRow;
  try {
    const result = await submitDocument(settings, row.internal_id, row.document_json);
    if (!result.uuid) {
      db.prepare(
        `UPDATE einvoices SET status = 'invalid', submission_uid = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(result.submissionUid, result.rejectedReason ?? 'Rejected', rowId);
    } else {
      db.prepare(
        `UPDATE einvoices SET status = 'submitted', submission_uid = ?, uuid = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).run(result.submissionUid, result.uuid, rowId);
      await refreshRow(rowId); // mock validates instantly; real envs usually need a later refresh
    }
  } catch (err) {
    db.prepare(
      `UPDATE einvoices SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(err instanceof Error ? err.message : String(err), rowId);
  }
  return db.prepare('SELECT * FROM einvoices WHERE id = ?').get(rowId) as EinvoiceRow;
}

export async function refreshRow(rowId: number): Promise<EinvoiceRow> {
  const settings = getEinvoiceSettings();
  const row = db.prepare('SELECT * FROM einvoices WHERE id = ?').get(rowId) as EinvoiceRow | undefined;
  if (!row) throw notFound('E-invoice not found');
  if (row.uuid && ['submitted', 'valid'].includes(row.status)) {
    try {
      const details = await getDocumentDetails(settings, row.uuid);
      if (details.status === 'Valid') {
        db.prepare(
          `UPDATE einvoices SET status = 'valid', long_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
        ).run(details.longId, rowId);
      } else if (details.status === 'Invalid') {
        db.prepare(
          `UPDATE einvoices SET status = 'invalid', error = ?, updated_at = datetime('now') WHERE id = ?`,
        ).run(details.error ?? 'Marked invalid by MyInvois', rowId);
        clearOrderLinks(rowId);
      }
    } catch (err) {
      // Status check failures are transient; keep current status but record the error.
      db.prepare(`UPDATE einvoices SET error = ?, updated_at = datetime('now') WHERE id = ?`).run(
        err instanceof Error ? err.message : String(err),
        rowId,
      );
    }
  }
  return db.prepare('SELECT * FROM einvoices WHERE id = ?').get(rowId) as EinvoiceRow;
}

function clearOrderLinks(einvoiceId: number): void {
  db.prepare('UPDATE orders SET einvoice_id = NULL WHERE einvoice_id = ?').run(einvoiceId);
}

export async function createOrderEinvoice(
  orderId: number,
  buyerInput: Partial<EinvoiceBuyer>,
  userId: number,
): Promise<EinvoiceRow> {
  const settings = requireConfigured();
  const order = getOrder(orderId);
  if (order.status !== 'paid') throw conflict('Only paid orders can be e-invoiced');
  if (order.platform) {
    throw conflict('Platform delivery orders are e-invoiced by the platform (e.g. GrabFood), not the merchant');
  }
  const existing = db
    .prepare("SELECT * FROM einvoices WHERE order_id = ? AND status IN ('pending','submitted','valid')")
    .get(orderId) as EinvoiceRow | undefined;
  if (existing) throw conflict(`Order already has an e-invoice (status: ${existing.status})`);

  const buyer = validateBuyer(buyerInput);
  const business = getBusinessSettings();
  const internalId = `EINV-${order.order_no}`;
  const document = buildOrderInvoice(order, buyer, settings, business.name, internalId);

  const info = db
    .prepare(
      `INSERT INTO einvoices (order_id, type, buyer_json, document_json, internal_id, total_cents, created_by)
       VALUES (?, 'invoice', ?, ?, ?, ?, ?)`,
    )
    .run(orderId, JSON.stringify(buyer), JSON.stringify(document), internalId, order.total_cents, userId);
  const rowId = Number(info.lastInsertRowid);
  db.prepare('UPDATE orders SET einvoice_id = ? WHERE id = ?').run(rowId, orderId);
  audit(userId, 'einvoice.create', { orderId, buyerTin: buyer.tin });

  const row = await submitRow(rowId);
  if (['invalid', 'error'].includes(row.status)) clearOrderLinks(rowId);
  return row;
}

export async function createConsolidatedEinvoice(period: string, userId: number): Promise<EinvoiceRow> {
  const settings = requireConfigured();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('Period must be YYYY-MM');
  const existing = db
    .prepare(
      "SELECT * FROM einvoices WHERE type = 'consolidated' AND period = ? AND status IN ('pending','submitted','valid')",
    )
    .get(period) as EinvoiceRow | undefined;
  if (existing) throw conflict(`A consolidated e-invoice for ${period} already exists (status: ${existing.status})`);

  // Platform orders (GrabFood etc.) are excluded: the platform issues those
  // e-invoices — consolidating them here would report the sale to LHDN twice.
  const orders = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'paid' AND einvoice_id IS NULL AND platform IS NULL
         AND strftime('%Y-%m', closed_at, 'localtime') = ?
       ORDER BY id`,
    )
    .all(period) as Order[];
  if (!orders.length) throw conflict(`No un-invoiced paid orders found for ${period}`);

  const business = getBusinessSettings();
  const internalId = `CONS-${period}`;
  const lines: ConsolidatedOrder[] = orders.map((o) => ({
    order_no: o.order_no,
    taxExclusiveCents: o.subtotal_cents - o.discount_cents + o.service_cents,
    taxCents: o.tax_cents,
    roundingCents: o.rounding_cents,
    totalCents: o.total_cents,
  }));
  const document = buildConsolidatedInvoice(lines, period, settings, business.name, internalId);
  const totalCents = orders.reduce((s, o) => s + o.total_cents, 0);

  const info = db
    .prepare(
      `INSERT INTO einvoices (order_id, type, document_json, internal_id, period, total_cents, created_by)
       VALUES (NULL, 'consolidated', ?, ?, ?, ?, ?)`,
    )
    .run(JSON.stringify(document), internalId, period, totalCents, userId);
  const rowId = Number(info.lastInsertRowid);
  db.prepare(
    `UPDATE orders SET einvoice_id = ? WHERE id IN (${orders.map(() => '?').join(',')})`,
  ).run(rowId, ...orders.map((o) => o.id));
  audit(userId, 'einvoice.consolidate', { period, orders: orders.length, totalCents });

  const row = await submitRow(rowId);
  if (['invalid', 'error'].includes(row.status)) clearOrderLinks(rowId);
  return row;
}

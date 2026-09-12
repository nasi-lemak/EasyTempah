/**
 * Delivers ESC/POS documents to network thermal printers over TCP ("raw 9100").
 * Kitchen printing is fire-and-forget from the order flow — a dead printer must
 * never block an order — while explicit prints (receipt, test) surface errors.
 */
import net from 'net';
import { db } from '../db/connection';
import { ApiError } from '../middleware/errors';
import { portalUrl } from './einvoice/client';
import { renderKitchenTicket, renderReceipt, renderShiftReport, EscPos, type TicketLine } from './escpos';
import { summarize } from '../routes/shifts';
import type { Shift } from '../types';
import { parseLogoDataUrl, pngToRaster } from './logo';
import { getOrder } from './orders';
import { makeLabels } from './receiptLang';
import {
  getBusinessSettings,
  getEinvoiceSettings,
  getLogoDataUrl,
  getPrintersSettings, getStationsSettings, stationPrinter,
  getReceiptsSettings,
  getTaxSettings,
} from './settings';
import type { OrderItemModifierSnapshot, PrinterTarget, Station } from '../types';

const SEND_TIMEOUT_MS = 5000;

export function sendToPrinter(target: PrinterTarget, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const fail = (err: Error) => {
      socket.destroy();
      reject(new ApiError(502, `Printer ${target.host}:${target.port} — ${err.message}`));
    };
    socket.setTimeout(SEND_TIMEOUT_MS, () => fail(new Error('connection timed out')));
    socket.on('error', fail);
    socket.on('connect', () => {
      socket.end(data, () => resolve());
    });
  });
}

export async function printReceipt(orderId: number, opts: { drawer?: boolean } = {}): Promise<void> {
  const printers = getPrintersSettings();
  if (!printers.receipt.enabled) throw new ApiError(409, 'Receipt printer is not enabled in Settings');
  const order = getOrder(orderId);
  // Mirror the on-screen receipt: attach the validated e-invoice (UUID + portal QR).
  let einvoice = null;
  const row = db
    .prepare(
      "SELECT status, uuid, long_id FROM einvoices WHERE order_id = ? AND status IN ('submitted','valid') ORDER BY id DESC LIMIT 1",
    )
    .get(orderId) as { status: string; uuid: string | null; long_id: string | null } | undefined;
  if (row?.uuid) {
    einvoice = {
      status: row.status,
      uuid: row.uuid,
      portal_url: row.long_id ? portalUrl(getEinvoiceSettings().environment, row.uuid, row.long_id) : null,
    };
  }
  const receipts = getReceiptsSettings();
  let logo = null;
  const logoUrl = getLogoDataUrl();
  if (logoUrl) {
    try {
      logo = pngToRaster(parseLogoDataUrl(logoUrl));
    } catch (err) {
      console.error('Receipt logo could not be rasterized:', err instanceof Error ? err.message : err);
    }
  }
  const doc = renderReceipt(order, getBusinessSettings(), getTaxSettings(), {
    drawerKick: (opts.drawer ?? false) && printers.receipt.drawerKick,
    einvoice,
    labels: makeLabels(receipts.langPrimary, receipts.langSecondary),
    charset: printers.receipt.charset ?? 'ascii',
    logo,
  });
  await sendToPrinter(printers.receipt, doc);
}

/** Print just-fired lines to their stations' printers. Never throws — order flow must not block. */
export async function printKitchenTickets(orderId: number, lineIds: number[]): Promise<void> {
  if (lineIds.length === 0) return;
  try {
    const printers = getPrintersSettings();
    const stationDefs = getStationsSettings().list;
    if (!stationDefs.some((st) => stationPrinter(printers, st.key).enabled)) return;

    const order = getOrder(orderId);
    // A set meal prints its components, not the bundle parent line.
    const parentIds = new Set(order.items.filter((l) => l.parent_line_id).map((l) => l.parent_line_id));
    const idSet = new Set(lineIds.filter((id) => !parentIds.has(id)));
    const where =
      order.type === 'dine_in' ? `Table ${order.table_name ?? ''}` : order.type.replace('_', ' ');

    for (const { key: station, label } of stationDefs) {
      const target = stationPrinter(printers, station);
      if (!target.enabled) continue;
      const lines: TicketLine[] = order.items
        .filter((l) => idSet.has(l.id) && l.station === station)
        .map((l) => ({
          qty: l.qty,
          name: l.name,
          modifiers: (JSON.parse(l.modifiers_json) as OrderItemModifierSnapshot[]).map((m) => m.name),
          notes: l.notes,
          source: l.source,
        }));
      if (!lines.length) continue;
      const doc = renderKitchenTicket({
        station: label,
        order_no: order.order_no,
        where,
        order_notes: order.notes,
        pager_no: order.pager_no,
        lines,
        charset: target.charset ?? 'ascii',
      });
      await sendToPrinter(target, doc);
    }
  } catch (err) {
    console.error(`Kitchen ticket print failed for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

/** X/Z shift report to the receipt printer (X while open, Z once closed). */
export async function printShiftReport(shiftId: number): Promise<void> {
  const printers = getPrintersSettings();
  if (!printers.receipt.enabled) throw new ApiError(409, 'Receipt printer is not enabled in Settings');
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as Shift | undefined;
  if (!shift) throw new ApiError(404, 'Shift not found');
  const doc = renderShiftReport({
    shift,
    summary: summarize(shift),
    business: getBusinessSettings(),
    charset: printers.receipt.charset ?? 'ascii',
  });
  await sendToPrinter(printers.receipt, doc);
}

export async function testPrint(which: string): Promise<void> {
  const printers = getPrintersSettings();
  const target = which === 'receipt' ? printers.receipt : stationPrinter(printers, which);
  if (!target.enabled) throw new ApiError(409, `${which} printer is not enabled`);
  const business = getBusinessSettings();
  const doc = new EscPos()
    .init()
    .align('center')
    .bold(true)
    .size(2)
    .line(business.name)
    .size(1)
    .bold(false)
    .line(`${which.toUpperCase()} printer test`)
    .line(new Date().toLocaleString('en-MY', { hour12: false }))
    .feed(3)
    .cut()
    .build();
  await sendToPrinter(target, doc);
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (NULL, ?, ?)').run(
    'printer.test',
    JSON.stringify({ which, host: target.host, port: target.port }),
  );
}

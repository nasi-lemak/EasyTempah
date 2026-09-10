/**
 * Delivers ESC/POS documents to network thermal printers over TCP ("raw 9100").
 * Kitchen printing is fire-and-forget from the order flow — a dead printer must
 * never block an order — while explicit prints (receipt, test) surface errors.
 */
import net from 'net';
import { db } from '../db/connection';
import { ApiError } from '../middleware/errors';
import { portalUrl } from './einvoice/client';
import { renderKitchenTicket, renderReceipt, EscPos, type TicketLine } from './escpos';
import { getOrder } from './orders';
import { getBusinessSettings, getEinvoiceSettings, getPrintersSettings, getTaxSettings } from './settings';
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
  const doc = renderReceipt(order, getBusinessSettings(), getTaxSettings(), {
    drawerKick: (opts.drawer ?? false) && printers.receipt.drawerKick,
    einvoice,
  });
  await sendToPrinter(printers.receipt, doc);
}

/** Print just-fired lines to their stations' printers. Never throws — order flow must not block. */
export async function printKitchenTickets(orderId: number, lineIds: number[]): Promise<void> {
  if (lineIds.length === 0) return;
  try {
    const printers = getPrintersSettings();
    const stations: Station[] = ['kitchen', 'bar'];
    if (!stations.some((s) => printers[s].enabled)) return;

    const order = getOrder(orderId);
    // A set meal prints its components, not the bundle parent line.
    const parentIds = new Set(order.items.filter((l) => l.parent_line_id).map((l) => l.parent_line_id));
    const idSet = new Set(lineIds.filter((id) => !parentIds.has(id)));
    const where =
      order.type === 'dine_in' ? `Table ${order.table_name ?? ''}` : order.type.replace('_', ' ');

    for (const station of stations) {
      if (!printers[station].enabled) continue;
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
        station,
        order_no: order.order_no,
        where,
        order_notes: order.notes,
        lines,
      });
      await sendToPrinter(printers[station], doc);
    }
  } catch (err) {
    console.error(`Kitchen ticket print failed for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

export async function testPrint(which: 'receipt' | 'kitchen' | 'bar'): Promise<void> {
  const printers = getPrintersSettings();
  const target = printers[which];
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

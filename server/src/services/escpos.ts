/**
 * ESC/POS document encoder for 80 mm thermal printers (42 columns, font A).
 * Pure byte-building — no I/O — so it is unit-testable; printer.ts does the TCP.
 */
import type { OrderItemModifierSnapshot, TaxSettings } from '../types';
import type { OrderWithLines } from './orders';
import type { BusinessSettings } from '../types';

const ESC = 0x1b;
const GS = 0x1d;

export const COLS = 42;

export class EscPos {
  private chunks: Buffer[] = [];

  raw(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /**
   * Thermal firmwares vary in codepage support; stick to printable ASCII.
   * Accented Latin characters transliterate (Café → Cafe) rather than degrade to '?'.
   */
  text(s: string): this {
    const ascii = s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e\n]/g, '?');
    this.chunks.push(Buffer.from(ascii, 'ascii'));
    return this;
  }

  line(s = ''): this {
    return this.text(s + '\n');
  }

  init(): this {
    return this.raw(ESC, 0x40);
  }

  align(where: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, where === 'center' ? 1 : where === 'right' ? 2 : 0);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** 1 = normal, 2 = double width & height. */
  size(mult: 1 | 2): this {
    return this.raw(GS, 0x21, mult === 2 ? 0x11 : 0x00);
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, lines);
  }

  /** Partial cut with feed. */
  cut(): this {
    return this.raw(GS, 0x56, 66, 3);
  }

  /** Kick cash drawer on pin 2. */
  drawerKick(): this {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }

  rule(char = '-'): this {
    return this.line(char.repeat(COLS));
  }

  /** Native QR code (GS ( k, model 2). Data must be ASCII — fine for URLs. */
  qr(data: string, moduleSize = 5): this {
    const bytes = Buffer.from(data, 'ascii');
    this.raw(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 67, moduleSize); // module size in dots
    this.raw(GS, 0x28, 0x6b, 3, 0, 49, 69, 49); // error correction M
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48); // store
    this.chunks.push(bytes);
    return this.raw(GS, 0x28, 0x6b, 3, 0, 49, 81, 48); // print
  }

  /** Left text and right-aligned value on one 42-column row (left wraps). */
  cols(left: string, right: string): this {
    const rightW = right.length;
    const leftW = COLS - rightW - 1;
    if (left.length <= leftW) {
      return this.line(left.padEnd(leftW) + ' ' + right);
    }
    const head = left.slice(0, leftW);
    this.line(head.padEnd(leftW) + ' ' + right);
    let rest = left.slice(leftW);
    while (rest.length > 0) {
      this.line('  ' + rest.slice(0, COLS - 2));
      rest = rest.slice(COLS - 2);
    }
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function rm(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export interface ReceiptEinvoiceInfo {
  status: string;
  uuid: string;
  portal_url: string | null;
}

export function renderReceipt(
  order: OrderWithLines,
  business: BusinessSettings,
  tax: TaxSettings,
  opts: { drawerKick?: boolean; einvoice?: ReceiptEinvoiceInfo | null } = {},
): Buffer {
  const p = new EscPos().init();
  if (opts.drawerKick) p.drawerKick();
  const sym = business.currencySymbol + ' ';

  p.align('center').bold(true).size(2).line(business.name).size(1).bold(false);
  if (business.address) p.line(business.address);
  if (business.phone) p.line(business.phone);
  if (business.registrationNo) p.line(`Reg: ${business.registrationNo}`);
  p.align('left').rule();

  const where =
    order.type === 'dine_in' ? `Table ${order.table_name ?? ''}` : order.type.replace('_', ' ');
  p.cols(`#${order.order_no}`, where);
  p.cols(new Date().toLocaleString('en-MY', { hour12: false }), order.opened_by_name ?? '');
  p.rule();

  for (const line of order.items) {
    if (line.status === 'cancelled' || line.parent_line_id) continue;
    p.cols(`${line.qty} x ${line.name}`, rm(line.line_total_cents, sym));
    const mods = JSON.parse(line.modifiers_json) as OrderItemModifierSnapshot[];
    for (const m of mods) {
      p.cols(`   + ${m.name}`, m.price_delta_cents ? rm(m.price_delta_cents * line.qty, sym) : '');
    }
    if (line.notes) p.line(`   >> ${line.notes}`);
  }
  p.rule();

  p.cols('Subtotal', rm(order.subtotal_cents, sym));
  if (order.discount_cents > 0) p.cols('Discount', '-' + rm(order.discount_cents, sym));
  if (order.promo_cents > 0) p.cols(order.promo_name ?? 'Promo', '-' + rm(order.promo_cents, sym));
  if (order.service_cents > 0) p.cols(tax.serviceLabel, rm(order.service_cents, sym));
  if (order.tax_cents > 0) p.cols(tax.taxLabel, rm(order.tax_cents, sym));
  if (order.rounding_cents !== 0) p.cols('Rounding', rm(order.rounding_cents, sym));
  p.bold(true).size(2).cols('TOTAL', rm(order.total_cents, sym)).size(1).bold(false);
  p.rule();

  for (const pay of order.payments) {
    p.cols((pay.channel ?? pay.method.toUpperCase()) + (pay.reference ? ` (${pay.reference})` : ''), rm(pay.amount_cents, sym));
    if (pay.method === 'cash' && pay.tendered_cents != null) {
      p.cols('  Tendered', rm(pay.tendered_cents, sym));
      p.cols('  Change', rm(pay.change_cents ?? 0, sym));
    }
  }
  for (const r of order.refunds ?? []) {
    p.cols(`REFUND (${r.method}) ${r.reason}`, '-' + rm(r.amount_cents, sym));
  }

  if (order.customer_id) {
    const tail = (order.customer_phone ?? '').slice(-4);
    p.cols(`Member ...${tail}`, order.points_earned > 0 ? `+${order.points_earned} pts` : '');
    if (order.customer_points != null) p.cols('Points balance', `${order.customer_points} pts`);
  }

  p.align('center').feed(1).line(business.receiptFooter);
  if (opts.einvoice) {
    p.align('left').rule();
    p.align('center').bold(true).line(`LHDN e-Invoice (${opts.einvoice.status})`).bold(false);
    p.line(opts.einvoice.uuid);
    if (opts.einvoice.portal_url) p.feed(1).qr(opts.einvoice.portal_url);
  }
  p.align('center').feed(3).cut();
  return p.build();
}

export interface TicketLine {
  qty: number;
  name: string;
  modifiers: string[];
  notes: string | null;
  source: 'staff' | 'guest';
}

export function renderKitchenTicket(info: {
  station: string;
  order_no: string;
  where: string; // "Table T3" / "takeaway"
  lines: TicketLine[];
  order_notes?: string | null;
}): Buffer {
  const p = new EscPos().init();
  p.align('center').bold(true).size(2).line(info.where).size(1).bold(false);
  p.line(`#${info.order_no}  [${info.station.toUpperCase()}]`);
  p.line(new Date().toLocaleTimeString('en-MY', { hour12: false }));
  p.align('left').rule('=');
  if (info.order_notes) p.bold(true).line(`>> ${info.order_notes}`).bold(false).rule();
  for (const line of info.lines) {
    p.bold(true).size(2).line(`${line.qty} x ${line.name}${line.source === 'guest' ? ' [QR]' : ''}`).size(1).bold(false);
    for (const m of line.modifiers) p.line(`   + ${m}`);
    if (line.notes) p.bold(true).line(`   >> ${line.notes}`).bold(false);
  }
  p.rule('=').feed(3).cut();
  return p.build();
}

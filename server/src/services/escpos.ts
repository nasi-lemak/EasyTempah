/**
 * ESC/POS document encoder for 80 mm thermal printers (42 columns, font A).
 * Pure byte-building — no I/O — so it is unit-testable; printer.ts does the TCP.
 *
 * Charsets: 'ascii' (default, safest across firmwares) transliterates accented
 * Latin (Café → Cafe) and degrades the rest to '?'. 'gbk' targets printers
 * with Chinese firmware: CJK text is encoded GBK with the printer's Kanji
 * mode enabled, and column math treats CJK glyphs as double-width so aligned
 * money columns stay aligned.
 */
import iconv from 'iconv-lite';
import type { OrderItemModifierSnapshot, TaxSettings } from '../types';
import type { OrderWithLines } from './orders';
import type { BusinessSettings } from '../types';
import { makeLabels, type ReceiptLabels } from './receiptLang';

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

export const COLS = 42;

export type PrinterCharset = 'ascii' | 'gbk';

/** Display width of a string on the printer: CJK and fullwidth glyphs take 2 columns. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += isWide(ch) ? 2 : 1;
  return w;
}

function isWide(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
    (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
    (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // CJK compat ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
    (c >= 0xff00 && c <= 0xff60) || // Fullwidth forms
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

export class EscPos {
  private chunks: Buffer[] = [];
  private charset: PrinterCharset;

  constructor(charset: PrinterCharset = 'ascii') {
    this.charset = charset;
  }

  raw(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /**
   * Accented Latin transliterates (Café → Cafe) in both charsets; beyond that,
   * 'ascii' degrades to '?' while 'gbk' encodes CJK for Chinese firmwares.
   */
  text(s: string): this {
    const latin = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (this.charset === 'gbk') {
      this.chunks.push(iconv.encode(latin.replace(/[^\x20-\x7e\n\u2e80-\uffe6]/g, '?'), 'gbk'));
    } else {
      this.chunks.push(Buffer.from(latin.replace(/[^\x20-\x7e\n]/g, '?'), 'ascii'));
    }
    return this;
  }

  line(s = ''): this {
    return this.text(s + '\n');
  }

  init(): this {
    this.raw(ESC, 0x40);
    if (this.charset === 'gbk') this.raw(FS, 0x26); // enable Kanji/Chinese mode
    return this;
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

  /**
   * Raster bit image (GS v 0). `rows` is packed 1-bit data, MSB first,
   * `bytesPerRow` bytes per scanline, `height` scanlines. 1 = black dot.
   */
  raster(bytesPerRow: number, height: number, rows: Buffer): this {
    this.raw(
      GS, 0x76, 0x30, 0,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    );
    this.chunks.push(rows);
    return this;
  }

  /** Left text and right-aligned value on one 42-column row (left wraps). */
  cols(left: string, right: string): this {
    const rightW = displayWidth(right);
    const leftW = COLS - rightW - 1;
    if (displayWidth(left) <= leftW) {
      return this.line(left + ' '.repeat(leftW - displayWidth(left)) + ' ' + right);
    }
    const [head, rest0] = splitAtWidth(left, leftW);
    this.line(head + ' '.repeat(leftW - displayWidth(head)) + ' ' + right);
    let rest = rest0;
    while (rest.length > 0) {
      const [chunk, next] = splitAtWidth(rest, COLS - 2);
      this.line('  ' + chunk);
      rest = next;
    }
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Split so the first part's display width is at most `width`. */
function splitAtWidth(s: string, width: number): [string, string] {
  let w = 0;
  let i = 0;
  const chars = [...s];
  for (; i < chars.length; i++) {
    const cw = isWide(chars[i]) ? 2 : 1;
    if (w + cw > width) break;
    w += cw;
  }
  return [chars.slice(0, i).join(''), chars.slice(i).join('')];
}

function rm(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export interface ReceiptEinvoiceInfo {
  status: string;
  uuid: string;
  portal_url: string | null;
}

export interface ReceiptLogo {
  bytesPerRow: number;
  height: number;
  rows: Buffer;
}

export interface RenderReceiptOpts {
  drawerKick?: boolean;
  einvoice?: ReceiptEinvoiceInfo | null;
  labels?: ReceiptLabels;
  charset?: PrinterCharset;
  logo?: ReceiptLogo | null;
}

export function renderReceipt(
  order: OrderWithLines,
  business: BusinessSettings,
  tax: TaxSettings,
  opts: RenderReceiptOpts = {},
): Buffer {
  const L = opts.labels ?? makeLabels('en');
  const p = new EscPos(opts.charset ?? 'ascii').init();
  if (opts.drawerKick) p.drawerKick();
  const sym = business.currencySymbol + ' ';

  p.align('center');
  if (opts.logo) p.raster(opts.logo.bytesPerRow, opts.logo.height, opts.logo.rows).feed(1);
  p.bold(true).size(2).line(business.name).size(1).bold(false);
  if (business.address) p.line(business.address);
  if (business.phone) p.line(business.phone);
  if (business.registrationNo) p.line(`${L.reg_no}: ${business.registrationNo}`);
  p.align('left').rule();

  const where =
    order.type === 'dine_in'
      ? `${L.table} ${order.table_name ?? ''}`
      : order.type === 'takeaway'
        ? L.takeaway
        : L.delivery;
  p.cols(`#${order.order_no}`, where);
  if (order.type === 'takeaway') {
    // Big queue number so counter staff can call the order.
    const queue = String(parseInt(order.order_no.split('-')[1] ?? '0', 10) || 0);
    p.align('center').bold(true).size(2).line(`${L.queue} ${queue}`).size(1).bold(false).align('left');
  }
  if (order.receipt_no) p.cols(`${L.receipt_no}:`, order.receipt_no);
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

  p.cols(L.subtotal, rm(order.subtotal_cents, sym));
  if (order.discount_cents > 0) p.cols(L.discount, '-' + rm(order.discount_cents, sym));
  if (order.promo_cents > 0) p.cols(order.promo_name ?? 'Promo', '-' + rm(order.promo_cents, sym));
  if (order.service_cents > 0) p.cols(tax.serviceLabel, rm(order.service_cents, sym));
  if (order.tax_cents > 0) p.cols(tax.taxLabel, rm(order.tax_cents, sym));
  if (order.rounding_cents !== 0) p.cols(L.rounding, rm(order.rounding_cents, sym));
  p.bold(true).size(2).cols(L.total, rm(order.total_cents, sym)).size(1).bold(false);
  p.rule();

  for (const pay of order.payments) {
    p.cols((pay.channel ?? pay.method.toUpperCase()) + (pay.reference ? ` (${pay.reference})` : ''), rm(pay.amount_cents, sym));
    if (pay.method === 'cash' && pay.tendered_cents != null) {
      p.cols(`  ${L.tendered}`, rm(pay.tendered_cents, sym));
      p.cols(`  ${L.change}`, rm(pay.change_cents ?? 0, sym));
    }
  }
  for (const r of order.refunds ?? []) {
    p.cols(`${L.refund} (${r.method}) ${r.reason}`, '-' + rm(r.amount_cents, sym));
  }

  if (order.customer_id) {
    const tail = (order.customer_phone ?? '').slice(-4);
    p.cols(`${L.member} ...${tail}`, order.points_earned > 0 ? `+${order.points_earned} pts` : '');
    if (order.customer_points != null) p.cols(L.points_balance, `${order.customer_points} pts`);
  }

  p.align('center').feed(1).line(business.receiptFooter);
  if (opts.einvoice) {
    p.align('left').rule();
    p.align('center').bold(true).line(`${L.einvoice} (${opts.einvoice.status})`).bold(false);
    p.line(opts.einvoice.uuid);
    if (opts.einvoice.portal_url) p.feed(1).qr(opts.einvoice.portal_url);
  }
  p.align('center').feed(3).cut();
  return p.build();
}

/**
 * Shift report slip: X while the shift is open, Z at close. Sales by channel
 * and cashier, drawer math, refunds — the slip that goes in the cash bag.
 */
export function renderShiftReport(info: {
  shift: {
    id: number;
    status: string;
    opened_at: string;
    closed_at: string | null;
    opening_float_cents: number;
    counted_cash_cents: number | null;
    variance_cents: number | null;
  };
  summary: {
    total_sales_cents: number;
    cash_sales_cents: number;
    orders_paid: number;
    cash_in_cents: number;
    cash_out_cents: number;
    refunds_cents: number;
    cash_refunds_cents: number;
    expected_cash_cents: number;
    by_channel: { channel: string; payments: number; amount_cents: number }[];
    by_cashier: { name: string; payments: number; amount_cents: number }[];
  };
  business: BusinessSettings;
  charset?: PrinterCharset;
}): Buffer {
  const { shift, summary, business } = info;
  const sym = business.currencySymbol + ' ';
  const kind = shift.status === 'closed' ? 'Z REPORT (shift closed)' : 'X REPORT (shift open)';
  const p = new EscPos(info.charset ?? 'ascii').init();
  p.align('center').bold(true).size(2).line(business.name).size(1).bold(false);
  p.line(kind).line(`Shift #${shift.id}`);
  p.line(`${shift.opened_at} -> ${shift.closed_at ?? 'now'}`);
  p.align('left').rule('=');

  p.cols('Orders paid', String(summary.orders_paid));
  p.bold(true).cols('Total sales', rm(summary.total_sales_cents, sym)).bold(false);
  p.rule();
  p.line('Sales by channel');
  for (const c of summary.by_channel) p.cols(`  ${c.channel} (${c.payments}x)`, rm(c.amount_cents, sym));
  if (summary.by_cashier.length > 1) {
    p.rule();
    p.line('By cashier');
    for (const c of summary.by_cashier) p.cols(`  ${c.name} (${c.payments}x)`, rm(c.amount_cents, sym));
  }
  p.rule();
  p.line('Drawer');
  p.cols('  Opening float', rm(shift.opening_float_cents, sym));
  p.cols('  Cash sales', rm(summary.cash_sales_cents, sym));
  if (summary.cash_in_cents) p.cols('  Paid in', rm(summary.cash_in_cents, sym));
  if (summary.cash_out_cents) p.cols('  Paid out', '-' + rm(summary.cash_out_cents, sym));
  if (summary.cash_refunds_cents) p.cols('  Cash refunds', '-' + rm(summary.cash_refunds_cents, sym));
  p.bold(true).cols('  Expected in drawer', rm(summary.expected_cash_cents, sym)).bold(false);
  if (shift.counted_cash_cents != null) {
    p.cols('  Counted', rm(shift.counted_cash_cents, sym));
    p.bold(true).cols('  VARIANCE', rm(shift.variance_cents ?? 0, sym)).bold(false);
  }
  if (summary.refunds_cents) {
    p.rule();
    p.cols('Refunds (all methods)', '-' + rm(summary.refunds_cents, sym));
  }
  p.rule('=');
  p.align('center').line(`Printed ${new Date().toLocaleString('en-MY', { hour12: false })}`);
  p.feed(3).cut();
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
  pager_no?: number | null;
  charset?: PrinterCharset;
}): Buffer {
  const p = new EscPos(info.charset ?? 'ascii').init();
  p.align('center').bold(true).size(2).line(info.where).size(1).bold(false);
  if (info.pager_no != null) p.bold(true).size(2).line(`PAGER ${info.pager_no}`).size(1).bold(false);
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

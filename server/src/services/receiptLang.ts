/**
 * Receipt label translations. The business picks a primary and an optional
 * secondary language to match its audience (e.g. a Chinese restaurant may
 * choose 中文 primary + English secondary and skip Malay entirely); labels
 * render as "primary / secondary". Menu item names, tax/service labels and
 * the footer are operator-entered text and print as written.
 */

export type ReceiptLang = 'en' | 'ms' | 'zh';

export const RECEIPT_LANGS: ReceiptLang[] = ['en', 'ms', 'zh'];

export type LabelKey =
  | 'receipt_no'
  | 'order_no'
  | 'table'
  | 'takeaway'
  | 'delivery'
  | 'subtotal'
  | 'discount'
  | 'rounding'
  | 'total'
  | 'tendered'
  | 'change'
  | 'member'
  | 'points_balance'
  | 'refund'
  | 'reg_no'
  | 'einvoice';

const STRINGS: Record<ReceiptLang, Record<LabelKey, string>> = {
  en: {
    receipt_no: 'Receipt No',
    order_no: 'Order',
    table: 'Table',
    takeaway: 'Takeaway',
    delivery: 'Delivery',
    subtotal: 'Subtotal',
    discount: 'Discount',
    rounding: 'Rounding',
    total: 'TOTAL',
    tendered: 'Tendered',
    change: 'Change',
    member: 'Member',
    points_balance: 'Points balance',
    refund: 'REFUND',
    reg_no: 'Reg',
    einvoice: 'LHDN e-Invoice',
  },
  ms: {
    receipt_no: 'No. Resit',
    order_no: 'Pesanan',
    table: 'Meja',
    takeaway: 'Bungkus',
    delivery: 'Penghantaran',
    subtotal: 'Jumlah Kecil',
    discount: 'Diskaun',
    rounding: 'Pembundaran',
    total: 'JUMLAH',
    tendered: 'Diterima',
    change: 'Baki',
    member: 'Ahli',
    points_balance: 'Baki mata',
    refund: 'BAYARAN BALIK',
    reg_no: 'No. Pend.',
    einvoice: 'e-Invois LHDN',
  },
  zh: {
    receipt_no: '收据号',
    order_no: '订单',
    table: '桌号',
    takeaway: '打包',
    delivery: '外送',
    subtotal: '小计',
    discount: '折扣',
    rounding: '四舍五入',
    total: '总计',
    tendered: '实收',
    change: '找零',
    member: '会员',
    points_balance: '积分余额',
    refund: '退款',
    reg_no: '注册号',
    einvoice: 'LHDN 电子发票',
  },
};

export type ReceiptLabels = Record<LabelKey, string>;

/** Build the label set for a primary + optional secondary language. */
export function makeLabels(primary: ReceiptLang, secondary?: ReceiptLang | ''): ReceiptLabels {
  const p = STRINGS[primary] ?? STRINGS.en;
  const s = secondary && secondary !== primary ? STRINGS[secondary] : null;
  const out = {} as ReceiptLabels;
  for (const key of Object.keys(p) as LabelKey[]) {
    out[key] = s ? `${p[key]} / ${s[key]}` : p[key];
  }
  return out;
}

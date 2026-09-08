export type Role = 'admin' | 'manager' | 'cashier' | 'kitchen';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'paid' | 'void';
export type OrderItemStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'ewallet' | 'other';
export type Station = 'kitchen' | 'bar';

export interface User {
  id: number;
  name: string;
  role: Role;
  pin_hash: string;
  active: number;
  created_at: string;
}

export interface SessionRow {
  token: string;
  user_id: number;
  expires_at: number;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
  active: number;
}

export interface Item {
  id: number;
  category_id: number;
  name: string;
  price_cents: number;
  sku: string | null;
  station: Station;
  active: number;
  track_stock: number;
  stock_qty: number;
  low_stock_threshold: number;
  sort: number;
}

export interface ModifierGroup {
  id: number;
  name: string;
  min_select: number;
  max_select: number; // 0 = unlimited
}

export interface Modifier {
  id: number;
  group_id: number;
  name: string;
  price_delta_cents: number;
  sort: number;
  active: number;
}

export interface DiningTable {
  id: number;
  name: string;
  zone: string;
  seats: number;
  active: number;
  pos_x: number | null; // percent (0-100) within the zone's floor canvas
  pos_y: number | null;
  shape: 'square' | 'round';
  qr_token: string | null;
}

export interface Order {
  id: number;
  order_no: string;
  type: OrderType;
  status: OrderStatus;
  table_id: number | null;
  covers: number;
  notes: string | null;
  discount_type: 'percent' | 'fixed' | null;
  discount_value: number; // percent in basis points is overkill; percent as integer 0-100, fixed as cents
  subtotal_cents: number;
  discount_cents: number;
  service_cents: number;
  tax_cents: number;
  rounding_cents: number;
  total_cents: number;
  paid_cents: number;
  refunded_cents: number;
  shift_id: number | null;
  opened_by: number;
  opened_at: string;
  closed_at: string | null;
  void_reason: string | null;
  einvoice_id: number | null;
}

export interface OrderItemModifierSnapshot {
  modifier_id: number;
  group_name: string;
  name: string;
  price_delta_cents: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number | null;
  name: string;
  qty: number;
  unit_price_cents: number;
  modifiers_json: string; // OrderItemModifierSnapshot[]
  notes: string | null;
  status: OrderItemStatus;
  station: Station;
  line_total_cents: number;
  source: 'staff' | 'guest';
  sent_at: string | null;
  created_at: string;
}

export interface Payment {
  id: number;
  order_id: number;
  method: PaymentMethod;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number | null;
  reference: string | null;
  user_id: number;
  shift_id: number | null;
  created_at: string;
}

export interface Refund {
  id: number;
  order_id: number;
  method: PaymentMethod;
  amount_cents: number;
  reason: string;
  user_id: number;
  approved_by: number;
  shift_id: number | null;
  created_at: string;
}

export interface Shift {
  id: number;
  status: 'open' | 'closed';
  opened_by: number;
  opened_at: string;
  opening_float_cents: number;
  closed_by: number | null;
  closed_at: string | null;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
  notes: string | null;
}

export interface TaxSettings {
  taxRate: number; // percent, e.g. 6
  taxLabel: string;
  taxOnService: boolean;
  serviceRate: number; // percent, e.g. 10
  serviceLabel: string;
  cashRoundingCents: number; // 5 = round cash totals to nearest 5 cents; 0 = off
}

export interface PaymentChannel {
  key: string;
  label: string;
  kind: PaymentMethod; // drives drawer math & X-report grouping
  enabled: boolean;
}

export interface PaymentsSettings {
  channels: PaymentChannel[];
  /** Static DuitNow/wallet QR payload shown to customers when an e-wallet channel is chosen. */
  ewalletQrPayload: string;
}

export type EinvoiceIdType = 'BRN' | 'NRIC' | 'PASSPORT' | 'ARMY';

export interface EinvoiceSettings {
  enabled: boolean;
  /** mock = built-in simulator (no LHDN calls); sandbox = MyInvois pre-prod; production = live. */
  environment: 'mock' | 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  supplierTin: string;
  supplierIdType: EinvoiceIdType;
  supplierIdValue: string; // BRN / NRIC number
  supplierSstNo: string;
  msicCode: string; // e.g. 56101 — restaurants and restaurant chains
  msicDescription: string;
  classificationCode: string; // item classification, 004 = consolidated e-invoice
  addressLine: string;
  city: string;
  postcode: string;
  /** MyInvois numeric state code, e.g. 14 = WP Kuala Lumpur. */
  stateCode: string;
  taxTypeCode: string; // 01 = sales tax, 02 = service tax
}

export interface EinvoiceBuyer {
  tin: string;
  idType: EinvoiceIdType;
  idValue: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  sstNo?: string;
}

export interface EinvoiceRow {
  id: number;
  order_id: number | null;
  type: 'invoice' | 'consolidated';
  status: 'pending' | 'submitted' | 'valid' | 'invalid' | 'error';
  buyer_json: string | null;
  document_json: string;
  internal_id: string;
  uuid: string | null;
  long_id: string | null;
  submission_uid: string | null;
  error: string | null;
  period: string | null;
  total_cents: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PrinterTarget {
  enabled: boolean;
  host: string;
  port: number;
}

export interface PrintersSettings {
  receipt: PrinterTarget & { drawerKick: boolean };
  kitchen: PrinterTarget;
  bar: PrinterTarget;
}

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  registrationNo: string;
  currency: string; // "MYR"
  currencySymbol: string; // "RM"
  receiptFooter: string;
}

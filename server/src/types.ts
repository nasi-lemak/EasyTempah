export type Role = 'admin' | 'manager' | 'cashier' | 'kitchen';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'paid' | 'void';
export type OrderItemStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'ewallet' | 'other';
/** A prep-station key, validated against Settings → Stations (e.g. kitchen, bar, wok, roti). */
export type Station = string;

export interface StationDef {
  key: string;
  label: string;
}

export interface StationsSettings {
  list: StationDef[];
}

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
  is_combo: number;
}

export interface Ingredient {
  id: number;
  name: string;
  unit: string; // g, ml, pcs …
  stock_qty: number;
  low_stock_threshold: number;
  cost_per_unit_cents: number;
  active: number;
}

export interface RecipeLine {
  item_id: number;
  ingredient_id: number;
  qty: number;
}

export interface ModifierRecipeLine {
  modifier_id: number;
  ingredient_id: number;
  qty: number;
}

export interface ComboGroup {
  id: number;
  item_id: number; // the combo item this choice group belongs to
  name: string;
  sort: number;
}

export interface ComboGroupItem {
  group_id: number;
  item_id: number; // eligible component item
  surcharge_cents: number;
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
  pager_no: number | null;
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
  platform: string | null; // delivery platform key, e.g. "grabfood"; null = own order
  platform_ref: string | null; // the platform's order number for reconciliation
  customer_id: number | null;
  points_earned: number;
  points_redeemed: number;
  promo_id: number | null; // best matching scheduled promotion, applied automatically
  promo_name: string | null;
  promo_cents: number;
  receipt_no: string | null; // sequential invoice serial, assigned when the bill settles
}

/** Scheduled automatic discount (e.g. happy hour). Times/dates are local wall clock. */
export interface Promotion {
  id: number;
  name: string;
  active: number;
  type: 'percent' | 'amount';
  value: number; // percent 1-100, or cents for 'amount'
  scope: 'order' | 'category' | 'item';
  category_id: number | null;
  item_id: number | null;
  days_json: string; // JSON number[] of weekdays, 0 = Sunday
  start_time: string | null; // 'HH:MM'; null with end_time null = all day
  end_time: string | null; // exclusive; end <= start means an overnight window
  starts_on: string | null; // 'YYYY-MM-DD' inclusive
  ends_on: string | null; // inclusive
  order_types_json: string; // JSON OrderType[]
  created_at: string;
}

export interface Customer {
  id: number;
  phone: string;
  name: string | null;
  points: number;
  visits: number;
  total_spent_cents: number;
  created_at: string;
  last_visit_at: string | null;
  consent_at: string | null;
}

export interface LoyaltySettings {
  enabled: boolean;
  earnPointsPerRm: number; // points earned per RM1 of net spend (excl. points tender)
  redeemPointsPerRm: number; // points needed to redeem RM1 (100 → 1 point = 1 sen)
  minRedeemPoints: number;
  /** Months of inactivity before a member is auto-anonymised (0 = keep forever). */
  retentionMonths: number;
  /** PDPA privacy notice shown when a customer joins (BM + English). */
  privacyNotice: string;
}

export interface GuestSettings {
  /** Flood guard on QR ordering: per-table submission burst inside a 2-minute window. */
  orderGuardEnabled: boolean;
  orderBurst: number;
}

/** Kitchen-display pacing — a noodle stall's "late" is not a grill's. */
export interface KdsSettings {
  warnMinutes: number;
  lateMinutes: number;
}

/** Terminal/session behavior shared by every till in the venue. */
export interface TerminalSettings {
  /** Hours a PIN sign-in stays valid (24h venues want longer than mall units). */
  sessionHours: number;
  /** Default idle minutes before a terminal returns to the PIN screen (0 = off); each device can still override locally. */
  idleLockDefaultMinutes: number;
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
  parent_line_id: number | null; // set-meal component lines point at their parent
  sent_at: string | null;
  created_at: string;
}

export interface Payment {
  id: number;
  order_id: number;
  method: PaymentMethod;
  channel: string | null;
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
  /** Order types the service charge applies to; MY/SG convention is dine-in only. Empty = never. */
  serviceOrderTypes: OrderType[];
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

export interface DeliveryPlatform {
  key: string;
  label: string;
  commissionPct: number; // platform commission for estimated-net reporting
  enabled: boolean;
}

export interface PlatformsSettings {
  platforms: DeliveryPlatform[];
}

export interface GatewaySettings {
  enabled: boolean;
  /** mock = built-in simulator; generic = any gateway posting the documented JSON webhook. */
  provider: 'mock' | 'generic';
  webhookSecret: string;
  /** true = gateway issues per-transaction QRs (exact matching); false = static counter QR (amount+time matching). */
  dynamicQr: boolean;
}

export interface PaymentIntent {
  id: number;
  order_id: number;
  channel_key: string;
  channel_label: string;
  kind: PaymentMethod;
  amount_cents: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  provider: string;
  provider_ref: string | null;
  qr_payload: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  expires_at: number;
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
  type: 'invoice' | 'consolidated' | 'credit_note';
  refund_id: number | null;
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
  /** 'ascii' (default, safest) or 'gbk' for printers with Chinese firmware. */
  charset?: 'ascii' | 'gbk';
}

export interface PrintersSettings {
  receipt: PrinterTarget & { drawerKick: boolean };
  /** One optional printer per configured station, keyed by station key. */
  stations: Record<string, PrinterTarget>;
}

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  registrationNo: string;
  country: string; // ISO-ish marker for presets/reporting, e.g. "MY", "SG"
  currency: string; // "MYR"
  currencySymbol: string; // "RM"
  receiptFooter: string;
  accentColor: string; // brand color for all terminals, hex e.g. "#2dd4a7"
  usePagers: boolean; // counter venues: key a pager number against orders
}

/** Receipt localization + serial numbering, chosen to fit the business's audience. */
export interface ReceiptsSettings {
  langPrimary: 'en' | 'ms' | 'zh';
  langSecondary: '' | 'en' | 'ms' | 'zh';
  serialEnabled: boolean;
  serialPrefix: string; // e.g. "INV-"
}

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
  shift_id: number | null;
  opened_by: number;
  opened_at: string;
  closed_at: string | null;
  void_reason: string | null;
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

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  registrationNo: string;
  currency: string; // "MYR"
  currencySymbol: string; // "RM"
  receiptFooter: string;
}

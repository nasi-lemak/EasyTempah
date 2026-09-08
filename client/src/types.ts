export type Role = 'admin' | 'manager' | 'cashier' | 'kitchen';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'paid' | 'void';
export type OrderItemStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'ewallet' | 'other';
export type Station = 'kitchen' | 'bar';

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
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
  max_select: number;
}

export interface Modifier {
  id: number;
  group_id: number;
  name: string;
  price_delta_cents: number;
  sort: number;
  active: number;
}

export interface MenuData {
  categories: Category[];
  items: Item[];
  groups: ModifierGroup[];
  modifiers: Modifier[];
  links: { item_id: number; group_id: number }[];
}

export interface DiningTable {
  id: number;
  name: string;
  zone: string;
  seats: number;
  active: number;
  pos_x: number | null;
  pos_y: number | null;
  shape: 'square' | 'round';
  order_id: number | null;
  order_no: string | null;
  total_cents: number | null;
  covers: number | null;
  order_opened_at: string | null;
  cooking_lines: number | null;
  ready_lines: number | null;
}

export interface ModifierSnapshot {
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
  modifiers_json: string;
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
  created_at: string;
}

export interface Order {
  id: number;
  order_no: string;
  type: OrderType;
  status: OrderStatus;
  table_id: number | null;
  table_name: string | null;
  covers: number;
  notes: string | null;
  discount_type: 'percent' | 'fixed' | null;
  discount_value: number;
  subtotal_cents: number;
  discount_cents: number;
  service_cents: number;
  tax_cents: number;
  rounding_cents: number;
  total_cents: number;
  paid_cents: number;
  opened_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  void_reason: string | null;
  items: OrderItem[];
  payments: Payment[];
  item_count?: number;
}

export interface TaxSettings {
  taxRate: number;
  taxLabel: string;
  taxOnService: boolean;
  serviceRate: number;
  serviceLabel: string;
  cashRoundingCents: number;
}

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  registrationNo: string;
  currency: string;
  currencySymbol: string;
  receiptFooter: string;
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
  opened_by_name?: string;
  closed_by_name?: string | null;
}

export interface ShiftSummary {
  cash_sales_cents: number;
  card_sales_cents: number;
  ewallet_sales_cents: number;
  other_sales_cents: number;
  total_sales_cents: number;
  orders_paid: number;
  cash_in_cents: number;
  cash_out_cents: number;
  expected_cash_cents: number;
}

export interface KdsLine extends OrderItem {
  order_no: string;
  type: OrderType;
  order_notes: string | null;
  table_name: string | null;
}

export interface KdsTicket {
  order_id: number;
  order_no: string;
  type: OrderType;
  table_name: string | null;
  order_notes: string | null;
  sent_at: string | null;
  lines: KdsLine[];
}

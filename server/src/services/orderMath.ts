import type { OrderItemModifierSnapshot, OrderType, TaxSettings } from '../types';

export interface LineInput {
  qty: number;
  unit_price_cents: number;
  modifiers: OrderItemModifierSnapshot[];
}

export interface TotalsInput {
  lines: LineInput[]; // active (non-cancelled) lines only
  discountType: 'percent' | 'fixed' | null;
  discountValue: number; // percent 0-100 or fixed cents
  promoCents?: number; // automatic promotion discount, applied after the manual discount
  orderType: OrderType; // service charge applies only to configured order types
  tax: TaxSettings;
}

export interface Totals {
  subtotal_cents: number;
  discount_cents: number;
  promo_cents: number; // promo portion actually applied (capped at what's left of the subtotal)
  service_cents: number;
  tax_cents: number;
  total_cents: number; // before cash rounding
}

export function lineTotal(line: LineInput): number {
  const modSum = line.modifiers.reduce((s, m) => s + m.price_delta_cents, 0);
  return line.qty * (line.unit_price_cents + modSum);
}

export function computeTotals(input: TotalsInput): Totals {
  const subtotal = input.lines.reduce((s, l) => s + lineTotal(l), 0);

  let discount = 0;
  if (input.discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, input.discountValue));
    discount = Math.round((subtotal * pct) / 100);
  } else if (input.discountType === 'fixed') {
    discount = Math.max(0, input.discountValue);
  }
  discount = Math.min(discount, subtotal);
  const promo = Math.min(Math.max(0, input.promoCents ?? 0), subtotal - discount);

  const discounted = subtotal - discount - promo;
  const serviceApplies =
    input.tax.serviceRate > 0 && (input.tax.serviceOrderTypes ?? ['dine_in']).includes(input.orderType);
  const service = serviceApplies ? Math.round((discounted * input.tax.serviceRate) / 100) : 0;
  const taxBase = input.tax.taxOnService ? discounted + service : discounted;
  const tax = Math.round((taxBase * input.tax.taxRate) / 100);

  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    promo_cents: promo,
    service_cents: service,
    tax_cents: tax,
    total_cents: discounted + service + tax,
  };
}

/**
 * Cash rounding for the remaining balance (e.g. Malaysian 5-sen rounding).
 * Returns the adjustment in cents to add to the balance (may be negative).
 */
export function cashRoundingAdjustment(balanceCents: number, roundToCents: number): number {
  if (roundToCents <= 1) return 0;
  const rounded = Math.round(balanceCents / roundToCents) * roundToCents;
  return rounded - balanceCents;
}

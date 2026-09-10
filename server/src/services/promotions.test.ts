import { describe, expect, it } from 'vitest';
import { clockFor, promoDiscount, promoMatches, type PromoClock, type PromoLine } from './promotions';
import { computeTotals } from './orderMath';
import type { Promotion, TaxSettings } from '../types';

function promo(overrides: Partial<Promotion>): Promotion {
  return {
    id: 1,
    name: 'Test promo',
    active: 1,
    type: 'percent',
    value: 10,
    scope: 'order',
    category_id: null,
    item_id: null,
    days_json: '[0,1,2,3,4,5,6]',
    start_time: null,
    end_time: null,
    starts_on: null,
    ends_on: null,
    order_types_json: '["dine_in","takeaway","delivery"]',
    created_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

const at = (day: number, minutes: number, ymd = '2026-09-09'): PromoClock => ({ day, minutes, ymd });

describe('promoMatches', () => {
  it('matches an always-on promo', () => {
    expect(promoMatches(promo({}), 'dine_in', at(3, 600))).toBe(true);
  });

  it('respects the active flag', () => {
    expect(promoMatches(promo({ active: 0 }), 'dine_in', at(3, 600))).toBe(false);
  });

  it('filters by weekday', () => {
    const weekdaysOnly = promo({ days_json: '[1,2,3,4,5]' });
    expect(promoMatches(weekdaysOnly, 'dine_in', at(3, 600))).toBe(true);
    expect(promoMatches(weekdaysOnly, 'dine_in', at(0, 600))).toBe(false);
  });

  it('filters by order type', () => {
    const dineInOnly = promo({ order_types_json: '["dine_in"]' });
    expect(promoMatches(dineInOnly, 'dine_in', at(3, 600))).toBe(true);
    expect(promoMatches(dineInOnly, 'takeaway', at(3, 600))).toBe(false);
  });

  it('applies a same-day time window with exclusive end', () => {
    const happyHour = promo({ start_time: '15:00', end_time: '18:00' });
    expect(promoMatches(happyHour, 'dine_in', at(3, 15 * 60))).toBe(true);
    expect(promoMatches(happyHour, 'dine_in', at(3, 17 * 60 + 59))).toBe(true);
    expect(promoMatches(happyHour, 'dine_in', at(3, 18 * 60))).toBe(false);
    expect(promoMatches(happyHour, 'dine_in', at(3, 14 * 60 + 59))).toBe(false);
  });

  it('handles an overnight window (22:00–02:00)', () => {
    const supper = promo({ start_time: '22:00', end_time: '02:00' });
    expect(promoMatches(supper, 'dine_in', at(5, 23 * 60))).toBe(true);
    expect(promoMatches(supper, 'dine_in', at(6, 60))).toBe(true); // 01:00 after midnight
    expect(promoMatches(supper, 'dine_in', at(5, 12 * 60))).toBe(false);
    expect(promoMatches(supper, 'dine_in', at(6, 2 * 60))).toBe(false); // 02:00 exclusive
  });

  it('applies the date range inclusively', () => {
    const august = promo({ starts_on: '2026-08-01', ends_on: '2026-08-31' });
    expect(promoMatches(august, 'dine_in', at(3, 600, '2026-08-01'))).toBe(true);
    expect(promoMatches(august, 'dine_in', at(3, 600, '2026-08-31'))).toBe(true);
    expect(promoMatches(august, 'dine_in', at(3, 600, '2026-09-01'))).toBe(false);
    expect(promoMatches(august, 'dine_in', at(3, 600, '2026-07-31'))).toBe(false);
  });

  it('rejects malformed stored JSON rather than throwing', () => {
    expect(promoMatches(promo({ days_json: 'not json' }), 'dine_in', at(3, 600))).toBe(false);
  });
});

describe('promoDiscount', () => {
  const lines: PromoLine[] = [
    { line_total_cents: 1000, item_id: 1, category_id: 10 }, // food
    { line_total_cents: 560, item_id: 15, category_id: 40 }, // drink
    { line_total_cents: 280, item_id: 16, category_id: 40 }, // drink
  ];

  it('order scope discounts everything', () => {
    expect(promoDiscount(promo({ type: 'percent', value: 10 }), lines)).toBe(184);
  });

  it('category scope discounts only matching lines', () => {
    const drinks = promo({ scope: 'category', category_id: 40, type: 'percent', value: 20 });
    expect(promoDiscount(drinks, lines)).toBe(168); // 20% of 840
  });

  it('item scope discounts only that item', () => {
    const tehTarik = promo({ scope: 'item', item_id: 15, type: 'percent', value: 50 });
    expect(promoDiscount(tehTarik, lines)).toBe(280);
  });

  it('amount promos cap at the eligible base', () => {
    const bigAmount = promo({ scope: 'category', category_id: 40, type: 'amount', value: 5000 });
    expect(promoDiscount(bigAmount, lines)).toBe(840);
  });

  it('returns 0 when nothing is eligible', () => {
    const missing = promo({ scope: 'category', category_id: 99 });
    expect(promoDiscount(missing, lines)).toBe(0);
  });
});

describe('computeTotals with promoCents', () => {
  const tax: TaxSettings = {
    taxRate: 6,
    taxLabel: 'SST 6%',
    taxOnService: true,
    serviceRate: 10,
    serviceLabel: 'Service 10%',
    serviceOrderTypes: ['dine_in'],
    cashRoundingCents: 5,
  };

  it('reduces the service/tax base by the promo', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 1000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      promoCents: 200,
      orderType: 'dine_in',
      tax,
    });
    expect(t.promo_cents).toBe(200);
    expect(t.service_cents).toBe(80); // 10% of 800
    expect(t.tax_cents).toBe(53); // 6% of 880
    expect(t.total_cents).toBe(933);
  });

  it('caps manual discount + promo at the subtotal', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 500, modifiers: [] }],
      discountType: 'fixed',
      discountValue: 400,
      promoCents: 300,
      orderType: 'takeaway',
      tax,
    });
    expect(t.discount_cents).toBe(400);
    expect(t.promo_cents).toBe(100); // clipped to what's left
    expect(t.total_cents).toBe(0);
  });
});

describe('clockFor', () => {
  it('derives day/minutes/ymd from a local date', () => {
    const c = clockFor(new Date(2026, 8, 9, 15, 30)); // Wed 9 Sep 2026 15:30 local
    expect(c).toEqual({ day: 3, minutes: 930, ymd: '2026-09-09' });
  });
});

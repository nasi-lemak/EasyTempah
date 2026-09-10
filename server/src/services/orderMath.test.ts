import { describe, it, expect } from 'vitest';
import { computeTotals, cashRoundingAdjustment, lineTotal } from './orderMath';
import type { TaxSettings } from '../types';

const myTax: TaxSettings = {
  taxRate: 6,
  taxLabel: 'SST 6%',
  taxOnService: true,
  serviceRate: 10,
  serviceLabel: 'Service 10%',
  serviceOrderTypes: ['dine_in'],
  cashRoundingCents: 5,
};

const noTax: TaxSettings = { ...myTax, taxRate: 0, serviceRate: 0 };

describe('lineTotal', () => {
  it('multiplies qty by unit price plus modifier deltas', () => {
    expect(
      lineTotal({
        qty: 2,
        unit_price_cents: 1200,
        modifiers: [
          { modifier_id: 1, group_name: 'Add-on', name: 'Extra egg', price_delta_cents: 150 },
          { modifier_id: 2, group_name: 'Sugar', name: 'Less sugar', price_delta_cents: 0 },
        ],
      }),
    ).toBe(2700);
  });
});

describe('computeTotals', () => {
  it('computes plain subtotal with no tax or discount', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 1000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'dine_in',
      tax: noTax,
    });
    expect(t).toEqual({
      subtotal_cents: 1000,
      discount_cents: 0,
      promo_cents: 0,
      service_cents: 0,
      tax_cents: 0,
      total_cents: 1000,
    });
  });

  it('applies service charge then tax on top (tax-on-service)', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 10000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'dine_in',
      tax: myTax,
    });
    expect(t.service_cents).toBe(1000); // 10%
    expect(t.tax_cents).toBe(660); // 6% of 11000
    expect(t.total_cents).toBe(11660);
  });

  it('taxes only the discounted subtotal when taxOnService is false', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 10000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'dine_in',
      tax: { ...myTax, taxOnService: false },
    });
    expect(t.tax_cents).toBe(600);
    expect(t.total_cents).toBe(11600);
  });

  it('applies percent discount before service and tax', () => {
    const t = computeTotals({
      lines: [{ qty: 2, unit_price_cents: 5000, modifiers: [] }],
      discountType: 'percent',
      discountValue: 10,
      orderType: 'dine_in',
      tax: myTax,
    });
    expect(t.discount_cents).toBe(1000);
    expect(t.service_cents).toBe(900); // 10% of 9000
    expect(t.tax_cents).toBe(594); // 6% of 9900
    expect(t.total_cents).toBe(10494);
  });

  it('caps fixed discount at the subtotal', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 500, modifiers: [] }],
      discountType: 'fixed',
      discountValue: 99999,
      orderType: 'dine_in',
      tax: noTax,
    });
    expect(t.discount_cents).toBe(500);
    expect(t.total_cents).toBe(0);
  });

  it('clamps percent discount to 100', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 500, modifiers: [] }],
      discountType: 'percent',
      discountValue: 150,
      orderType: 'dine_in',
      tax: noTax,
    });
    expect(t.discount_cents).toBe(500);
  });
});

describe('service charge order-type rules', () => {
  it('skips the service charge for takeaway when configured dine-in only', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 10000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'takeaway',
      tax: myTax,
    });
    expect(t.service_cents).toBe(0);
    expect(t.tax_cents).toBe(600); // 6% of 10000, no service in the base
    expect(t.total_cents).toBe(10600);
  });

  it('applies it to delivery when the type is enabled', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 10000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'delivery',
      tax: { ...myTax, serviceOrderTypes: ['dine_in', 'delivery'] },
    });
    expect(t.service_cents).toBe(1000);
  });

  it('never charges service when the list is empty (fully toggled off)', () => {
    const t = computeTotals({
      lines: [{ qty: 1, unit_price_cents: 10000, modifiers: [] }],
      discountType: null,
      discountValue: 0,
      orderType: 'dine_in',
      tax: { ...myTax, serviceOrderTypes: [] },
    });
    expect(t.service_cents).toBe(0);
  });
});

describe('cashRoundingAdjustment', () => {
  it('rounds to nearest 5 cents (Malaysian rounding)', () => {
    expect(cashRoundingAdjustment(1101, 5)).toBe(-1); // 11.01 -> 11.00
    expect(cashRoundingAdjustment(1102, 5)).toBe(-2); // 11.02 -> 11.00
    expect(cashRoundingAdjustment(1103, 5)).toBe(2); // 11.03 -> 11.05
    expect(cashRoundingAdjustment(1104, 5)).toBe(1);
    expect(cashRoundingAdjustment(1105, 5)).toBe(0);
    expect(cashRoundingAdjustment(1108, 5)).toBe(2); // 11.08 -> 11.10
  });

  it('is disabled when roundToCents <= 1', () => {
    expect(cashRoundingAdjustment(1101, 0)).toBe(0);
    expect(cashRoundingAdjustment(1101, 1)).toBe(0);
  });
});

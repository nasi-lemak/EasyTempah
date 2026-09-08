import { describe, expect, it } from 'vitest';
import { apportionTax, buildConsolidatedInvoice, buildOrderInvoice, GENERAL_PUBLIC_TIN } from './ubl';
import type { EinvoiceBuyer, EinvoiceSettings } from '../../types';
import type { OrderWithLines } from '../orders';

const settings: EinvoiceSettings = {
  enabled: true,
  environment: 'mock',
  clientId: '',
  clientSecret: '',
  supplierTin: 'C1234567890',
  supplierIdType: 'BRN',
  supplierIdValue: '202001012345',
  supplierSstNo: 'W10-1808-32000123',
  msicCode: '56101',
  msicDescription: 'Restaurants and restaurant chains',
  classificationCode: '004',
  addressLine: '1 Jalan Contoh',
  city: 'Kuala Lumpur',
  postcode: '50000',
  stateCode: '14',
  taxTypeCode: '02',
};

const buyer: EinvoiceBuyer = {
  tin: 'IG1234567890',
  idType: 'NRIC',
  idValue: '901231-14-5678',
  name: 'Ali bin Abu',
};

function fakeOrder(): OrderWithLines {
  return {
    id: 1,
    order_no: '20260908-0001',
    type: 'dine_in',
    status: 'paid',
    table_id: 1,
    covers: 2,
    notes: null,
    discount_type: null,
    discount_value: 0,
    subtotal_cents: 2000,
    discount_cents: 200,
    service_cents: 180,
    tax_cents: 119,
    rounding_cents: 1,
    total_cents: 2100,
    paid_cents: 2100,
    refunded_cents: 0,
    shift_id: null,
    opened_by: 1,
    opened_at: '2026-09-08 10:00:00',
    closed_at: '2026-09-08 11:00:00',
    void_reason: null,
    einvoice_id: null,
    items: [
      {
        id: 1, order_id: 1, item_id: 1, name: 'Nasi Lemak', qty: 2, unit_price_cents: 550,
        modifiers_json: '[{"modifier_id":2,"group_name":"Add Protein","name":"Ayam Goreng","price_delta_cents":450}]',
        notes: null, status: 'served', station: 'kitchen', line_total_cents: 2000,
        source: 'staff', sent_at: null, created_at: '',
      },
    ],
    payments: [],
    refunds: [],
    table_name: 'T1',
    opened_by_name: 'Cashier',
  } as OrderWithLines;
}

interface Amount { _: number; currencyID: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inv = (doc: Record<string, any>) => doc.Invoice[0];

describe('apportionTax', () => {
  it('splits proportionally and preserves the exact total', () => {
    const shares = apportionTax([1000, 2000, 30], 100);
    expect(shares.reduce((s, a) => s + a, 0)).toBe(100);
    expect(shares[1]).toBeGreaterThan(shares[0]);
  });

  it('returns zeros for zero tax', () => {
    expect(apportionTax([100, 200], 0)).toEqual([0, 0]);
  });
});

describe('buildOrderInvoice', () => {
  const doc = buildOrderInvoice(fakeOrder(), buyer, settings, 'EasyTempah Café', 'EINV-1');
  const invoice = inv(doc);

  it('carries UBL namespaces and core header fields', () => {
    expect(doc._D).toContain('ubl:schema:xsd:Invoice-2');
    expect(invoice.ID[0]._).toBe('EINV-1');
    expect(invoice.InvoiceTypeCode[0]._).toBe('01');
    expect(invoice.DocumentCurrencyCode[0]._).toBe('MYR');
  });

  it('maps supplier and buyer TINs', () => {
    const supplierIds = invoice.AccountingSupplierParty[0].Party[0].PartyIdentification;
    expect(supplierIds[0].ID[0]).toMatchObject({ _: 'C1234567890', schemeID: 'TIN' });
    const buyerIds = invoice.AccountingCustomerParty[0].Party[0].PartyIdentification;
    expect(buyerIds[0].ID[0]).toMatchObject({ _: 'IG1234567890', schemeID: 'TIN' });
    expect(buyerIds[1].ID[0]).toMatchObject({ _: '901231-14-5678', schemeID: 'NRIC' });
  });

  it('reconciles the monetary totals (subtotal − discount + service + tax + rounding = payable)', () => {
    const totals = invoice.LegalMonetaryTotal[0];
    const get = (k: string) => (totals[k][0] as Amount)._;
    expect(get('LineExtensionAmount')).toBe(20.0);
    expect(get('AllowanceTotalAmount')).toBe(2.0);
    expect(get('ChargeTotalAmount')).toBe(1.8);
    expect(get('TaxExclusiveAmount')).toBe(19.8);
    expect(get('TaxInclusiveAmount')).toBe(20.99);
    expect(get('PayableRoundingAmount')).toBe(0.01);
    expect(get('PayableAmount')).toBe(21.0);
  });

  it('puts modifier names into the line description and full tax on the single line', () => {
    const line = invoice.InvoiceLine[0];
    expect(line.Item[0].Description[0]._).toContain('Ayam Goreng');
    expect((line.TaxTotal[0].TaxAmount[0] as Amount)._).toBe(1.19);
  });
});

describe('buildConsolidatedInvoice', () => {
  const doc = buildConsolidatedInvoice(
    [
      { order_no: 'A1', taxExclusiveCents: 1000, taxCents: 60, roundingCents: 0, totalCents: 1060 },
      { order_no: 'A2', taxExclusiveCents: 2000, taxCents: 120, roundingCents: -2, totalCents: 2118 },
    ],
    '2026-08',
    settings,
    'EasyTempah Café',
    'CONS-2026-08',
  );
  const invoice = inv(doc);

  it('uses the LHDN general-public TIN and classification 004', () => {
    const buyerIds = invoice.AccountingCustomerParty[0].Party[0].PartyIdentification;
    expect(buyerIds[0].ID[0]._).toBe(GENERAL_PUBLIC_TIN);
    expect(
      invoice.InvoiceLine[0].Item[0].CommodityClassification[0].ItemClassificationCode[0]._,
    ).toBe('004');
  });

  it('sums receipts into the totals with rounding carried through', () => {
    const totals = invoice.LegalMonetaryTotal[0];
    expect((totals.PayableAmount[0] as Amount)._).toBe(31.78);
    expect((totals.PayableRoundingAmount[0] as Amount)._).toBe(-0.02);
    expect(invoice.InvoiceLine).toHaveLength(2);
    expect(invoice.InvoiceLine[1].Item[0].Description[0]._).toBe('Receipt #A2');
  });
});

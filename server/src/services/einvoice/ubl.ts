/**
 * Builds LHDN MyInvois UBL 2.1 JSON invoice documents (document version 1.0,
 * which does not require a digital signature). Pure — no I/O.
 *
 * References: MyInvois SDK document samples. Monetary values are 2 dp MYR.
 */
import type { EinvoiceBuyer, EinvoiceSettings, OrderItemModifierSnapshot } from '../../types';
import type { OrderWithLines } from '../orders';

type UblNode = Record<string, unknown>;

const amt = (cents: number) => ({ _: Number((cents / 100).toFixed(2)), currencyID: 'MYR' });
const txt = (value: string) => ({ _: value });

/** LHDN's designated general-public buyer for consolidated e-invoices. */
export const GENERAL_PUBLIC_TIN = 'EI00000000010';

function party(cfg: {
  tin: string;
  idType: string;
  idValue: string;
  name: string;
  sstNo?: string;
  address?: { line: string; city: string; postcode: string; stateCode: string };
  msic?: { code: string; description: string };
}): UblNode {
  const identifications: UblNode[] = [
    { ID: [{ _: cfg.tin, schemeID: 'TIN' }] },
    { ID: [{ _: cfg.idValue || 'NA', schemeID: cfg.idType }] },
  ];
  if (cfg.sstNo) identifications.push({ ID: [{ _: cfg.sstNo, schemeID: 'SST' }] });

  const address = cfg.address ?? { line: 'NA', city: 'NA', postcode: 'NA', stateCode: '17' };
  const node: UblNode = {
    ...(cfg.msic ? { IndustryClassificationCode: [{ _: cfg.msic.code, name: cfg.msic.description }] } : {}),
    PartyIdentification: identifications,
    PostalAddress: [
      {
        CityName: [txt(address.city)],
        PostalZone: [txt(address.postcode)],
        CountrySubentityCode: [txt(address.stateCode)],
        AddressLine: [{ Line: [txt(address.line)] }],
        Country: [{ IdentificationCode: [{ _: 'MYS', listID: 'ISO3166-1', listAgencyID: '6' }] }],
      },
    ],
    PartyLegalEntity: [{ RegistrationName: [txt(cfg.name)] }],
  };
  return node;
}

interface UblLine {
  id: string;
  description: string;
  quantity: number;
  /** tax-exclusive line amount in cents */
  amountCents: number;
  taxCents: number;
  classificationCode: string;
}

function invoiceLine(line: UblLine, taxTypeCode: string): UblNode {
  const unitCents = line.quantity > 0 ? Math.round(line.amountCents / line.quantity) : line.amountCents;
  return {
    ID: [txt(line.id)],
    InvoicedQuantity: [{ _: line.quantity, unitCode: 'C62' }],
    LineExtensionAmount: [amt(line.amountCents)],
    TaxTotal: [
      {
        TaxAmount: [amt(line.taxCents)],
        TaxSubtotal: [
          {
            TaxableAmount: [amt(line.amountCents)],
            TaxAmount: [amt(line.taxCents)],
            TaxCategory: [{ ID: [txt(taxTypeCode)], TaxScheme: [{ ID: [{ _: 'OTH', schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }] }] }],
          },
        ],
      },
    ],
    Item: [
      {
        CommodityClassification: [{ ItemClassificationCode: [{ _: line.classificationCode, listID: 'CLASS' }] }],
        Description: [txt(line.description)],
      },
    ],
    Price: [{ PriceAmount: [amt(unitCents)] }],
  };
}

export interface DocumentTotals {
  lineExtensionCents: number; // Σ line amounts (before doc-level discount/charge)
  discountCents: number;
  serviceCents: number;
  taxCents: number;
  roundingCents: number;
  payableCents: number;
}

function buildDocument(cfg: {
  internalId: string;
  settings: EinvoiceSettings;
  supplierName: string;
  buyer: { tin: string; idType: string; idValue: string; name: string; address?: string };
  lines: UblLine[];
  totals: DocumentTotals;
  issueDate: Date;
}): Record<string, unknown> {
  const { settings, totals } = cfg;
  const taxExclusive = totals.lineExtensionCents - totals.discountCents + totals.serviceCents;
  const allowanceCharges: UblNode[] = [];
  if (totals.discountCents > 0) {
    allowanceCharges.push({
      ChargeIndicator: [{ _: false }],
      AllowanceChargeReason: [txt('Discount')],
      Amount: [amt(totals.discountCents)],
    });
  }
  if (totals.serviceCents > 0) {
    allowanceCharges.push({
      ChargeIndicator: [{ _: true }],
      AllowanceChargeReason: [txt('Service charge')],
      Amount: [amt(totals.serviceCents)],
    });
  }

  const invoice: UblNode = {
    ID: [txt(cfg.internalId)],
    IssueDate: [txt(cfg.issueDate.toISOString().slice(0, 10))],
    IssueTime: [txt(cfg.issueDate.toISOString().slice(11, 19) + 'Z')],
    InvoiceTypeCode: [{ _: '01', listVersionID: '1.0' }],
    DocumentCurrencyCode: [txt('MYR')],
    AccountingSupplierParty: [
      {
        Party: [
          party({
            tin: settings.supplierTin,
            idType: settings.supplierIdType,
            idValue: settings.supplierIdValue,
            name: cfg.supplierName,
            sstNo: settings.supplierSstNo || undefined,
            msic: { code: settings.msicCode, description: settings.msicDescription },
            address: {
              line: settings.addressLine || 'NA',
              city: settings.city || 'NA',
              postcode: settings.postcode || 'NA',
              stateCode: settings.stateCode || '17',
            },
          }),
        ],
      },
    ],
    AccountingCustomerParty: [
      {
        Party: [
          party({
            tin: cfg.buyer.tin,
            idType: cfg.buyer.idType,
            idValue: cfg.buyer.idValue,
            name: cfg.buyer.name,
            address: cfg.buyer.address
              ? { line: cfg.buyer.address, city: 'NA', postcode: 'NA', stateCode: settings.stateCode || '17' }
              : undefined,
          }),
        ],
      },
    ],
    ...(allowanceCharges.length ? { AllowanceCharge: allowanceCharges } : {}),
    TaxTotal: [
      {
        TaxAmount: [amt(totals.taxCents)],
        TaxSubtotal: [
          {
            TaxableAmount: [amt(taxExclusive)],
            TaxAmount: [amt(totals.taxCents)],
            TaxCategory: [
              {
                ID: [txt(settings.taxTypeCode)],
                TaxScheme: [{ ID: [{ _: 'OTH', schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }] }],
              },
            ],
          },
        ],
      },
    ],
    LegalMonetaryTotal: [
      {
        LineExtensionAmount: [amt(totals.lineExtensionCents)],
        TaxExclusiveAmount: [amt(taxExclusive)],
        TaxInclusiveAmount: [amt(taxExclusive + totals.taxCents)],
        AllowanceTotalAmount: [amt(totals.discountCents)],
        ChargeTotalAmount: [amt(totals.serviceCents)],
        PayableRoundingAmount: [amt(totals.roundingCents)],
        PayableAmount: [amt(totals.payableCents)],
      },
    ],
    InvoiceLine: cfg.lines.map((l) => invoiceLine(l, settings.taxTypeCode)),
  };

  return {
    _D: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    _A: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    _B: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    Invoice: [invoice],
  };
}

/** Split an order-level tax across lines proportionally; the last line absorbs remainder. */
export function apportionTax(lineAmounts: number[], totalTax: number): number[] {
  const base = lineAmounts.reduce((s, a) => s + a, 0);
  if (base <= 0 || totalTax === 0) return lineAmounts.map(() => 0);
  const shares = lineAmounts.map((a) => Math.floor((totalTax * a) / base));
  const assigned = shares.reduce((s, a) => s + a, 0);
  shares[shares.length - 1] += totalTax - assigned;
  return shares;
}

export function buildOrderInvoice(
  order: OrderWithLines,
  buyer: EinvoiceBuyer,
  settings: EinvoiceSettings,
  supplierName: string,
  internalId: string,
): Record<string, unknown> {
  const active = order.items.filter((i) => i.status !== 'cancelled');
  const taxShares = apportionTax(
    // tax applies after discount; apportion against pre-discount line totals for simplicity
    active.map((i) => i.line_total_cents),
    order.tax_cents,
  );
  const lines: UblLine[] = active.map((i, idx) => {
    const mods = (JSON.parse(i.modifiers_json) as OrderItemModifierSnapshot[]).map((m) => m.name);
    return {
      id: String(idx + 1),
      description: i.name + (mods.length ? ` (${mods.join(', ')})` : ''),
      quantity: i.qty,
      amountCents: i.line_total_cents,
      taxCents: taxShares[idx],
      classificationCode: settings.classificationCode,
    };
  });
  return buildDocument({
    internalId,
    settings,
    supplierName,
    buyer: { tin: buyer.tin, idType: buyer.idType, idValue: buyer.idValue, name: buyer.name, address: buyer.address },
    lines,
    totals: {
      lineExtensionCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      serviceCents: order.service_cents,
      taxCents: order.tax_cents,
      roundingCents: order.rounding_cents,
      payableCents: order.total_cents,
    },
    issueDate: new Date(),
  });
}

export interface ConsolidatedOrder {
  order_no: string;
  taxExclusiveCents: number; // subtotal - discount + service
  taxCents: number;
  roundingCents: number;
  totalCents: number;
}

export function buildConsolidatedInvoice(
  orders: ConsolidatedOrder[],
  period: string, // YYYY-MM
  settings: EinvoiceSettings,
  supplierName: string,
  internalId: string,
): Record<string, unknown> {
  const lines: UblLine[] = orders.map((o, idx) => ({
    id: String(idx + 1),
    description: `Receipt #${o.order_no}`,
    quantity: 1,
    amountCents: o.taxExclusiveCents,
    taxCents: o.taxCents,
    // Consolidated e-invoices must use classification code 004.
    classificationCode: '004',
  }));
  const totals: DocumentTotals = {
    lineExtensionCents: orders.reduce((s, o) => s + o.taxExclusiveCents, 0),
    discountCents: 0,
    serviceCents: 0,
    taxCents: orders.reduce((s, o) => s + o.taxCents, 0),
    roundingCents: orders.reduce((s, o) => s + o.roundingCents, 0),
    payableCents: orders.reduce((s, o) => s + o.totalCents, 0),
  };
  return buildDocument({
    internalId,
    settings,
    supplierName,
    buyer: { tin: GENERAL_PUBLIC_TIN, idType: 'BRN', idValue: 'NA', name: `General Public (${period})` },
    lines,
    totals,
    issueDate: new Date(),
  });
}

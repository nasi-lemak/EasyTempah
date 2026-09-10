import { db } from '../db/connection';
import type {
  BusinessSettings,
  EinvoiceSettings,
  GatewaySettings,
  LoyaltySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
  ReceiptsSettings,
  TaxSettings,
} from '../types';

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'EasyTempah Café',
  address: '1 Jalan Contoh, 50000 Kuala Lumpur',
  phone: '+60 3-0000 0000',
  registrationNo: '',
  country: 'MY',
  currency: 'MYR',
  currencySymbol: 'RM',
  receiptFooter: 'Terima kasih! Please come again.',
};

export const DEFAULT_TAX: TaxSettings = {
  taxRate: 6,
  taxLabel: 'SST 6%',
  taxOnService: true,
  serviceRate: 10,
  serviceLabel: 'Service Charge 10%',
  serviceOrderTypes: ['dine_in'],
  cashRoundingCents: 5,
};

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return { ...fallback, ...JSON.parse(row.value) } as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getBusinessSettings(): BusinessSettings {
  return getSetting('business', DEFAULT_BUSINESS);
}

export function getTaxSettings(): TaxSettings {
  return getSetting('tax', DEFAULT_TAX);
}

export const DEFAULT_PRINTERS: PrintersSettings = {
  receipt: { enabled: false, host: '192.168.0.100', port: 9100, drawerKick: true, charset: 'ascii' },
  kitchen: { enabled: false, host: '192.168.0.101', port: 9100, charset: 'ascii' },
  bar: { enabled: false, host: '192.168.0.102', port: 9100, charset: 'ascii' },
};

export const DEFAULT_RECEIPTS: ReceiptsSettings = {
  langPrimary: 'en',
  langSecondary: '',
  serialEnabled: true,
  serialPrefix: 'INV-',
};

export function getReceiptsSettings(): ReceiptsSettings {
  return getSetting('receipts', DEFAULT_RECEIPTS);
}

/** Receipt logo: a small PNG stored as a data URL ('' = none). */
export function getLogoDataUrl(): string {
  return getSetting<{ dataUrl: string }>('logo', { dataUrl: '' }).dataUrl;
}

export function setLogoDataUrl(dataUrl: string): void {
  setSetting('logo', { dataUrl });
}

export const DEFAULT_PAYMENTS: PaymentsSettings = {
  channels: [
    { key: 'cash', label: 'Cash', kind: 'cash', enabled: true },
    { key: 'card', label: 'Card', kind: 'card', enabled: true },
    { key: 'tng', label: "Touch 'n Go eWallet", kind: 'ewallet', enabled: true },
    { key: 'grabpay', label: 'GrabPay', kind: 'ewallet', enabled: true },
    { key: 'boost', label: 'Boost', kind: 'ewallet', enabled: false },
    { key: 'shopeepay', label: 'ShopeePay', kind: 'ewallet', enabled: false },
    { key: 'duitnow', label: 'DuitNow QR', kind: 'ewallet', enabled: true },
    { key: 'other', label: 'Other', kind: 'other', enabled: true },
  ],
  ewalletQrPayload: '',
};

export function getPaymentsSettings(): PaymentsSettings {
  const stored = getSetting('payments', DEFAULT_PAYMENTS);
  if (!Array.isArray(stored.channels) || stored.channels.length === 0) {
    return { ...stored, channels: DEFAULT_PAYMENTS.channels };
  }
  return stored;
}

export const DEFAULT_EINVOICE: EinvoiceSettings = {
  enabled: false,
  environment: 'mock',
  clientId: '',
  clientSecret: '',
  supplierTin: '',
  supplierIdType: 'BRN',
  supplierIdValue: '',
  supplierSstNo: '',
  msicCode: '56101',
  msicDescription: 'Restaurants and restaurant chains',
  classificationCode: '004',
  addressLine: '',
  city: 'Kuala Lumpur',
  postcode: '50000',
  stateCode: '14',
  taxTypeCode: '02',
};

export function getEinvoiceSettings(): EinvoiceSettings {
  return getSetting('einvoice', DEFAULT_EINVOICE);
}

export const DEFAULT_PLATFORMS: PlatformsSettings = {
  platforms: [
    { key: 'grabfood', label: 'GrabFood', commissionPct: 30, enabled: true },
    { key: 'foodpanda', label: 'foodpanda', commissionPct: 30, enabled: true },
    { key: 'shopeefood', label: 'ShopeeFood', commissionPct: 25, enabled: false },
  ],
};

export function getPlatformsSettings(): PlatformsSettings {
  const stored = getSetting('platforms', DEFAULT_PLATFORMS);
  if (!Array.isArray(stored.platforms)) return DEFAULT_PLATFORMS;
  return stored;
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  earnPointsPerRm: 1,
  redeemPointsPerRm: 100, // 100 points = RM1 (1 point = 1 sen)
  minRedeemPoints: 100,
};

export function getLoyaltySettings(): LoyaltySettings {
  return getSetting('loyalty', DEFAULT_LOYALTY);
}

export const DEFAULT_GATEWAY: GatewaySettings = {
  enabled: false,
  provider: 'mock',
  webhookSecret: '',
  dynamicQr: true,
};

export function getGatewaySettings(): GatewaySettings {
  return getSetting('gateway', DEFAULT_GATEWAY);
}

/** Set by `npm run seed:demo`; the UI shows a DEMO DATA badge while enabled. */
export interface DemoSettings {
  enabled: boolean;
  generatedAt?: string;
}

export function getDemoSettings(): DemoSettings {
  return getSetting('demo', { enabled: false });
}

export function getPrintersSettings(): PrintersSettings {
  const stored = getSetting('printers', DEFAULT_PRINTERS);
  // Deep-merge per printer so partial saves keep sane defaults.
  return {
    receipt: { ...DEFAULT_PRINTERS.receipt, ...stored.receipt },
    kitchen: { ...DEFAULT_PRINTERS.kitchen, ...stored.kitchen },
    bar: { ...DEFAULT_PRINTERS.bar, ...stored.bar },
  };
}

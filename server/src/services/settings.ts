import { db } from '../db/connection';
import type { BusinessSettings, TaxSettings } from '../types';

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'EasyTempah Café',
  address: '1 Jalan Contoh, 50000 Kuala Lumpur',
  phone: '+60 3-0000 0000',
  registrationNo: '',
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

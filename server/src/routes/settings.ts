import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { audit } from '../services/audit';
import { backupNow, listBackups } from '../services/backup';
import { MAX_LOGO_BYTES, parseLogoDataUrl, pngToRaster } from '../services/logo';
import { makeLabels, RECEIPT_LANGS } from '../services/receiptLang';
import {
  DEFAULT_BUSINESS,
  DEFAULT_RECEIPTS,
  DEFAULT_TAX,
  getBusinessSettings,
  getDemoSettings,
  getEinvoiceSettings,
  getGatewaySettings,
  getLogoDataUrl,
  getGuestSettings,
  getKdsSettings,
  getTerminalSettings,
  getStationsSettings,
  stationKeys,
  getLoyaltySettings,
  getPaymentsSettings,
  getPlatformsSettings,
  getPrintersSettings,
  getReceiptsSettings,
  getTaxSettings,
  setLogoDataUrl,
  setSetting,
} from '../services/settings';
import type {
  BusinessSettings,
  EinvoiceSettings,
  GatewaySettings,
  GuestSettings,
  KdsSettings,
  TerminalSettings,
  StationsSettings,
  LoyaltySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
  ReceiptsSettings,
  TaxSettings,
} from '../types';

/** Never send the MyInvois client secret to the browser; a marker says one is stored. */
function maskedEinvoice(): Omit<EinvoiceSettings, 'clientSecret'> & { hasClientSecret: boolean } {
  const { clientSecret, ...rest } = getEinvoiceSettings();
  return { ...rest, hasClientSecret: clientSecret.length > 0 };
}

function maskedGateway(): Omit<GatewaySettings, 'webhookSecret'> & { hasWebhookSecret: boolean } {
  const { webhookSecret, ...rest } = getGatewaySettings();
  return { ...rest, hasWebhookSecret: webhookSecret.length > 0 };
}

function fullPayload() {
  const receipts = getReceiptsSettings();
  return {
    business: getBusinessSettings(),
    tax: getTaxSettings(),
    printers: getPrintersSettings(),
    payments: getPaymentsSettings(),
    einvoice: maskedEinvoice(),
    gateway: maskedGateway(),
    platforms: getPlatformsSettings(),
    loyalty: getLoyaltySettings(),
    guest: getGuestSettings(),
    kds: getKdsSettings(),
    terminals: getTerminalSettings(),
    stations: getStationsSettings(),
    // Labels computed server-side so screen and thermal receipts always agree.
    receipts: { ...receipts, labels: makeLabels(receipts.langPrimary, receipts.langSecondary) },
    logo: getLogoDataUrl(),
    demo: getDemoSettings(),
  };
}

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/** Public (any signed-in role) — the POS needs currency/tax info everywhere. */
settingsRouter.get('/', (_req, res) => {
  res.json(fullPayload());
});

settingsRouter.put('/', requireRole('admin'), (req: AuthedRequest, res) => {
  const { business, tax, printers, payments, einvoice, gateway, platforms, loyalty, receipts, guest, kds, terminals, stations } = req.body as {
    business?: Partial<BusinessSettings>;
    tax?: Partial<TaxSettings>;
    printers?: Partial<PrintersSettings>;
    payments?: Partial<PaymentsSettings>;
    einvoice?: Partial<EinvoiceSettings>;
    gateway?: Partial<GatewaySettings>;
    platforms?: Partial<PlatformsSettings>;
    loyalty?: Partial<LoyaltySettings>;
    receipts?: Partial<ReceiptsSettings>;
    guest?: Partial<GuestSettings>;
    kds?: Partial<KdsSettings>;
    terminals?: Partial<TerminalSettings>;
    stations?: StationsSettings;
  };
  if (business) {
    const merged = { ...DEFAULT_BUSINESS, ...getBusinessSettings(), ...business };
    if (!/^#[0-9a-fA-F]{6}$/.test(merged.accentColor)) {
      throw badRequest('accentColor must be a 6-digit hex color, e.g. #2dd4a7');
    }
    merged.usePagers = !!merged.usePagers;
    setSetting('business', merged);
  }
  if (tax) {
    const merged = { ...DEFAULT_TAX, ...getTaxSettings(), ...tax };
    if (merged.taxRate < 0 || merged.taxRate > 100 || merged.serviceRate < 0 || merged.serviceRate > 100) {
      throw badRequest('Rates must be 0-100');
    }
    if (
      !Array.isArray(merged.serviceOrderTypes) ||
      merged.serviceOrderTypes.some((t) => !['dine_in', 'takeaway', 'delivery'].includes(t))
    ) {
      throw badRequest('serviceOrderTypes must be a list of order types');
    }
    if (![0, 1, 5, 10, 25, 50, 100].includes(merged.cashRoundingCents)) {
      throw badRequest('cashRoundingCents must be one of 0, 5, 10, 25, 50, 100');
    }
    setSetting('tax', merged);
  }
  if (printers) {
    const current = getPrintersSettings();
    const stationTargets = { ...current.stations, ...(printers.stations ?? {}) };
    const merged: PrintersSettings = {
      receipt: { ...current.receipt, ...printers.receipt },
      stations: stationTargets,
    };
    for (const target of [merged.receipt, ...Object.values(merged.stations)]) {
      if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
        throw badRequest('Printer port must be 1-65535');
      }
      if (target.enabled && !target.host.trim()) throw badRequest('Printer host required');
      if (target.charset && !['ascii', 'gbk'].includes(target.charset)) {
        throw badRequest('Printer charset must be ascii or gbk');
      }
    }
    setSetting('printers', merged);
  }
  if (stations) {
    const list = stations.list;
    if (!Array.isArray(list) || list.length < 1 || list.length > 8) {
      throw badRequest('Between 1 and 8 stations, please');
    }
    const seen = new Set<string>();
    for (const st of list) {
      if (typeof st.key !== 'string' || !/^[a-z0-9_-]{1,20}$/.test(st.key)) {
        throw badRequest('Station keys are 1-20 lowercase letters, digits, - or _');
      }
      if (typeof st.label !== 'string' || !st.label.trim() || st.label.length > 30) {
        throw badRequest('Every station needs a label up to 30 characters');
      }
      if (seen.has(st.key)) throw badRequest(`Duplicate station key "${st.key}"`);
      seen.add(st.key);
    }
    // A station still cooking someone's menu can't be removed — reassign items first.
    const removed = stationKeys().filter((k) => !seen.has(k));
    for (const key of removed) {
      const inUse = db
        .prepare('SELECT COUNT(*) AS n FROM items WHERE station = ? AND active = 1')
        .get(key) as { n: number };
      if (inUse.n > 0) {
        throw badRequest(`Station "${key}" still has ${inUse.n} active menu item(s) — move them to another station first`);
      }
    }
    setSetting('stations', { list: list.map((st) => ({ key: st.key, label: st.label.trim() })) });
  }
  if (payments) {
    const current = getPaymentsSettings();
    const channels = Array.isArray(payments.channels) ? payments.channels : current.channels;
    for (const ch of channels) {
      if (!ch.key?.trim() || !ch.label?.trim()) throw badRequest('Payment channels need a key and label');
      if (!['cash', 'card', 'ewallet', 'other'].includes(ch.kind)) throw badRequest('Invalid channel kind');
    }
    if (!channels.some((c) => c.enabled)) throw badRequest('At least one payment channel must be enabled');
    setSetting('payments', {
      channels: channels.map((c) => ({
        key: c.key.trim(),
        label: c.label.trim(),
        kind: c.kind,
        enabled: !!c.enabled,
      })),
      ewalletQrPayload:
        payments.ewalletQrPayload !== undefined ? payments.ewalletQrPayload : current.ewalletQrPayload,
    });
  }
  if (einvoice) {
    const current = getEinvoiceSettings();
    const merged: EinvoiceSettings = {
      ...current,
      ...einvoice,
      // A blank/omitted secret keeps the stored one; only a non-empty value replaces it.
      clientSecret: einvoice.clientSecret?.trim() ? einvoice.clientSecret.trim() : current.clientSecret,
    };
    if (!['mock', 'sandbox', 'production'].includes(merged.environment)) {
      throw badRequest('E-invoice environment must be mock, sandbox or production');
    }
    if (merged.enabled && !merged.supplierTin.trim()) throw badRequest('Supplier TIN required to enable e-invoicing');
    setSetting('einvoice', merged);
  }
  if (gateway) {
    const current = getGatewaySettings();
    const merged: GatewaySettings = {
      ...current,
      ...gateway,
      webhookSecret: gateway.webhookSecret?.trim() ? gateway.webhookSecret.trim() : current.webhookSecret,
    };
    if (!['mock', 'generic'].includes(merged.provider)) throw badRequest('Gateway provider must be mock or generic');
    if (merged.enabled && !merged.webhookSecret) throw badRequest('Webhook secret required to enable the gateway');
    setSetting('gateway', merged);
  }
  if (platforms) {
    const list = Array.isArray(platforms.platforms) ? platforms.platforms : getPlatformsSettings().platforms;
    for (const p of list) {
      if (!p.key?.trim() || !p.label?.trim()) throw badRequest('Platforms need a key and label');
      if (typeof p.commissionPct !== 'number' || p.commissionPct < 0 || p.commissionPct > 100) {
        throw badRequest('Platform commission must be 0-100%');
      }
    }
    setSetting('platforms', {
      platforms: list.map((p) => ({
        key: p.key.trim(),
        label: p.label.trim(),
        commissionPct: p.commissionPct,
        enabled: !!p.enabled,
      })),
    });
  }
  if (loyalty) {
    const merged: LoyaltySettings = { ...getLoyaltySettings(), ...loyalty };
    if (merged.earnPointsPerRm < 0 || merged.redeemPointsPerRm < 1 || merged.minRedeemPoints < 0) {
      throw badRequest('Loyalty rates must be non-negative (redeem points per RM at least 1)');
    }
    if (!Number.isInteger(merged.retentionMonths) || merged.retentionMonths < 0) {
      throw badRequest('Retention months must be 0 (keep forever) or a positive whole number');
    }
    if (typeof merged.privacyNotice !== 'string' || merged.privacyNotice.length > 2000) {
      throw badRequest('Privacy notice must be text up to 2000 characters');
    }
    setSetting('loyalty', merged);
  }
  if (guest) {
    const merged: GuestSettings = { ...getGuestSettings(), ...guest };
    if (!Number.isInteger(merged.orderBurst) || merged.orderBurst < 2 || merged.orderBurst > 50) {
      throw badRequest('Guest order burst must be a whole number from 2 to 50');
    }
    merged.orderGuardEnabled = !!merged.orderGuardEnabled;
    setSetting('guest', merged);
  }
  if (kds) {
    const merged: KdsSettings = { ...getKdsSettings(), ...kds };
    if (
      !Number.isInteger(merged.warnMinutes) || !Number.isInteger(merged.lateMinutes) ||
      merged.warnMinutes < 1 || merged.lateMinutes > 120 || merged.warnMinutes >= merged.lateMinutes
    ) {
      throw badRequest('Kitchen timing needs whole minutes with warn below late (late at most 120)');
    }
    setSetting('kds', merged);
  }
  if (terminals) {
    const merged: TerminalSettings = { ...getTerminalSettings(), ...terminals };
    if (!Number.isInteger(merged.sessionHours) || merged.sessionHours < 1 || merged.sessionHours > 48) {
      throw badRequest('Session hours must be a whole number from 1 to 48');
    }
    if (
      !Number.isInteger(merged.idleLockDefaultMinutes) ||
      merged.idleLockDefaultMinutes < 0 || merged.idleLockDefaultMinutes > 120
    ) {
      throw badRequest('Idle lock default must be 0 (off) to 120 minutes');
    }
    setSetting('terminals', merged);
  }
  if (receipts) {
    const merged: ReceiptsSettings = { ...DEFAULT_RECEIPTS, ...getReceiptsSettings(), ...receipts };
    if (!RECEIPT_LANGS.includes(merged.langPrimary)) throw badRequest('Unknown primary receipt language');
    if (merged.langSecondary && !RECEIPT_LANGS.includes(merged.langSecondary)) {
      throw badRequest('Unknown secondary receipt language');
    }
    if (merged.langSecondary === merged.langPrimary) merged.langSecondary = '';
    if (merged.serialPrefix.length > 12) throw badRequest('Serial prefix must be 12 characters or fewer');
    setSetting('receipts', merged);
  }
  audit(req.user!.id, 'settings.update');
  res.json(fullPayload());
});

/**
 * Receipt logo upload: a small PNG as a data URL. Validated by actually
 * decoding + rasterizing it, so a file the printer can't render is rejected
 * up front rather than failing at print time.
 */
settingsRouter.put('/logo', requireRole('admin'), (req: AuthedRequest, res) => {
  const { dataUrl } = req.body as { dataUrl?: string };
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_LOGO_BYTES * 2) {
    throw badRequest('dataUrl (PNG, max 200 KB) required');
  }
  try {
    pngToRaster(parseLogoDataUrl(dataUrl));
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Invalid PNG');
  }
  setLogoDataUrl(dataUrl);
  audit(req.user!.id, 'settings.logo');
  res.json(fullPayload());
});

settingsRouter.delete('/logo', requireRole('admin'), (req: AuthedRequest, res) => {
  setLogoDataUrl('');
  audit(req.user!.id, 'settings.logo.remove');
  res.json(fullPayload());
});

/** Manual database backup (admin). Scheduled backups run daily regardless. */
settingsRouter.post('/backup', requireRole('admin'), (req: AuthedRequest, res, next) => {
  backupNow()
    .then((file) => {
      audit(req.user!.id, 'backup.manual', { file });
      res.json({ ok: true, file: file.split('/').pop(), backups: listBackups() });
    })
    .catch(next);
});

settingsRouter.get('/backups', requireRole('admin'), (_req, res) => {
  res.json({ backups: listBackups() });
});

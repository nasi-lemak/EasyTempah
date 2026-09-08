import { Router } from 'express';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { audit } from '../services/audit';
import {
  DEFAULT_BUSINESS,
  DEFAULT_TAX,
  getBusinessSettings,
  getEinvoiceSettings,
  getGatewaySettings,
  getPaymentsSettings,
  getPlatformsSettings,
  getPrintersSettings,
  getTaxSettings,
  setSetting,
} from '../services/settings';
import type {
  BusinessSettings,
  EinvoiceSettings,
  GatewaySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
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
  return {
    business: getBusinessSettings(),
    tax: getTaxSettings(),
    printers: getPrintersSettings(),
    payments: getPaymentsSettings(),
    einvoice: maskedEinvoice(),
    gateway: maskedGateway(),
    platforms: getPlatformsSettings(),
  };
}

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/** Public (any signed-in role) — the POS needs currency/tax info everywhere. */
settingsRouter.get('/', (_req, res) => {
  res.json(fullPayload());
});

settingsRouter.put('/', requireRole('admin'), (req: AuthedRequest, res) => {
  const { business, tax, printers, payments, einvoice, gateway, platforms } = req.body as {
    business?: Partial<BusinessSettings>;
    tax?: Partial<TaxSettings>;
    printers?: Partial<PrintersSettings>;
    payments?: Partial<PaymentsSettings>;
    einvoice?: Partial<EinvoiceSettings>;
    gateway?: Partial<GatewaySettings>;
    platforms?: Partial<PlatformsSettings>;
  };
  if (business) {
    setSetting('business', { ...DEFAULT_BUSINESS, ...getBusinessSettings(), ...business });
  }
  if (tax) {
    const merged = { ...DEFAULT_TAX, ...getTaxSettings(), ...tax };
    if (merged.taxRate < 0 || merged.taxRate > 100 || merged.serviceRate < 0 || merged.serviceRate > 100) {
      throw badRequest('Rates must be 0-100');
    }
    if (![0, 1, 5, 10, 25, 50, 100].includes(merged.cashRoundingCents)) {
      throw badRequest('cashRoundingCents must be one of 0, 5, 10, 25, 50, 100');
    }
    setSetting('tax', merged);
  }
  if (printers) {
    const current = getPrintersSettings();
    const merged: PrintersSettings = {
      receipt: { ...current.receipt, ...printers.receipt },
      kitchen: { ...current.kitchen, ...printers.kitchen },
      bar: { ...current.bar, ...printers.bar },
    };
    for (const target of [merged.receipt, merged.kitchen, merged.bar]) {
      if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
        throw badRequest('Printer port must be 1-65535');
      }
      if (target.enabled && !target.host.trim()) throw badRequest('Printer host required');
    }
    setSetting('printers', merged);
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
  audit(req.user!.id, 'settings.update');
  res.json(fullPayload());
});

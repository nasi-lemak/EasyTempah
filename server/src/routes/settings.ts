import { Router } from 'express';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { audit } from '../services/audit';
import {
  DEFAULT_BUSINESS,
  DEFAULT_TAX,
  getBusinessSettings,
  getPrintersSettings,
  getTaxSettings,
  setSetting,
} from '../services/settings';
import type { BusinessSettings, PrintersSettings, TaxSettings } from '../types';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/** Public (any signed-in role) — the POS needs currency/tax info everywhere. */
settingsRouter.get('/', (_req, res) => {
  res.json({ business: getBusinessSettings(), tax: getTaxSettings(), printers: getPrintersSettings() });
});

settingsRouter.put('/', requireRole('admin'), (req: AuthedRequest, res) => {
  const { business, tax, printers } = req.body as {
    business?: Partial<BusinessSettings>;
    tax?: Partial<TaxSettings>;
    printers?: Partial<PrintersSettings>;
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
  audit(req.user!.id, 'settings.update');
  res.json({ business: getBusinessSettings(), tax: getTaxSettings(), printers: getPrintersSettings() });
});

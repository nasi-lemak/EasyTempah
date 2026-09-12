import { create } from 'zustand';
import type {
  AuthUser,
  BusinessSettings,
  DemoSettings,
  EinvoiceSettings,
  GatewaySettings,
  KdsSettings,
  LoyaltySettings,
  PaymentsSettings,
  PlatformsSettings,
  PrintersSettings,
  ReceiptsSettings,
  StationsSettings,
  TerminalSettings,
  TaxSettings,
} from './types';

export interface SettingsBundle {
  business: BusinessSettings;
  tax: TaxSettings;
  printers?: PrintersSettings;
  payments?: PaymentsSettings;
  einvoice?: EinvoiceSettings;
  gateway?: GatewaySettings;
  platforms?: PlatformsSettings;
  loyalty?: LoyaltySettings;
  kds?: KdsSettings;
  terminals?: TerminalSettings;
  stations?: StationsSettings;
  receipts?: ReceiptsSettings;
  logo?: string;
  demo?: DemoSettings;
}

interface AppState {
  token: string | null;
  user: AuthUser | null;
  business: BusinessSettings | null;
  tax: TaxSettings | null;
  printers: PrintersSettings | null;
  payments: PaymentsSettings | null;
  einvoice: EinvoiceSettings | null;
  gateway: GatewaySettings | null;
  platforms: PlatformsSettings | null;
  loyalty: LoyaltySettings | null;
  kds: KdsSettings | null;
  terminals: TerminalSettings | null;
  stations: StationsSettings | null;
  receipts: ReceiptsSettings | null;
  logo: string;
  demo: DemoSettings | null;
  /** False while the live connection to the shop server is down (SSE dropped). */
  connected: boolean;
  setConnected: (up: boolean) => void;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setSettings: (bundle: SettingsBundle) => void;
}

const STORAGE_KEY = 'easytempah.auth';

function loadStored(): { token: string | null; user: AuthUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { token: null, user: null };
}

export const useStore = create<AppState>((set) => ({
  ...loadStored(),
  business: null,
  tax: null,
  printers: null,
  payments: null,
  einvoice: null,
  gateway: null,
  platforms: null,
  loyalty: null,
  kds: null,
  terminals: null,
  stations: null,
  receipts: null,
  logo: '',
  demo: null,
  connected: true,
  setConnected: (up) => set({ connected: up }),
  setAuth: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },
  setSettings: (bundle) =>
    set({
      business: bundle.business,
      tax: bundle.tax,
      ...(bundle.printers ? { printers: bundle.printers } : {}),
      ...(bundle.payments ? { payments: bundle.payments } : {}),
      ...(bundle.einvoice ? { einvoice: bundle.einvoice } : {}),
      ...(bundle.gateway ? { gateway: bundle.gateway } : {}),
      ...(bundle.platforms ? { platforms: bundle.platforms } : {}),
      ...(bundle.loyalty ? { loyalty: bundle.loyalty } : {}),
      ...(bundle.kds ? { kds: bundle.kds } : {}),
      ...(bundle.terminals ? { terminals: bundle.terminals } : {}),
      ...(bundle.stations ? { stations: bundle.stations } : {}),
      ...(bundle.receipts ? { receipts: bundle.receipts } : {}),
      ...(bundle.logo !== undefined ? { logo: bundle.logo } : {}),
      ...(bundle.demo ? { demo: bundle.demo } : {}),
    }),
}));

export function formatMoney(cents: number | null | undefined, symbol = 'RM'): string {
  const v = (cents ?? 0) / 100;
  return `${symbol} ${v.toFixed(2)}`;
}

export function useMoney(): (cents: number | null | undefined) => string {
  const business = useStore((s) => s.business);
  const symbol = business?.currencySymbol ?? 'RM';
  return (cents) => formatMoney(cents, symbol);
}

const ROLE_RANK: Record<string, number> = { kitchen: 1, cashier: 2, manager: 3, admin: 4 };

export function hasRole(user: AuthUser | null, minRole: string): boolean {
  if (!user) return false;
  return (ROLE_RANK[user.role] ?? 0) >= (ROLE_RANK[minRole] ?? 99);
}

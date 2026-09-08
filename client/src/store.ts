import { create } from 'zustand';
import type { AuthUser, BusinessSettings, PrintersSettings, TaxSettings } from './types';

interface AppState {
  token: string | null;
  user: AuthUser | null;
  business: BusinessSettings | null;
  tax: TaxSettings | null;
  printers: PrintersSettings | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  setSettings: (business: BusinessSettings, tax: TaxSettings, printers?: PrintersSettings) => void;
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
  setAuth: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },
  setSettings: (business, tax, printers) => set({ business, tax, ...(printers ? { printers } : {}) }),
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

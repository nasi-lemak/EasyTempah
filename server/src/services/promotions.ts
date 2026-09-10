/**
 * Scheduled promotions (happy hour, item/category deals).
 *
 * Matching and discount math are pure functions (unit-tested); the only DB
 * touchpoint is loading candidates. The single best-value promotion applies
 * per order — promotions do not stack with each other, but they do combine
 * with a manual discount (computeTotals caps the sum at the subtotal).
 * Platform orders never get promotions: they settle at the platform's menu
 * value.
 */
import { db } from '../db/connection';
import type { OrderType, Promotion } from '../types';

export interface PromoLine {
  line_total_cents: number;
  item_id: number | null;
  category_id: number | null;
}

export interface PromoClock {
  day: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
  ymd: string; // 'YYYY-MM-DD' local
}

export function clockFor(date: Date): PromoClock {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: date.getDay(),
    minutes: date.getHours() * 60 + date.getMinutes(),
    ymd: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  };
}

function parseMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null;
}

/** Does this promotion apply at the given local time for the given order type? */
export function promoMatches(promo: Promotion, orderType: OrderType, clock: PromoClock): boolean {
  if (!promo.active) return false;
  try {
    const days = JSON.parse(promo.days_json) as number[];
    if (Array.isArray(days) && days.length > 0 && !days.includes(clock.day)) return false;
    const types = JSON.parse(promo.order_types_json) as OrderType[];
    if (Array.isArray(types) && types.length > 0 && !types.includes(orderType)) return false;
  } catch {
    return false;
  }
  if (promo.starts_on && clock.ymd < promo.starts_on) return false;
  if (promo.ends_on && clock.ymd > promo.ends_on) return false;
  if (promo.start_time && promo.end_time) {
    const start = parseMinutes(promo.start_time);
    const end = parseMinutes(promo.end_time);
    if (start === null || end === null) return false;
    if (start === end) return false; // zero-length window never matches
    if (end > start) {
      if (clock.minutes < start || clock.minutes >= end) return false;
    } else {
      // Overnight window (e.g. 22:00–02:00), matched against the current day's clock.
      if (clock.minutes < start && clock.minutes >= end) return false;
    }
  }
  return true;
}

/** Discount this promotion yields for these lines (0 if nothing is eligible). */
export function promoDiscount(promo: Promotion, lines: PromoLine[]): number {
  const eligible = lines.filter((l) => {
    if (promo.scope === 'order') return true;
    if (promo.scope === 'category') return l.category_id === promo.category_id;
    return l.item_id === promo.item_id;
  });
  const base = eligible.reduce((s, l) => s + l.line_total_cents, 0);
  if (base <= 0) return 0;
  if (promo.type === 'percent') {
    const pct = Math.min(100, Math.max(0, promo.value));
    return Math.round((base * pct) / 100);
  }
  return Math.min(promo.value, base);
}

export interface AppliedPromo {
  id: number | null;
  name: string | null;
  cents: number;
}

/** The single best-value active promotion for these lines right now. */
export function bestPromo(lines: PromoLine[], orderType: OrderType, now = new Date()): AppliedPromo {
  const clock = clockFor(now);
  const promos = db.prepare('SELECT * FROM promotions WHERE active = 1').all() as Promotion[];
  let best: AppliedPromo = { id: null, name: null, cents: 0 };
  for (const promo of promos) {
    if (!promoMatches(promo, orderType, clock)) continue;
    const cents = promoDiscount(promo, lines);
    if (cents > best.cents) best = { id: promo.id, name: promo.name, cents };
  }
  return best;
}

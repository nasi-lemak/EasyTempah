import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useMoney } from '../store';
import { useEvents } from '../useEvents';

interface TodayData {
  today: { orders: number; gross_cents: number; covers: number };
  last_week: { orders: number; gross_cents: number; covers: number };
  live: { open_orders: number; open_cents: number; occupied_tables: number };
  top_items: { name: string; qty: number }[];
  bookings: { id: number; name: string; party_size: number; reserved_at: string; table_name: string | null }[];
  low_items: { name: string; stock_qty: number; low_stock_threshold: number }[];
  low_ingredients: { name: string; stock_qty: number; low_stock_threshold: number; unit: string }[];
  active_promos: string[];
}

/** Card keys the owner can hide — the choice is remembered per terminal. */
const CARDS = [
  ['sales', 'Sales vs last week'],
  ['live', 'Live floor'],
  ['top', 'Top sellers today'],
  ['bookings', 'Upcoming bookings'],
  ['stock', 'Low stock'],
  ['promos', 'Running promotions'],
] as const;
type CardKey = (typeof CARDS)[number][0];

const HIDE_KEY = 'easytempah.today.hidden';

function loadHidden(): CardKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function Today() {
  const money = useMoney();
  const navigate = useNavigate();
  const [data, setData] = useState<TodayData | null>(null);
  const [hidden, setHidden] = useState<CardKey[]>(loadHidden);
  const [customise, setCustomise] = useState(false);

  const load = useCallback(() => {
    api.get<TodayData>('/api/reports/today').then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['orders', 'tables', 'reservations', 'inventory'], load);

  const toggle = (key: CardKey) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, JSON.stringify(next));
    } catch { /* per-device convenience */ }
  };

  if (!data) return <div className="muted">Loading…</div>;

  const show = (key: CardKey) => !hidden.includes(key);
  const delta = data.last_week.gross_cents > 0
    ? Math.round(((data.today.gross_cents - data.last_week.gross_cents) / data.last_week.gross_cents) * 100)
    : null;
  const time = (at: string) => new Date(at.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /** Card wrapper: normal render, plus a hide button in customise mode. */
  const Card = ({ k, title, children }: { k: CardKey; title: string; children: React.ReactNode }) =>
    show(k) ? (
      <div className="panel" style={{ minWidth: 260, flex: '1 1 300px', position: 'relative' }}>
        <div className="row">
          <h2 className="grow">{title}</h2>
          {customise && <button className="ghost small" onClick={() => toggle(k)}>Hide</button>}
        </div>
        {children}
      </div>
    ) : null;

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Today</h1>
        <button className={customise ? 'primary' : ''} onClick={() => setCustomise(!customise)}>
          {customise ? 'Done' : '⚙ Customise'}
        </button>
      </div>
      {customise && hidden.length > 0 && (
        <div className="row wrap mb">
          <span className="muted small">Hidden on this terminal — tap to bring back:</span>
          {hidden.map((k) => (
            <button key={k} className="small" onClick={() => toggle(k)}>
              + {CARDS.find(([key]) => key === k)?.[1]}
            </button>
          ))}
        </div>
      )}

      <div className="row wrap" style={{ alignItems: 'stretch' }}>
        <Card k="sales" title="Sales so far">
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Today up to now</div>
              <div className="value">{money(data.today.gross_cents)}</div>
            </div>
            <div className="stat">
              <div className="label">Same time last {new Date().toLocaleDateString([], { weekday: 'long' })}</div>
              <div className="value muted">{money(data.last_week.gross_cents)}</div>
            </div>
          </div>
          <div className="mt">
            {delta == null ? (
              <span className="muted small">No sales at this time last week to compare.</span>
            ) : (
              <span className={`badge ${delta >= 0 ? 'ready' : 'cancelled'}`}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs last week
              </span>
            )}
            <span className="muted small" style={{ marginLeft: 10 }}>
              {data.today.orders} orders · {data.today.covers} covers
              {' '}(last week: {data.last_week.orders} · {data.last_week.covers})
            </span>
          </div>
        </Card>

        <Card k="live" title="On the floor now">
          <div className="stat-grid">
            <div className="stat"><div className="label">Open bills</div><div className="value">{data.live.open_orders}</div></div>
            <div className="stat"><div className="label">Value open</div><div className="value">{money(data.live.open_cents)}</div></div>
            <div className="stat"><div className="label">Tables occupied</div><div className="value">{data.live.occupied_tables}</div></div>
          </div>
          <button className="mt small" onClick={() => navigate('/tables')}>Open floor plan →</button>
        </Card>

        <Card k="top" title="Top sellers today">
          {data.top_items.length === 0 && <div className="muted">No sales yet today.</div>}
          {data.top_items.map((i) => (
            <div className="row" key={i.name} style={{ padding: '0.2rem 0' }}>
              <span className="grow">{i.name}</span>
              <strong>{i.qty}×</strong>
            </div>
          ))}
        </Card>

        <Card k="bookings" title="Upcoming bookings">
          {data.bookings.length === 0 && <div className="muted">Nothing booked for the rest of today.</div>}
          {data.bookings.map((b) => (
            <div className="row" key={b.id} style={{ padding: '0.2rem 0' }}>
              <strong style={{ minWidth: 56 }}>{time(b.reserved_at)}</strong>
              <span className="grow">{b.name} · {b.party_size} pax</span>
              <span className="muted small">{b.table_name ?? 'no table yet'}</span>
            </div>
          ))}
          <button className="mt small" onClick={() => navigate('/bookings')}>All bookings →</button>
        </Card>

        <Card k="stock" title="Low stock">
          {data.low_items.length === 0 && data.low_ingredients.length === 0 && (
            <div className="muted">All good — nothing under its threshold. ✅</div>
          )}
          {data.low_items.map((i) => (
            <div className="row" key={i.name} style={{ padding: '0.2rem 0' }}>
              <span className="grow">{i.name}</span>
              <span style={{ color: i.stock_qty <= 0 ? 'var(--danger)' : 'var(--warn)', fontWeight: 700 }}>
                {i.stock_qty} left
              </span>
            </div>
          ))}
          {data.low_ingredients.map((i) => (
            <div className="row" key={i.name} style={{ padding: '0.2rem 0' }}>
              <span className="grow">{i.name} <span className="muted small">(ingredient)</span></span>
              <span style={{ color: i.stock_qty <= 0 ? 'var(--danger)' : 'var(--warn)', fontWeight: 700 }}>
                {i.stock_qty} {i.unit}
              </span>
            </div>
          ))}
        </Card>

        <Card k="promos" title="Running promotions">
          {data.active_promos.length === 0 && <div className="muted">No promotion is active right now.</div>}
          {data.active_promos.map((p) => (
            <div key={p} style={{ padding: '0.2rem 0' }}>🏷 {p}</div>
          ))}
        </Card>
      </div>
    </div>
  );
}

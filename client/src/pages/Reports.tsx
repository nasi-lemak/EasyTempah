import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useMoney, useStore } from '../store';

interface Summary {
  orders: number;
  gross_cents: number;
  discounts_cents: number;
  promos_cents: number;
  tax_cents: number;
  service_cents: number;
  covers: number;
  void_orders: number;
  avg_order_cents: number;
  refunds_cents: number;
  refund_count: number;
  net_cents: number;
  by_type: { type: string; orders: number; total_cents: number }[];
  by_platform: {
    platform: string;
    label: string;
    orders: number;
    gross_cents: number;
    commission_pct: number;
    est_commission_cents: number;
    est_net_cents: number;
  }[];
}

interface PaymentRow { method: string; payments: number; total_cents: number }
interface HourRow { hour: string; orders: number; total_cents: number }
interface DayRow { day: string; orders: number; total_cents: number }
interface MenuPerfRow {
  item_id: number | null;
  name: string;
  category_id: number | null;
  category_name: string | null;
  station: string;
  qty: number;
  revenue_cents: number;
  prev_qty: number;
  unit_cost_cents: number | null;
}
interface CashierRow {
  id: number;
  name: string;
  orders_opened: number;
  payments_taken: number;
  collected_cents: number;
  refunded_cents: number;
}

export default function Reports() {
  const money = useMoney();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);
  const [staffHours, setStaffHours] = useState<
    { id: number; name: string; role: string; entries: number; hours: number; still_in: number }[]
  >([]);
  const [menuPerf, setMenuPerf] = useState<MenuPerfRow[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [prevDays, setPrevDays] = useState<DayRow[]>([]);
  const [error, setError] = useState('');
  const token = useStore((s) => s.token);

  const load = useCallback(() => {
    const q = `?from=${from}&to=${to}`;
    setError('');
    Promise.all([
      api.get<Summary>(`/api/reports/summary${q}`),
      api.get<{ payments: PaymentRow[] }>(`/api/reports/payments${q}`),
      api.get<{ hours: HourRow[] }>(`/api/reports/hourly${q}`),
      api.get<{ cashiers: CashierRow[] }>(`/api/reports/cashiers${q}`),
      api.get<{ staff: typeof staffHours }>(`/api/reports/hours${q}`),
      api.get<{ items: MenuPerfRow[] }>(`/api/reports/menu${q}`),
      api.get<{ days: DayRow[] }>(`/api/reports/daily${q}`),
      (() => {
        // Previous window of equal length, for the trend overlay.
        const span = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
        const pFrom = new Date(Date.parse(from) - span * 864e5).toISOString().slice(0, 10);
        const pTo = new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10);
        return api.get<{ days: DayRow[] }>(`/api/reports/daily?from=${pFrom}&to=${pTo}`);
      })(),
    ])
      .then(([s, p, h, c, sh, mp, d, pd]) => {
        setSummary(s);
        setPayments(p.payments);
        setHours(h.hours);
        setCashiers(c.cashiers);
        setStaffHours(sh.staff);
        setMenuPerf(mp.items);
        setDays(d.days);
        setPrevDays(pd.days);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reports'));
  }, [from, to]);
  useEffect(load, [load]);

  const exportCsv = async (type: 'orders' | 'items' | 'payments') => {
    setError('');
    try {
      const res = await fetch(`/api/reports/export?type=${type}&from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `easytempah-${type}-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const maxHour = Math.max(1, ...hours.map((h) => h.total_cents));

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Reports</h1>
        <label style={{ margin: 0 }}>From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label style={{ margin: 0 }}>To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={() => exportCsv('orders')}>⬇ Orders CSV</button>
        <button onClick={() => exportCsv('items')}>⬇ Items CSV</button>
        <button onClick={() => exportCsv('payments')}>⬇ Payments CSV</button>
      </div>
      {error && <div className="error-text mb">{error}</div>}

      {summary && (
        <div className="stat-grid mb">
          <div className="stat"><div className="label">Gross sales</div><div className="value">{money(summary.gross_cents)}</div></div>
          <div className="stat"><div className="label">Net sales</div><div className="value">{money(summary.net_cents)}</div></div>
          {summary.refunds_cents > 0 && (
            <div className="stat"><div className="label">Refunds ({summary.refund_count})</div><div className="value" style={{ color: 'var(--danger)' }}>-{money(summary.refunds_cents)}</div></div>
          )}
          <div className="stat"><div className="label">Orders</div><div className="value">{summary.orders}</div></div>
          <div className="stat"><div className="label">Avg order</div><div className="value">{money(summary.avg_order_cents)}</div></div>
          <div className="stat"><div className="label">Covers</div><div className="value">{summary.covers}</div></div>
          <div className="stat"><div className="label">Discounts</div><div className="value">{money(summary.discounts_cents)}</div></div>
          <div className="stat"><div className="label">Promotions</div><div className="value">{money(summary.promos_cents)}</div></div>
          <div className="stat"><div className="label">Tax collected</div><div className="value">{money(summary.tax_cents)}</div></div>
          <div className="stat"><div className="label">Service charge</div><div className="value">{money(summary.service_cents)}</div></div>
          <div className="stat"><div className="label">Voided orders</div><div className="value">{summary.void_orders}</div></div>
        </div>
      )}

      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div className="panel grow" style={{ minWidth: 300 }}>
          <h2>Sales by hour</h2>
          {hours.length === 0 && <div className="muted">No sales in this range.</div>}
          {hours.map((h) => (
            <div className="bar-row" key={h.hour}>
              <span className="bar-label">{h.hour}:00</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(h.total_cents / maxHour) * 100}%` }} />
              </span>
              <span className="bar-value">{money(h.total_cents)} · {h.orders}</span>
            </div>
          ))}
        </div>

        <div className="panel" style={{ minWidth: 280 }}>
          <h2>Payment mix</h2>
          <table className="data">
            <tbody>
              {payments.map((p) => (
                <tr key={p.method}>
                  <td>{p.method}</td>
                  <td className="num">{p.payments}×</td>
                  <td className="num">{money(p.total_cents)}</td>
                </tr>
              ))}
              {payments.length === 0 && <tr><td className="muted">—</td></tr>}
            </tbody>
          </table>
          {summary && summary.by_type.length > 0 && (
            <>
              <h2 className="mt">By order type</h2>
              <table className="data">
                <tbody>
                  {summary.by_type.map((t) => (
                    <tr key={t.type}>
                      <td>{t.type.replace('_', ' ')}</td>
                      <td className="num">{t.orders}×</td>
                      <td className="num">{money(t.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {cashiers.length > 0 && (
        <div className="panel mt">
          <h2>By staff member</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Staff</th><th className="num">Orders opened</th><th className="num">Payments taken</th>
                <th className="num">Collected</th><th className="num">Refunds given</th>
              </tr>
            </thead>
            <tbody>
              {cashiers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">{c.orders_opened}</td>
                  <td className="num">{c.payments_taken}</td>
                  <td className="num">{money(c.collected_cents)}</td>
                  <td className="num" style={{ color: c.refunded_cents ? 'var(--danger)' : undefined }}>
                    {c.refunded_cents ? money(c.refunded_cents) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {staffHours.length > 0 && (
        <div className="panel mt">
          <h2>Staff hours (time clock)</h2>
          <table className="data">
            <thead>
              <tr><th>Staff</th><th>Role</th><th className="num">Entries</th><th className="num">Hours</th><th></th></tr>
            </thead>
            <tbody>
              {staffHours.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="muted">{s.role}</td>
                  <td className="num">{s.entries}</td>
                  <td className="num">{s.hours.toFixed(1)}</td>
                  <td>{s.still_in > 0 && <span className="badge open">on the clock</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary && summary.by_platform.length > 0 && (
        <div className="panel mt">
          <h2>Delivery platforms</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Platform</th><th className="num">Orders</th><th className="num">Gross</th>
                <th className="num">Est. commission</th><th className="num">Est. net payout</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_platform.map((p) => (
                <tr key={p.platform}>
                  <td>{p.label}</td>
                  <td className="num">{p.orders}</td>
                  <td className="num">{money(p.gross_cents)}</td>
                  <td className="num" style={{ color: 'var(--danger)' }}>
                    -{money(p.est_commission_cents)} <span className="muted small">({p.commission_pct}%)</span>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(p.est_net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Net payout is an estimate from the configured commission rate — reconcile against the
            platform's actual settlement report.
          </p>
        </div>
      )}

      <DailyTrend from={from} to={to} days={days} prevDays={prevDays} money={money} />
      <MenuPerformance rows={menuPerf} money={money} />
    </div>
  );
}

/** Revenue per day, with the previous equal-length window overlaid for comparison. */
function DailyTrend({
  from,
  to,
  days,
  prevDays,
  money,
}: {
  from: string;
  to: string;
  days: DayRow[];
  prevDays: DayRow[];
  money: (c: number | null | undefined) => string;
}) {
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  if (span < 3) return null; // a 1–2 day range has no trend to draw

  // Fill missing days with zeros so gaps read as zero-sales days, not skips.
  const fill = (rows: DayRow[], start: string): number[] => {
    const map = new Map(rows.map((r) => [r.day, r.total_cents]));
    return Array.from({ length: span }, (_, i) => {
      const d = new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10);
      return map.get(d) ?? 0;
    });
  };
  const prevFrom = new Date(Date.parse(from) - span * 864e5).toISOString().slice(0, 10);
  const cur = fill(days, from);
  const prev = fill(prevDays, prevFrom);

  const W = 680, H = 220, L = 56, R = 16, T = 14, B = 26;
  const innerW = W - L - R, innerH = H - T - B;
  const rawMax = Math.max(1, ...cur, ...prev);
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil(rawMax / step) * step;
  const x = (i: number) => L + (span === 1 ? innerW / 2 : (i / (span - 1)) * innerW);
  const y = (v: number) => T + innerH - (v / yMax) * innerH;
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dayLabel = (start: string, i: number) =>
    new Date(Date.parse(start) + i * 864e5).toLocaleDateString([], { day: '2-digit', month: '2-digit' });

  return (
    <div className="panel mt">
      <div className="row wrap">
        <h2 className="grow">Daily sales</h2>
        <span className="small"><span style={{ color: 'var(--accent)' }}>━</span> This period</span>
        <span className="small muted">┄ Previous {span} days</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 760, display: 'block' }} role="img" aria-label="Daily sales trend">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(yMax * f)} y2={y(yMax * f)} stroke="var(--border)" strokeWidth={1} />
              <text x={L - 6} y={y(yMax * f) + 4} textAnchor="end" fontSize={11} fill="var(--text-dim)">
                {money(yMax * f).replace('.00', '')}
              </text>
            </g>
          ))}
          <path d={path(prev)} fill="none" stroke="var(--text-dim)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
          <path d={path(cur)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          {cur.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--accent)" stroke="var(--bg-panel)" strokeWidth={2}>
              <title>{dayLabel(from, i)}: {money(v)} (previous {dayLabel(prevFrom, i)}: {money(prev[i])})</title>
            </circle>
          ))}
          <text x={x(span - 1)} y={y(cur[span - 1]) - 9} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--text)">
            {money(cur[span - 1])}
          </text>
          {[0, Math.floor((span - 1) / 2), span - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
              {dayLabel(from, i)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Trend chip: this period's quantity vs the previous equal window. */
function TrendChip({ qty, prev }: { qty: number; prev: number }) {
  if (prev === 0) return <span className="badge open">new</span>;
  const pct = Math.round(((qty - prev) / prev) * 100);
  if (Math.abs(pct) < 5) return <span className="badge served">→ flat</span>;
  return pct > 0
    ? <span className="badge ready">▲ {pct}%</span>
    : <span className="badge cancelled">▼ {Math.abs(pct)}%</span>;
}

/** Item popularity with food/drink and category filters, plus the menu-engineering quadrant. */
function MenuPerformance({
  rows,
  money,
}: {
  rows: MenuPerfRow[];
  money: (c: number | null | undefined) => string;
}) {
  const [station, setStation] = useState<'all' | 'kitchen' | 'bar'>('all');
  const [cat, setCat] = useState(0);

  const categories = [...new Map(rows.filter((r) => r.category_id).map((r) => [r.category_id!, r.category_name ?? ''])).entries()];
  const filtered = rows.filter(
    (r) => (station === 'all' || r.station === station) && (cat === 0 || r.category_id === cat),
  );
  const maxQty = Math.max(1, ...filtered.map((r) => r.qty));
  const totalQtyAll = Math.max(1, rows.reduce((s, r) => s + r.qty, 0));

  // Menu engineering: needs a cost basis (recipe) and sales. Margin from realized revenue.
  const plotted = rows
    .filter((r) => r.unit_cost_cents != null && r.qty > 0 && r.revenue_cents > 0)
    .map((r) => {
      const unitRev = r.revenue_cents / r.qty;
      return {
        name: r.name,
        qty: r.qty,
        share: (r.qty / totalQtyAll) * 100,
        margin: Math.max(-50, Math.min(100, ((unitRev - r.unit_cost_cents!) / unitRev) * 100)),
      };
    });
  const meanShare = plotted.length ? plotted.reduce((s, p) => s + p.share, 0) / plotted.length : 0;
  const meanMargin = plotted.length ? plotted.reduce((s, p) => s + p.margin, 0) / plotted.length : 0;
  const noRecipe = rows.filter((r) => r.unit_cost_cents == null && r.item_id != null).length;

  const W = 680, H = 300, L = 52, R = 16, T = 18, B = 34;
  const xMax = Math.max(5, ...plotted.map((p) => p.share)) * 1.15;
  const yLo = Math.min(0, ...plotted.map((p) => p.margin)) - 5;
  const yHi = 100;
  const px = (s: number) => L + (s / xMax) * (W - L - R);
  const py = (m: number) => T + (1 - (m - yLo) / (yHi - yLo)) * (H - T - B);
  const labelled = [...plotted].sort((a, b) => b.qty - a.qty).slice(0, 10);

  return (
    <div className="panel mt">
      <div className="row wrap mb">
        <h2 className="grow">Menu performance</h2>
        {(['all', 'kitchen', 'bar'] as const).map((s) => (
          <button key={s} className={station === s ? 'primary' : ''} onClick={() => setStation(s)}>
            {s === 'all' ? 'All' : s === 'kitchen' ? '🍳 Food' : '🥤 Drinks'}
          </button>
        ))}
        <select value={cat} onChange={(e) => setCat(Number(e.target.value))}>
          <option value={0}>All categories</option>
          {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <table className="data">
        <thead>
          <tr><th>Item</th><th style={{ width: '32%' }}>Qty sold</th><th className="num">Share</th><th className="num">Revenue</th><th>vs prev.</th></tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={`${r.item_id}:${r.name}`}>
              <td>{r.name}{r.item_id == null && <span className="muted small"> (open item)</span>}</td>
              <td>
                <span className="bar-track" style={{ display: 'inline-block', width: '70%', verticalAlign: 'middle' }}>
                  <span className="bar-fill" style={{ width: `${(r.qty / maxQty) * 100}%` }} />
                </span>
                <span className="small" style={{ marginLeft: 6 }}>{r.qty}</span>
              </td>
              <td className="num">{((r.qty / totalQtyAll) * 100).toFixed(1)}%</td>
              <td className="num">{money(r.revenue_cents)}</td>
              <td><TrendChip qty={r.qty} prev={r.prev_qty} /></td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={5} className="muted">No item sales in this range.</td></tr>}
        </tbody>
      </table>

      {plotted.length >= 3 && (
        <>
          <h3 className="mt">Menu engineering — popularity × margin</h3>
          <p className="muted small">
            Stars: promote them. Plowhorses: popular but thin — consider re-pricing. Puzzles: profitable but
            unseen — feature them. Dogs: candidates to cut. Margin uses each item&rsquo;s ingredient recipe cost
            against realized selling price{noRecipe > 0 ? `; ${noRecipe} item${noRecipe === 1 ? ' has' : 's have'} no recipe and are not plotted` : ''}.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 760, display: 'block' }} role="img" aria-label="Menu engineering quadrant">
              <line x1={px(meanShare)} x2={px(meanShare)} y1={T} y2={H - B} stroke="var(--border)" strokeDasharray="4 4" />
              <line x1={L} x2={W - R} y1={py(meanMargin)} y2={py(meanMargin)} stroke="var(--border)" strokeDasharray="4 4" />
              <text x={W - R - 4} y={T + 12} textAnchor="end" fontSize={10} fill="var(--text-dim)" letterSpacing={1}>STARS</text>
              <text x={L + 4} y={T + 12} fontSize={10} fill="var(--text-dim)" letterSpacing={1}>PUZZLES</text>
              <text x={W - R - 4} y={H - B - 6} textAnchor="end" fontSize={10} fill="var(--text-dim)" letterSpacing={1}>PLOWHORSES</text>
              <text x={L + 4} y={H - B - 6} fontSize={10} fill="var(--text-dim)" letterSpacing={1}>DOGS</text>
              {plotted.map((p) => (
                <circle key={p.name} cx={px(p.share)} cy={py(p.margin)} r={5} fill="var(--accent)" stroke="var(--bg-panel)" strokeWidth={2}>
                  <title>{p.name}: {p.qty} sold ({p.share.toFixed(1)}% share), {p.margin.toFixed(0)}% margin</title>
                </circle>
              ))}
              {labelled.map((p) => (
                <text key={p.name} x={px(p.share) + 8} y={py(p.margin) + 4} fontSize={10} fill="var(--text)">{p.name}</text>
              ))}
              <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-dim)">Share of items sold →</text>
              <text x={14} y={(T + H - B) / 2} fontSize={11} fill="var(--text-dim)" transform={`rotate(-90 14 ${(T + H - B) / 2})`} textAnchor="middle">Gross margin % →</text>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

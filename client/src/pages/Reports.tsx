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

interface ItemRow { name: string; qty: number; total_cents: number }
interface PaymentRow { method: string; payments: number; total_cents: number }
interface HourRow { hour: string; orders: number; total_cents: number }
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
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);
  const [staffHours, setStaffHours] = useState<
    { id: number; name: string; role: string; entries: number; hours: number; still_in: number }[]
  >([]);
  const [error, setError] = useState('');
  const token = useStore((s) => s.token);

  const load = useCallback(() => {
    const q = `?from=${from}&to=${to}`;
    setError('');
    Promise.all([
      api.get<Summary>(`/api/reports/summary${q}`),
      api.get<{ items: ItemRow[] }>(`/api/reports/items${q}`),
      api.get<{ payments: PaymentRow[] }>(`/api/reports/payments${q}`),
      api.get<{ hours: HourRow[] }>(`/api/reports/hourly${q}`),
      api.get<{ cashiers: CashierRow[] }>(`/api/reports/cashiers${q}`),
      api.get<{ staff: typeof staffHours }>(`/api/reports/hours${q}`),
    ])
      .then(([s, i, p, h, c, sh]) => {
        setSummary(s);
        setItems(i.items);
        setPayments(p.payments);
        setHours(h.hours);
        setCashiers(c.cashiers);
        setStaffHours(sh.staff);
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

      <div className="panel mt">
        <h2>Top items</h2>
        <table className="data">
          <thead>
            <tr><th>Item</th><th className="num">Qty sold</th><th className="num">Revenue</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td className="num">{i.qty}</td>
                <td className="num">{money(i.total_cents)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={3} className="muted">No item sales in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

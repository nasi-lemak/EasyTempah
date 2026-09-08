import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useMoney } from '../store';

interface Summary {
  orders: number;
  gross_cents: number;
  discounts_cents: number;
  tax_cents: number;
  service_cents: number;
  covers: number;
  void_orders: number;
  avg_order_cents: number;
  refunds_cents: number;
  refund_count: number;
  net_cents: number;
  by_type: { type: string; orders: number; total_cents: number }[];
}

interface ItemRow { name: string; qty: number; total_cents: number }
interface PaymentRow { method: string; payments: number; total_cents: number }
interface HourRow { hour: string; orders: number; total_cents: number }

export default function Reports() {
  const money = useMoney();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [hours, setHours] = useState<HourRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const q = `?from=${from}&to=${to}`;
    setError('');
    Promise.all([
      api.get<Summary>(`/api/reports/summary${q}`),
      api.get<{ items: ItemRow[] }>(`/api/reports/items${q}`),
      api.get<{ payments: PaymentRow[] }>(`/api/reports/payments${q}`),
      api.get<{ hours: HourRow[] }>(`/api/reports/hourly${q}`),
    ])
      .then(([s, i, p, h]) => {
        setSummary(s);
        setItems(i.items);
        setPayments(p.payments);
        setHours(h.hours);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load reports'));
  }, [from, to]);
  useEffect(load, [load]);

  const maxHour = Math.max(1, ...hours.map((h) => h.total_cents));

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Reports</h1>
        <label style={{ margin: 0 }}>From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label style={{ margin: 0 }}>To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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

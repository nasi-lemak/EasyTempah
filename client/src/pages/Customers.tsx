import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import { useMoney } from '../store';
import { formatDateTime } from '../time';
import type { Customer } from '../types';

interface PointMovement {
  id: number;
  delta: number;
  reason: string;
  order_no: string | null;
  user_name: string | null;
  created_at: string;
}

export default function Customers() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [adjusting, setAdjusting] = useState<Customer | null>(null);
  const [history, setHistory] = useState<{ customer: Customer; movements: PointMovement[] } | null>(null);
  const [deltaStr, setDeltaStr] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<{ customers: Customer[] }>(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setCustomers(r.customers))
      .catch((e) => setError(String(e.message ?? e)));
  }, [q]);
  useEffect(load, [load]);

  const adjust = async () => {
    setError('');
    try {
      await api.post(`/api/customers/${adjusting!.id}/adjust`, {
        delta: parseInt(deltaStr, 10),
        reason,
      });
      setAdjusting(null);
      setDeltaStr('');
      setReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const openHistory = async (customer: Customer) => {
    const r = await api.get<{ movements: PointMovement[] }>(`/api/customers/${customer.id}/movements`);
    setHistory({ customer, movements: r.movements });
  };

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Members</h1>
        <input placeholder="Search phone or name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="error-text mb">{error}</div>}
      <table className="data">
        <thead>
          <tr>
            <th>Phone</th><th>Name</th><th className="num">Points</th><th className="num">Visits</th>
            <th className="num">Lifetime spend</th><th>Last visit</th><th></th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.phone}</td>
              <td>{c.name ?? <span className="muted">—</span>}</td>
              <td className="num" style={{ fontWeight: 700 }}>{c.points}</td>
              <td className="num">{c.visits}</td>
              <td className="num">{money(c.total_spent_cents)}</td>
              <td className="small muted">{formatDateTime(c.last_visit_at)}</td>
              <td className="right">
                <button onClick={() => setAdjusting(c)}>Adjust</button>{' '}
                <button className="ghost" onClick={() => openHistory(c)}>History</button>
              </td>
            </tr>
          ))}
          {customers.length === 0 && (
            <tr><td colSpan={7} className="muted">No members yet — they join by phone number at payment.</td></tr>
          )}
        </tbody>
      </table>

      {adjusting && (
        <Modal title={`Adjust points — ${adjusting.name ?? adjusting.phone}`} onClose={() => setAdjusting(null)}>
          <p className="muted small">Current: {adjusting.points} points</p>
          <label>Change (+ goodwill, − correction)</label>
          <input inputMode="numeric" value={deltaStr} onChange={(e) => setDeltaStr(e.target.value)} style={{ width: '100%' }} className="mb" />
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. refund claw-back / birthday bonus" style={{ width: '100%' }} />
          <button className="primary mt" onClick={adjust}>Apply</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {history && (
        <Modal title={`Points history — ${history.customer.name ?? history.customer.phone}`} onClose={() => setHistory(null)} wide>
          <table className="data">
            <thead><tr><th>When</th><th className="num">Δ</th><th>Reason</th><th>Order</th><th>By</th></tr></thead>
            <tbody>
              {history.movements.map((m) => (
                <tr key={m.id}>
                  <td className="small muted">{formatDateTime(m.created_at)}</td>
                  <td className="num" style={{ color: m.delta > 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {m.delta > 0 ? '+' : ''}{m.delta}
                  </td>
                  <td>{m.reason}</td>
                  <td className="muted small">{m.order_no ?? '—'}</td>
                  <td>{m.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

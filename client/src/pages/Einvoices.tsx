import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useMoney, useStore } from '../store';
import { formatDateTime } from '../time';
import type { Einvoice } from '../types';

const STATUS_BADGE: Record<string, string> = {
  valid: 'paid',
  submitted: 'sent',
  pending: 'pending',
  invalid: 'void',
  error: 'void',
};

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default function Einvoices() {
  const money = useMoney();
  const einvoiceCfg = useStore((s) => s.einvoice);
  const [rows, setRows] = useState<Einvoice[]>([]);
  const [period, setPeriod] = useState(lastMonth());
  const [preview, setPreview] = useState<{ orders: number; total_cents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.get<{ einvoices: Einvoice[] }>('/api/einvoice').then((r) => setRows(r.einvoices)).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(period)) return;
    api
      .get<{ orders: number; total_cents: number }>(`/api/einvoice/consolidate/preview?period=${period}`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [period, rows]);

  const consolidate = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.post<{ einvoice: Einvoice }>('/api/einvoice/consolidate', { period });
      setNotice(`Consolidated e-invoice for ${period} submitted — status: ${r.einvoice.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (row: Einvoice) => {
    setError('');
    try {
      await api.post(`/api/einvoice/${row.id}/refresh`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div>
      <h1>E-Invoices (LHDN MyInvois)</h1>
      {!einvoiceCfg?.enabled && (
        <div className="panel mb" style={{ borderColor: 'var(--warn)' }}>
          E-invoicing is not enabled. An admin can configure supplier details and the MyInvois
          connection under Settings.
        </div>
      )}

      <div className="panel mb">
        <h2>Monthly consolidated e-invoice</h2>
        <p className="muted small">
          Walk-in receipts that were not individually e-invoiced are rolled into one consolidated
          e-invoice per month (buyer: General Public), as LHDN requires. Submit after the month ends.
        </p>
        <div className="row wrap">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {preview && (
            <span className="muted small">
              {preview.orders} un-invoiced receipt(s) · {money(preview.total_cents)}
            </span>
          )}
          <button className="primary" onClick={consolidate} disabled={busy || !preview || preview.orders === 0}>
            {busy ? 'Submitting…' : `Consolidate ${period}`}
          </button>
        </div>
        {notice && <div className="mt" style={{ color: 'var(--accent)' }}>{notice}</div>}
      </div>

      {error && <div className="error-text mb">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Doc</th><th>Type</th><th>Order / Period</th><th>Status</th>
            <th className="num">Amount</th><th>Created</th><th>UUID</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small">{r.internal_id}</td>
              <td>{r.type}</td>
              <td>{r.type === 'consolidated' ? r.period : `#${r.order_no ?? r.order_id}`}</td>
              <td>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                {r.error && <div className="small error-text">{r.error}</div>}
              </td>
              <td className="num">{money(r.total_cents)}</td>
              <td className="small muted">{formatDateTime(r.created_at)}</td>
              <td className="small mono" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.portal_url ? (
                  <a href={r.portal_url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>{r.uuid}</a>
                ) : (
                  r.uuid ?? '—'
                )}
              </td>
              <td className="right">
                {r.status === 'submitted' && <button onClick={() => refresh(r)}>Check</button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No e-invoices yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ConfirmDialog } from '../components/Dialogs';
import Modal from '../components/Modal';
import { useMoney, useStore } from '../store';
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

interface MemberExport {
  customer: Customer;
  movements: { delta: number; reason: string; created_at: string }[];
  orders: { order_no: string; receipt_no: string | null; closed_at: string; total_cents: number }[];
}

export default function Customers() {
  const money = useMoney();
  const business = useStore((s) => s.business);
  const [q, setQ] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [adjusting, setAdjusting] = useState<Customer | null>(null);
  const [history, setHistory] = useState<{ customer: Customer; movements: PointMovement[] } | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [dataSheet, setDataSheet] = useState<MemberExport | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editConsent, setEditConsent] = useState(false);
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

  const openEdit = (c: Customer) => {
    setEditing(c);
    setEditName(c.name ?? '');
    setEditPhone(c.phone);
    setEditConsent(false);
    setError('');
  };

  const saveEdit = async () => {
    setError('');
    try {
      await api.put(`/api/customers/${editing!.id}`, {
        name: editName,
        phone: editPhone,
        ...(editConsent ? { consent: true } : {}),
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/api/customers/${deleting!.id}`);
      setDeleting(null);
      load();
    } catch (e) {
      setDeleting(null);
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const openData = async (c: Customer) => {
    const r = await api.get<MemberExport>(`/api/customers/${c.id}/export`);
    setDataSheet(r);
  };

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Members</h1>
        <input placeholder="Search phone or name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="error-text mb" role="alert">{error}</div>}
      <table className="data">
        <thead>
          <tr>
            <th>Phone</th><th>Name</th><th className="num">Points</th><th className="num">Visits</th>
            <th className="num">Lifetime spend</th><th>Last visit</th><th>Consent</th><th></th>
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
              <td>
                {c.consent_at
                  ? <span title={`Agreed ${formatDateTime(c.consent_at)}`}>✅</span>
                  : <span className="muted" title="No consent recorded — open Edit to record it">—</span>}
              </td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button onClick={() => setAdjusting(c)}>Adjust</button>{' '}
                <button className="ghost" onClick={() => openHistory(c)}>History</button>{' '}
                <button className="ghost" onClick={() => openEdit(c)}>Edit</button>{' '}
                <button className="ghost" onClick={() => openData(c)}>Data</button>{' '}
                <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(c)}>Delete</button>
              </td>
            </tr>
          ))}
          {customers.length === 0 && (
            <tr><td colSpan={8} className="muted">No members yet — they join by phone number at payment.</td></tr>
          )}
        </tbody>
      </table>
      <div className="muted small mt">
        PDPA: members join only with recorded consent, can ask to see (Data), fix (Edit) or erase
        (Delete) their details at any time. Deleting removes the identity but keeps anonymous totals.
      </div>

      {adjusting && (
        <Modal title={`Adjust points — ${adjusting.name ?? adjusting.phone}`} onClose={() => setAdjusting(null)}>
          <p className="muted small">Current: {adjusting.points} points</p>
          <label>Change (+ goodwill, − correction)</label>
          <input inputMode="numeric" value={deltaStr} onChange={(e) => setDeltaStr(e.target.value)} style={{ width: '100%' }} className="mb" />
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. refund claw-back / birthday bonus" style={{ width: '100%' }} />
          <button className="primary mt" onClick={adjust}>Apply</button>
          {error && <div className="error-text mt" role="alert">{error}</div>}
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit member — ${editing.name ?? editing.phone}`} onClose={() => setEditing(null)}>
          <label>Name</label>
          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%' }} className="mb" />
          <label>Phone</label>
          <input inputMode="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ width: '100%' }} className="mb" />
          {editing.consent_at ? (
            <p className="muted small">Consent recorded {formatDateTime(editing.consent_at)}.</p>
          ) : (
            <label className="row small" style={{ gap: '0.4rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={editConsent} onChange={(e) => setEditConsent(e.target.checked)} style={{ width: 'auto' }} />
              Customer has now agreed to the privacy notice (records today's date)
            </label>
          )}
          <button className="primary mt" onClick={saveEdit}>Save</button>
          {error && <div className="error-text mt" role="alert">{error}</div>}
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete member — ${deleting.name ?? deleting.phone}?`}
          message={`Their phone number and name are erased permanently and ${deleting.points} unused point(s) are forfeited. Past sales stay in reports as anonymous totals. This cannot be undone.`}
          confirmLabel="Erase member"
          danger
          onConfirm={doDelete}
          onClose={() => setDeleting(null)}
        />
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

      {dataSheet && (
        <Modal title="Member data (PDPA access request)" onClose={() => setDataSheet(null)} wide>
          <div className="print-sheet">
            <h3>{business?.name ?? 'EasyTempah'} — personal data we hold</h3>
            <p className="small">
              Prepared {new Date().toLocaleString()} for the member below, under the Personal Data
              Protection Act 2010 right of access.
            </p>
            <table className="data mb">
              <tbody>
                <tr><td>Name</td><td>{dataSheet.customer.name ?? '—'}</td></tr>
                <tr><td>Phone</td><td className="mono">{dataSheet.customer.phone}</td></tr>
                <tr><td>Joined</td><td>{formatDateTime(dataSheet.customer.created_at)}</td></tr>
                <tr><td>Consent recorded</td><td>{dataSheet.customer.consent_at ? formatDateTime(dataSheet.customer.consent_at) : 'not recorded'}</td></tr>
                <tr><td>Points balance</td><td>{dataSheet.customer.points}</td></tr>
                <tr><td>Visits</td><td>{dataSheet.customer.visits}</td></tr>
                <tr><td>Lifetime spend</td><td>{money(dataSheet.customer.total_spent_cents)}</td></tr>
                <tr><td>Last visit</td><td>{formatDateTime(dataSheet.customer.last_visit_at)}</td></tr>
              </tbody>
            </table>
            <h3>Point movements ({dataSheet.movements.length})</h3>
            <table className="data mb">
              <thead><tr><th>When</th><th className="num">Δ</th><th>Reason</th></tr></thead>
              <tbody>
                {dataSheet.movements.map((m, i) => (
                  <tr key={i}>
                    <td className="small">{formatDateTime(m.created_at)}</td>
                    <td className="num">{m.delta > 0 ? '+' : ''}{m.delta}</td>
                    <td>{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Linked orders ({dataSheet.orders.length} most recent)</h3>
            <table className="data">
              <thead><tr><th>Order</th><th>Receipt</th><th>When</th><th className="num">Total</th></tr></thead>
              <tbody>
                {dataSheet.orders.map((o) => (
                  <tr key={o.order_no}>
                    <td className="mono small">{o.order_no}</td>
                    <td className="mono small">{o.receipt_no ?? '—'}</td>
                    <td className="small">{formatDateTime(o.closed_at)}</td>
                    <td className="num">{money(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primary mt" onClick={() => window.print()}>Print for the member</button>
        </Modal>
      )}
    </div>
  );
}

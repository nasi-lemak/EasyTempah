import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import { useMoney } from '../store';
import { formatDateTime } from '../time';
import type { Shift, ShiftSummary } from '../types';
import { useEvents } from '../useEvents';

interface CashMovement {
  id: number;
  type: 'in' | 'out';
  amount_cents: number;
  reason: string;
  user_name: string;
  created_at: string;
}

export default function ShiftPage() {
  const money = useMoney();
  const [shift, setShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [showOpen, setShowOpen] = useState(false);
  const [showMove, setShowMove] = useState<'in' | 'out' | null>(null);
  const [showClose, setShowClose] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<{ variance_cents: number } | null>(null);

  const load = useCallback(() => {
    api
      .get<{ shift: Shift | null; summary?: ShiftSummary; movements?: CashMovement[] }>('/api/shifts/current')
      .then((r) => {
        setShift(r.shift);
        setSummary(r.summary ?? null);
        setMovements(r.movements ?? []);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['shifts', 'orders'], load);

  const cents = () => Math.round(parseFloat(amountStr || '0') * 100);

  const doOpen = async () => {
    setError('');
    try {
      await api.post('/api/shifts/open', { opening_float_cents: cents() });
      setShowOpen(false);
      setAmountStr('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const doMove = async () => {
    setError('');
    try {
      await api.post('/api/shifts/cash-movements', {
        type: showMove,
        amount_cents: cents(),
        reason,
      });
      setShowMove(null);
      setAmountStr('');
      setReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const doClose = async () => {
    setError('');
    try {
      const r = await api.post<{ variance_cents: number }>('/api/shifts/close', {
        counted_cash_cents: cents(),
        notes: notes || undefined,
      });
      setShowClose(false);
      setAmountStr('');
      setNotes('');
      setClosed(r);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (!shift) {
    return (
      <div>
        <h1>Shift</h1>
        <div className="panel mt">
          <p className="muted">No shift is open. Open one to start taking payments against a till.</p>
          <button className="primary" onClick={() => setShowOpen(true)}>Open shift</button>
          {closed && (
            <div className="mt">
              Last shift closed with variance{' '}
              <strong style={{ color: closed.variance_cents === 0 ? 'var(--accent)' : 'var(--danger)' }}>
                {money(closed.variance_cents)}
              </strong>
            </div>
          )}
        </div>
        {showOpen && (
          <Modal title="Open shift" onClose={() => setShowOpen(false)}>
            <label>Opening float (RM)</label>
            <input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="200.00" style={{ width: '100%' }} />
            <button className="primary mt" onClick={doOpen}>Open</button>
            {error && <div className="error-text mt">{error}</div>}
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Shift #{shift.id}</h1>
        <button onClick={() => setShowMove('in')}>Cash in</button>
        <button onClick={() => setShowMove('out')}>Cash out</button>
        <button className="danger" onClick={() => setShowClose(true)}>Close shift</button>
      </div>
      <div className="muted small mb">Opened {formatDateTime(shift.opened_at)} · float {money(shift.opening_float_cents)}</div>

      {summary && (
        <div className="stat-grid mb">
          <div className="stat"><div className="label">Total sales</div><div className="value">{money(summary.total_sales_cents)}</div></div>
          <div className="stat"><div className="label">Orders paid</div><div className="value">{summary.orders_paid}</div></div>
          <div className="stat"><div className="label">Cash</div><div className="value">{money(summary.cash_sales_cents)}</div></div>
          <div className="stat"><div className="label">Card</div><div className="value">{money(summary.card_sales_cents)}</div></div>
          <div className="stat"><div className="label">E-Wallet</div><div className="value">{money(summary.ewallet_sales_cents)}</div></div>
          {summary.refunds_cents > 0 && (
            <div className="stat"><div className="label">Refunds</div><div className="value" style={{ color: 'var(--danger)' }}>-{money(summary.refunds_cents)}</div></div>
          )}
          <div className="stat"><div className="label">Expected in drawer</div><div className="value">{money(summary.expected_cash_cents)}</div></div>
        </div>
      )}

      {summary && summary.by_cashier.length > 1 && (
        <div className="panel mb" style={{ maxWidth: 480 }}>
          <h2>By cashier</h2>
          <table className="data">
            <tbody>
              {summary.by_cashier.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num">{c.payments}×</td>
                  <td className="num">{money(c.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary && summary.by_channel.length > 0 && (
        <div className="panel mb" style={{ maxWidth: 480 }}>
          <h2>By payment channel</h2>
          <table className="data">
            <tbody>
              {summary.by_channel.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td className="num">{c.payments}×</td>
                  <td className="num">{money(c.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Cash movements</h2>
      <table className="data">
        <thead>
          <tr><th>When</th><th>Type</th><th>Reason</th><th>By</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id}>
              <td className="small muted">{formatDateTime(m.created_at)}</td>
              <td>{m.type === 'in' ? 'Paid in' : 'Paid out'}</td>
              <td>{m.reason}</td>
              <td>{m.user_name}</td>
              <td className="num">{m.type === 'in' ? '' : '-'}{money(m.amount_cents)}</td>
            </tr>
          ))}
          {movements.length === 0 && <tr><td colSpan={5} className="muted">None yet.</td></tr>}
        </tbody>
      </table>

      {showMove && (
        <Modal title={showMove === 'in' ? 'Cash in (paid in)' : 'Cash out (paid out)'} onClose={() => setShowMove(null)}>
          <label>Amount (RM)</label>
          <input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} style={{ width: '100%' }} className="mb" />
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={showMove === 'out' ? 'e.g. supplier COD' : 'e.g. change top-up'} style={{ width: '100%' }} />
          <button className="primary mt" onClick={doMove}>Record</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {showClose && summary && (
        <Modal title="Close shift" onClose={() => setShowClose(false)}>
          <p className="muted small">
            Expected cash in drawer: <strong>{money(summary.expected_cash_cents)}</strong>. Count the drawer
            by denomination (or type the total) — the variance is recorded.
          </p>
          <DenominationCounter onTotal={(c) => setAmountStr((c / 100).toFixed(2))} />
          <label>Counted cash (RM)</label>
          <input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} style={{ width: '100%' }} className="mb" />
          {amountStr && (
            <div className="muted small mb">
              Variance vs expected:{' '}
              <strong style={{ color: cents() === summary.expected_cash_cents ? 'var(--accent)' : 'var(--warn)' }}>
                {money(cents() - summary.expected_cash_cents)}
              </strong>
            </div>
          )}
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} />
          <button className="danger mt" onClick={doClose}>Close shift</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

/** Count the drawer note by note; the sum lands in the counted-cash field. */
function DenominationCounter({ onTotal }: { onTotal: (cents: number) => void }) {
  const DENOMS = [
    { label: 'RM100', cents: 10000 }, { label: 'RM50', cents: 5000 },
    { label: 'RM20', cents: 2000 }, { label: 'RM10', cents: 1000 },
    { label: 'RM5', cents: 500 }, { label: 'RM1', cents: 100 },
    { label: '50¢', cents: 50 }, { label: '20¢', cents: 20 },
    { label: '10¢', cents: 10 }, { label: '5¢', cents: 5 },
  ];
  const [counts, setCounts] = useState<Record<string, string>>({});
  const total = DENOMS.reduce((s, d) => s + d.cents * (parseInt(counts[d.label] || '0', 10) || 0), 0);
  return (
    <div className="panel mb" style={{ padding: '0.6rem 0.8rem' }}>
      <div className="row wrap" style={{ gap: '0.45rem' }}>
        {DENOMS.map((d) => (
          <label key={d.label} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="small" style={{ width: 46, textAlign: 'right' }}>{d.label} ×</span>
            <input
              inputMode="numeric"
              value={counts[d.label] ?? ''}
              placeholder="0"
              style={{ width: 52, padding: '0.3rem 0.4rem' }}
              onChange={(e) => {
                const next = { ...counts, [d.label]: e.target.value.replace(/\D/g, '') };
                setCounts(next);
                onTotal(DENOMS.reduce((s, x) => s + x.cents * (parseInt(next[x.label] || '0', 10) || 0), 0));
              }}
            />
          </label>
        ))}
      </div>
      <div className="right small mt" style={{ fontWeight: 700 }}>
        Counted: RM {(total / 100).toFixed(2)}
      </div>
    </div>
  );
}

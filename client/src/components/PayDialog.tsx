import { useState } from 'react';
import { api } from '../api';
import { useMoney, useStore } from '../store';
import type { Order, PaymentMethod } from '../types';
import Modal from './Modal';

const QUICK_NOTES = [1000, 2000, 5000, 10000];

export default function PayDialog({
  order,
  onUpdated,
  onPaid,
  onClose,
}: {
  order: Order;
  onUpdated: (order: Order) => void;
  onPaid: (order: Order) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const tax = useStore((s) => s.tax);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountStr, setAmountStr] = useState(''); // in RM, e.g. "12.50"
  const [tenderedStr, setTenderedStr] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastChange, setLastChange] = useState<number | null>(null);

  const balance = order.total_cents - order.paid_cents;

  const parseCents = (s: string): number => Math.round(parseFloat(s || '0') * 100);

  const pay = async (amountCents: number, tenderedCents?: number) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ change_cents: number; paid: boolean; order: Order }>(
        `/api/orders/${order.id}/payments`,
        {
          method,
          amount_cents: amountCents,
          tendered_cents: tenderedCents,
          reference: reference.trim() || undefined,
        },
      );
      setLastChange(method === 'cash' ? r.change_cents : null);
      setAmountStr('');
      setTenderedStr('');
      setReference('');
      if (r.paid) {
        onPaid(r.order);
      } else {
        onUpdated(r.order);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  const payExact = () => {
    // Mirror the server's cash rounding so "Exact" tenders the rounded balance.
    const step = method === 'cash' && tax ? tax.cashRoundingCents : 0;
    const rounded = step > 1 ? Math.round(balance / step) * step : balance;
    pay(rounded, method === 'cash' ? rounded : undefined);
  };

  const payCashTendered = () => {
    const tendered = parseCents(tenderedStr);
    if (!tendered || tendered <= 0) {
      setError('Enter the cash received');
      return;
    }
    pay(tendered, tendered);
  };

  const paySplit = () => {
    const amount = parseCents(amountStr);
    if (!amount || amount <= 0) {
      setError('Enter a split amount');
      return;
    }
    pay(amount, method === 'cash' ? amount : undefined);
  };

  const roundingNote =
    method === 'cash' && tax && tax.cashRoundingCents > 1
      ? `Cash totals round to the nearest ${tax.cashRoundingCents} sen.`
      : null;

  return (
    <Modal title={`Payment — #${order.order_no}`} onClose={onClose}>
      <div className="cart-totals mb" style={{ borderTop: 'none', padding: 0 }}>
        <div className="line">
          <span>Total</span>
          <span className="mono">{money(order.total_cents)}</span>
        </div>
        <div className="line">
          <span>Paid so far</span>
          <span className="mono">{money(order.paid_cents)}</span>
        </div>
        <div className="line grand">
          <span>Balance</span>
          <span className="mono">{money(balance)}</span>
        </div>
      </div>

      <div className="row wrap mb">
        {(['cash', 'card', 'ewallet', 'other'] as PaymentMethod[]).map((m) => (
          <button key={m} className={method === m ? 'primary' : ''} onClick={() => setMethod(m)}>
            {m === 'ewallet' ? 'E-Wallet' : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {method === 'cash' ? (
        <>
          <div className="mb">
            <label>Cash received</label>
            <div className="row">
              <input
                inputMode="decimal"
                value={tenderedStr}
                onChange={(e) => setTenderedStr(e.target.value)}
                placeholder="0.00"
                className="grow"
              />
              <button className="primary" onClick={payCashTendered} disabled={busy}>
                Take cash
              </button>
            </div>
          </div>
          <div className="row wrap mb">
            <button onClick={payExact} disabled={busy}>Exact</button>
            {QUICK_NOTES.map((n) => (
              <button key={n} onClick={() => pay(n, n)} disabled={busy || n < 1}>
                {money(n)}
              </button>
            ))}
          </div>
          {roundingNote && <div className="muted small mb">{roundingNote}</div>}
        </>
      ) : (
        <>
          <div className="mb">
            <label>Reference (approval code / txn id)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <button className="primary mb" onClick={() => pay(balance)} disabled={busy}>
            Charge {money(balance)}
          </button>
        </>
      )}

      <hr style={{ borderColor: 'var(--border)' }} />
      <div className="mb mt">
        <label>Split — pay part of the balance</label>
        <div className="row">
          <input
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.00"
            className="grow"
          />
          <button onClick={paySplit} disabled={busy}>
            Pay part
          </button>
        </div>
      </div>

      {lastChange != null && lastChange > 0 && (
        <div className="mt" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent)' }}>
          Change due: {money(lastChange)}
        </div>
      )}
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

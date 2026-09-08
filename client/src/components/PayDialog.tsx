import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useMoney, useStore } from '../store';
import type { Order, PaymentChannel, PaymentIntent } from '../types';
import Modal from './Modal';

const QUICK_NOTES = [1000, 2000, 5000, 10000];

const FALLBACK_CHANNELS: PaymentChannel[] = [
  { key: 'cash', label: 'Cash', kind: 'cash', enabled: true },
  { key: 'card', label: 'Card', kind: 'card', enabled: true },
  { key: 'ewallet', label: 'E-Wallet', kind: 'ewallet', enabled: true },
  { key: 'other', label: 'Other', kind: 'other', enabled: true },
];

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
  const payments = useStore((s) => s.payments);
  const gateway = useStore((s) => s.gateway);
  const channels = useMemo(
    () => (payments?.channels ?? FALLBACK_CHANNELS).filter((c) => c.enabled),
    [payments],
  );
  const [channelKey, setChannelKey] = useState(channels[0]?.key ?? 'cash');
  const channel = channels.find((c) => c.key === channelKey) ?? channels[0];
  const kind = channel?.kind ?? 'cash';

  const [amountStr, setAmountStr] = useState('');
  const [tenderedStr, setTenderedStr] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastChange, setLastChange] = useState<number | null>(null);
  const [walletQr, setWalletQr] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [intentQr, setIntentQr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const platforms = useStore((s) => s.platforms);
  const platformCfg = order.platform
    ? platforms?.platforms.find((p) => p.key === order.platform)
    : undefined;

  const balance = order.total_cents - order.paid_cents;
  const gatewayActive = !!gateway?.enabled && kind !== 'cash' && !order.platform;

  // Render the intent's dynamic QR (falls back to the static counter payload).
  useEffect(() => {
    let cancelled = false;
    const payload = intent?.qr_payload || payments?.ewalletQrPayload || '';
    if (intent && payload) {
      QRCode.toDataURL(payload, { width: 200, margin: 1 }).then((url) => {
        if (!cancelled) setIntentQr(url);
      });
    } else {
      setIntentQr(null);
    }
    return () => {
      cancelled = true;
    };
  }, [intent, payments]);

  // While an intent is pending, poll for webhook confirmation.
  useEffect(() => {
    if (!intent || intent.status !== 'pending') return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.get<{ intent: PaymentIntent; order: Order }>(`/api/payments/intents/${intent.id}`);
        if (r.intent.status === 'confirmed') {
          setIntent(null);
          if (r.order.status === 'paid') onPaid(r.order);
          else {
            onUpdated(r.order);
          }
        } else if (r.intent.status !== 'pending') {
          setIntent(r.intent); // expired/cancelled — show it
        }
      } catch {
        /* transient; keep polling */
      }
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.id, intent?.status]);

  // Switching channels abandons any pending request.
  useEffect(() => {
    setIntent((cur) => {
      if (cur && cur.status === 'pending' && cur.channel_key !== channelKey) {
        api.post(`/api/payments/intents/${cur.id}/cancel`).catch(() => {});
        return null;
      }
      return cur;
    });
  }, [channelKey]);

  const requestPayment = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ intent: PaymentIntent }>('/api/payments/intents', {
        order_id: order.id,
        channel_key: channel?.key,
      });
      setIntent(r.intent);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start payment');
    } finally {
      setBusy(false);
    }
  };

  const cancelIntent = async () => {
    if (!intent) return;
    try {
      await api.post(`/api/payments/intents/${intent.id}/cancel`);
    } catch {
      /* already terminal */
    }
    setIntent(null);
  };

  const simulate = async () => {
    if (!intent) return;
    setError('');
    try {
      const r = await api.post<{ outcome: string; intent: PaymentIntent; order: Order }>(
        `/api/payments/intents/${intent.id}/simulate`,
      );
      if (r.intent.status === 'confirmed') {
        setIntent(null);
        if (r.order.status === 'paid') onPaid(r.order);
        else onUpdated(r.order);
      } else {
        setError(`Simulation outcome: ${r.outcome}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (kind === 'ewallet' && payments?.ewalletQrPayload) {
      QRCode.toDataURL(payments.ewalletQrPayload, { width: 200, margin: 1 }).then((url) => {
        if (!cancelled) setWalletQr(url);
      });
    } else {
      setWalletQr(null);
    }
    return () => {
      cancelled = true;
    };
  }, [kind, payments]);

  const parseCents = (s: string): number => Math.round(parseFloat(s || '0') * 100);

  const pay = async (amountCents: number, tenderedCents?: number) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ change_cents: number; paid: boolean; order: Order }>(
        `/api/orders/${order.id}/payments`,
        {
          method: kind,
          channel_key: channel?.key,
          amount_cents: amountCents,
          tendered_cents: tenderedCents,
          reference: reference.trim() || undefined,
        },
      );
      setLastChange(kind === 'cash' ? r.change_cents : null);
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
    const step = kind === 'cash' && tax ? tax.cashRoundingCents : 0;
    const rounded = step > 1 ? Math.round(balance / step) * step : balance;
    pay(rounded, kind === 'cash' ? rounded : undefined);
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
    pay(amount, kind === 'cash' ? amount : undefined);
  };

  const roundingNote =
    kind === 'cash' && tax && tax.cashRoundingCents > 1
      ? `Cash totals round to the nearest ${tax.cashRoundingCents} sen.`
      : null;

  const byKind = (k: string) => channels.filter((c) => c.kind === k);

  const settlePlatform = async () => {
    if (busy || !platformCfg) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ paid: boolean; order: Order }>(`/api/orders/${order.id}/payments`, {
        method: 'other',
        channel: platformCfg.label,
        amount_cents: balance,
        reference: order.platform_ref || undefined,
      });
      if (r.paid) onPaid(r.order);
      else onUpdated(r.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // Platform delivery orders: the platform already collected from the customer.
  if (platformCfg) {
    return (
      <Modal title={`Payment — #${order.order_no}`} onClose={onClose}>
        <p className="muted small">
          {platformCfg.label} order{order.platform_ref ? ` #${order.platform_ref}` : ''} — the
          platform collects payment from the customer and pays out net of its ~
          {platformCfg.commissionPct}% commission. Settle the order here at menu value so the
          kitchen, stock and reports reconcile.
        </p>
        <button className="primary" style={{ width: '100%' }} onClick={settlePlatform} disabled={busy}>
          Settle · Paid via {platformCfg.label} · {money(balance)}
        </button>
        {error && <div className="error-text mt">{error}</div>}
      </Modal>
    );
  }

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
        {[...byKind('cash'), ...byKind('card')].map((c) => (
          <button key={c.key} className={channelKey === c.key ? 'primary' : ''} onClick={() => setChannelKey(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      {byKind('ewallet').length > 0 && (
        <div className="row wrap mb">
          {byKind('ewallet').map((c) => (
            <button key={c.key} className={channelKey === c.key ? 'primary' : ''} onClick={() => setChannelKey(c.key)}>
              {c.label}
            </button>
          ))}
          {byKind('other').map((c) => (
            <button key={c.key} className={channelKey === c.key ? 'primary' : ''} onClick={() => setChannelKey(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {kind === 'cash' ? (
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
              <button key={n} onClick={() => pay(n, n)} disabled={busy}>
                {money(n)}
              </button>
            ))}
          </div>
          {roundingNote && <div className="muted small mb">{roundingNote}</div>}
        </>
      ) : gatewayActive && intent ? (
        <div className="mb" style={{ textAlign: 'center' }}>
          {intentQr && (
            <img src={intentQr} alt="Payment QR" style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
          )}
          {intent.status === 'pending' ? (
            <>
              <div style={{ fontWeight: 700, marginTop: '0.4rem' }}>
                Waiting for {intent.channel_label} payment of {money(intent.amount_cents)}…
              </div>
              <div className="muted small mb">
                Confirms automatically when the gateway notifies us.
              </div>
              <div className="row" style={{ justifyContent: 'center' }}>
                {gateway?.provider === 'mock' && (
                  <button onClick={simulate}>Simulate customer payment</button>
                )}
                <button className="danger" onClick={cancelIntent}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="error-text mt">Payment request {intent.status}.</div>
              <button className="mt" onClick={() => setIntent(null)}>Back</button>
            </>
          )}
        </div>
      ) : gatewayActive ? (
        <>
          <button className="primary mb" onClick={requestPayment} disabled={busy}>
            Request {channel?.label} payment · {money(balance)}
          </button>
          <div className="muted small mb">
            Shows the payment QR and auto-confirms via the gateway. Or record a sighted payment
            manually below.
          </div>
          <div className="mb">
            <label>Manual — reference (txn id on customer's screen)</label>
            <div className="row">
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="grow" />
              <button onClick={() => pay(balance)} disabled={busy}>Record manually</button>
            </div>
          </div>
        </>
      ) : (
        <>
          {walletQr && (
            <div className="mb" style={{ textAlign: 'center' }}>
              <img src={walletQr} alt="Payment QR" style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
              <div className="muted small">Customer scans to pay {money(balance)} via {channel?.label}</div>
            </div>
          )}
          <div className="mb">
            <label>Reference (approval code / txn id)</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <button className="primary mb" onClick={() => pay(balance)} disabled={busy}>
            Confirm {channel?.label} · {money(balance)}
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

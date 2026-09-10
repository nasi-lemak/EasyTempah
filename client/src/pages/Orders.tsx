import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { TextPromptDialog } from '../components/Dialogs';
import Modal from '../components/Modal';
import Receipt from '../components/Receipt';
import { hasRole, useMoney, useStore } from '../store';
import { formatDateTime } from '../time';
import type {
  BusinessSettings,
  Einvoice,
  EinvoiceIdType,
  Order,
  PaymentMethod,
  TaxSettings,
} from '../types';
import { useEvents } from '../useEvents';

export default function Orders() {
  const money = useMoney();
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const printers = useStore((s) => s.printers);
  const [status, setStatus] = useState<'all' | 'open' | 'paid' | 'void'>('all');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [receipt, setReceipt] = useState<{
    order: Order;
    business: BusinessSettings;
    tax: TaxSettings;
    einvoice?: import('../types').ReceiptEinvoice | null;
  } | null>(null);
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [einvOrder, setEinvOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const einvoiceCfg = useStore((s) => s.einvoice);
  const platformsCfg = useStore((s) => s.platforms);
  const platformLabel = (key: string) =>
    platformsCfg?.platforms.find((p) => p.key === key)?.label ?? key;

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    // A search spans all dates; the date filter applies only when not searching.
    if (q.trim()) params.set('q', q.trim());
    else if (date) params.set('date', date);
    api
      .get<{ orders: Order[] }>(`/api/orders?${params}`)
      .then((r) => setOrders(r.orders))
      .catch(() => {});
  }, [status, date, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce keystrokes
    return () => clearTimeout(t);
  }, [load, q]);
  useEvents(['orders'], load);

  const openReceipt = async (orderId: number) => {
    setError('');
    try {
      const r = await api.get<{
        order: Order;
        business: BusinessSettings;
        tax: TaxSettings;
        einvoice?: import('../types').ReceiptEinvoice | null;
      }>(`/api/orders/${orderId}/receipt`);
      setReceipt(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const [voidId, setVoidId] = useState<number | null>(null);

  const voidOrder = async (orderId: number, reason: string) => {
    setVoidId(null);
    setError('');
    try {
      await api.post(`/api/orders/${orderId}/void`, { reason });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to void');
    }
  };

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Orders</h1>
        <input
          placeholder="Search order / receipt / platform no."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 250 }}
        />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!q.trim()} />
        {(['all', 'open', 'paid', 'void'] as const).map((s) => (
          <button key={s} className={status === s ? 'primary' : ''} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {error && <div className="error-text mb">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>#</th><th>Opened</th><th>Type</th><th>Table</th><th>Status</th>
            <th className="num">Items</th><th className="num">Total</th><th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.order_no}</td>
              <td className="small muted">{formatDateTime(o.opened_at)}</td>
              <td>
                {o.platform ? (
                  <>
                    {platformLabel(o.platform)}
                    {o.platform_ref && <div className="small muted">#{o.platform_ref}</div>}
                  </>
                ) : (
                  o.type.replace('_', ' ')
                )}
              </td>
              <td>{o.table_name ?? '—'}</td>
              <td>
                <span className={`badge ${o.status}`}>{o.status}</span>
                {o.refunded_cents > 0 && (
                  <div className="small" style={{ color: 'var(--danger)' }}>refunded {money(o.refunded_cents)}</div>
                )}
                {o.void_reason ? <div className="small muted">{o.void_reason}</div> : null}
              </td>
              <td className="num">{o.item_count}</td>
              <td className="num">{money(o.total_cents)}</td>
              <td className="right">
                {o.status === 'open' && <button onClick={() => navigate(`/pos/${o.id}`)}>Open</button>}{' '}
                {o.status === 'paid' && <button onClick={() => openReceipt(o.id)}>Receipt</button>}{' '}
                {o.status === 'paid' && o.refunded_cents < o.paid_cents && (
                  <button className="danger" onClick={() => setRefundOrder(o)}>Refund</button>
                )}{' '}
                {o.status === 'paid' && einvoiceCfg?.enabled && !o.platform && (
                  <button onClick={() => setEinvOrder(o)}>e-Invoice</button>
                )}{' '}
                {o.status === 'open' && hasRole(user, 'manager') && (
                  <button className="danger" onClick={() => setVoidId(o.id)}>Void</button>
                )}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={8} className="muted">No orders for this filter.</td></tr>
          )}
        </tbody>
      </table>

      {voidId != null && (
        <TextPromptDialog
          title="Void order"
          label="Reason (goes to the audit log)"
          placeholder="Wrong table / customer left…"
          confirmLabel="Void order"
          danger
          onSubmit={(reason) => voidOrder(voidId, reason)}
          onClose={() => setVoidId(null)}
        />
      )}

      {receipt && (
        <Modal title={`Receipt #${receipt.order.order_no}`} onClose={() => setReceipt(null)}>
          <Receipt order={receipt.order} business={receipt.business} tax={receipt.tax} einvoice={receipt.einvoice} />
          <div className="row mt">
            {printers?.receipt.enabled && (
              <button className="primary grow"
                onClick={async () => {
                  setError('');
                  try {
                    await api.post(`/api/print/receipt/${receipt.order.id}`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Print failed');
                  }
                }}>
                Print (thermal)
              </button>
            )}
            <button className="grow" onClick={() => window.print()}>Print (browser)</button>
            <button className="grow" onClick={() => setReceipt(null)}>Close</button>
          </div>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {refundOrder && (
        <RefundDialog
          order={refundOrder}
          needsPin={!hasRole(user, 'manager')}
          onDone={() => {
            setRefundOrder(null);
            load();
          }}
          onClose={() => setRefundOrder(null)}
        />
      )}

      {einvOrder && <EinvoiceDialog order={einvOrder} onClose={() => setEinvOrder(null)} />}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  valid: 'paid',
  submitted: 'sent',
  pending: 'pending',
  invalid: 'void',
  error: 'void',
};

function EinvoiceDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const [existing, setExisting] = useState<Einvoice | null | undefined>(undefined);
  const [tin, setTin] = useState('');
  const [idType, setIdType] = useState<EinvoiceIdType>('NRIC');
  const [idValue, setIdValue] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ einvoice: Einvoice | null }>(`/api/einvoice/orders/${order.id}`)
      .then((r) => setExisting(r.einvoice))
      .catch(() => setExisting(null));
  }, [order.id]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ einvoice: Einvoice }>(`/api/einvoice/orders/${order.id}`, {
        buyer: { tin, idType, idValue, name, email: email || undefined },
      });
      setExisting(r.einvoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!existing) return;
    const r = await api.post<{ einvoice: Einvoice }>(`/api/einvoice/${existing.id}/refresh`);
    setExisting(r.einvoice);
  };

  if (existing === undefined) {
    return (
      <Modal title={`e-Invoice — #${order.order_no}`} onClose={onClose}>
        <div className="muted">Loading…</div>
      </Modal>
    );
  }

  if (existing && ['pending', 'submitted', 'valid'].includes(existing.status)) {
    const buyer = existing.buyer_json ? (JSON.parse(existing.buyer_json) as { name: string; tin: string }) : null;
    return (
      <Modal title={`e-Invoice — #${order.order_no}`} onClose={onClose}>
        <p>
          Status: <span className={`badge ${STATUS_BADGE[existing.status]}`}>{existing.status}</span>
        </p>
        {buyer && <p className="small">Buyer: {buyer.name} · TIN {buyer.tin}</p>}
        {existing.uuid && (
          <p className="small mono" style={{ wordBreak: 'break-all' }}>UUID: {existing.uuid}</p>
        )}
        {existing.portal_url && (
          <p className="small">
            <a href={existing.portal_url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>
              View on MyInvois portal ↗
            </a>
          </p>
        )}
        {existing.error && <div className="error-text">{existing.error}</div>}
        <div className="row mt">
          {existing.status === 'submitted' && <button onClick={refresh}>Check status</button>}
          <button className="grow" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Issue e-Invoice — #${order.order_no}`} onClose={onClose}>
      {existing && <div className="error-text mb">Previous attempt failed: {existing.error}</div>}
      <p className="muted small">
        Capture the buyer's details as shown on their MyTax profile. The e-invoice is submitted to
        LHDN MyInvois for validation.
      </p>
      <label>Buyer TIN</label>
      <input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="e.g. IG1234567890" style={{ width: '100%' }} className="mb" />
      <div className="row mb">
        <div>
          <label>ID type</label>
          <select value={idType} onChange={(e) => setIdType(e.target.value as EinvoiceIdType)}>
            <option value="NRIC">NRIC</option>
            <option value="BRN">BRN (business)</option>
            <option value="PASSPORT">Passport</option>
            <option value="ARMY">Army</option>
          </select>
        </div>
        <div className="grow">
          <label>ID number</label>
          <input value={idValue} onChange={(e) => setIdValue(e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <label>Buyer name / company</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} className="mb" />
      <label>Email (optional)</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} className="mb" />
      <button className="primary" onClick={submit} disabled={busy}>
        {busy ? 'Submitting to LHDN…' : 'Submit e-Invoice'}
      </button>
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

function RefundDialog({
  order,
  needsPin,
  onDone,
  onClose,
}: {
  order: Order;
  needsPin: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const refundable = order.paid_cents - order.refunded_cents;
  const [amountStr, setAmountStr] = useState((refundable / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/orders/${order.id}/refunds`, {
        method,
        amount_cents: Math.round(parseFloat(amountStr || '0') * 100),
        reason,
        ...(needsPin ? { manager_pin: pin } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Refund — #${order.order_no}`} onClose={onClose}>
      <p className="muted small">
        Paid {money(order.paid_cents)}
        {order.refunded_cents > 0 && <> · already refunded {money(order.refunded_cents)}</>} ·
        refundable <strong>{money(refundable)}</strong>
      </p>
      <label>Amount (RM)</label>
      <input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} style={{ width: '100%' }} className="mb" />
      <label>Refund via</label>
      <div className="row wrap mb">
        {(['cash', 'card', 'ewallet', 'other'] as PaymentMethod[]).map((m) => (
          <button key={m} className={method === m ? 'primary' : ''} onClick={() => setMethod(m)}>
            {m === 'ewallet' ? 'E-Wallet' : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <label>Reason</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong order served" style={{ width: '100%' }} className="mb" />
      {needsPin && (
        <>
          <label>Manager PIN (approval)</label>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{ width: '100%' }}
            className="mb"
          />
        </>
      )}
      <button className="danger" onClick={submit} disabled={busy}>
        Refund {money(Math.round(parseFloat(amountStr || '0') * 100))}
      </button>
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

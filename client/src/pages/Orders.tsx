import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import Receipt from '../components/Receipt';
import { hasRole, useMoney, useStore } from '../store';
import { formatDateTime } from '../time';
import type { BusinessSettings, Order, TaxSettings } from '../types';
import { useEvents } from '../useEvents';

export default function Orders() {
  const money = useMoney();
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const [status, setStatus] = useState<'all' | 'open' | 'paid' | 'void'>('all');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState<Order[]>([]);
  const [receipt, setReceipt] = useState<{ order: Order; business: BusinessSettings; tax: TaxSettings } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (date) params.set('date', date);
    api
      .get<{ orders: Order[] }>(`/api/orders?${params}`)
      .then((r) => setOrders(r.orders))
      .catch(() => {});
  }, [status, date]);
  useEffect(load, [load]);
  useEvents(['orders'], load);

  const openReceipt = async (orderId: number) => {
    setError('');
    try {
      const r = await api.get<{ order: Order; business: BusinessSettings; tax: TaxSettings }>(
        `/api/orders/${orderId}/receipt`,
      );
      setReceipt(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const voidOrder = async (orderId: number) => {
    const reason = window.prompt('Void reason?');
    if (!reason) return;
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
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
              <td>{o.type.replace('_', ' ')}</td>
              <td>{o.table_name ?? '—'}</td>
              <td><span className={`badge ${o.status}`}>{o.status}</span>{o.void_reason ? <div className="small muted">{o.void_reason}</div> : null}</td>
              <td className="num">{o.item_count}</td>
              <td className="num">{money(o.total_cents)}</td>
              <td className="right">
                {o.status === 'open' && <button onClick={() => navigate(`/pos/${o.id}`)}>Open</button>}{' '}
                {o.status === 'paid' && <button onClick={() => openReceipt(o.id)}>Receipt</button>}{' '}
                {o.status === 'open' && hasRole(user, 'manager') && (
                  <button className="danger" onClick={() => voidOrder(o.id)}>Void</button>
                )}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={8} className="muted">No orders for this filter.</td></tr>
          )}
        </tbody>
      </table>

      {receipt && (
        <Modal title={`Receipt #${receipt.order.order_no}`} onClose={() => setReceipt(null)}>
          <Receipt order={receipt.order} business={receipt.business} tax={receipt.tax} />
          <div className="row mt">
            <button className="primary grow" onClick={() => window.print()}>Print</button>
            <button className="grow" onClick={() => setReceipt(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

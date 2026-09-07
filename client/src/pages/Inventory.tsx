import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import { useEvents } from '../useEvents';

interface InvItem {
  id: number;
  name: string;
  category: string;
  track_stock: number;
  stock_qty: number;
  low_stock_threshold: number;
  active: number;
}

interface Movement {
  id: number;
  delta: number;
  reason: string;
  ref: string | null;
  user_name: string | null;
  created_at: string;
}

export default function Inventory() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [adjustItem, setAdjustItem] = useState<InvItem | null>(null);
  const [historyItem, setHistoryItem] = useState<InvItem | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [deltaStr, setDeltaStr] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ items: InvItem[] }>('/api/inventory').then((r) => setItems(r.items)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['inventory'], load);

  const doAdjust = async () => {
    setError('');
    try {
      await api.post('/api/inventory/adjust', {
        item_id: adjustItem!.id,
        delta: parseInt(deltaStr, 10),
        reason,
      });
      setAdjustItem(null);
      setDeltaStr('');
      setReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const openHistory = async (item: InvItem) => {
    setHistoryItem(item);
    const r = await api.get<{ movements: Movement[] }>(`/api/inventory/movements/${item.id}`);
    setMovements(r.movements);
  };

  const tracked = items.filter((i) => i.track_stock);
  const untracked = items.filter((i) => !i.track_stock);

  return (
    <div>
      <h1>Inventory</h1>
      <p className="muted small">
        Tracked items are deducted when an order is sent to the kitchen, and restocked on voids and
        cancellations. Use “Adjust” to receive stock or write off waste — adjusting an untracked item
        turns tracking on.
      </p>

      <table className="data">
        <thead>
          <tr><th>Item</th><th>Category</th><th className="num">In stock</th><th className="num">Low at</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {tracked.map((i) => (
            <tr key={i.id}>
              <td>{i.name}</td>
              <td>{i.category}</td>
              <td className="num" style={{ fontWeight: 700 }}>{i.stock_qty}</td>
              <td className="num muted">{i.low_stock_threshold}</td>
              <td>
                {i.stock_qty <= 0 ? (
                  <span className="badge void">out</span>
                ) : i.stock_qty <= i.low_stock_threshold ? (
                  <span className="badge preparing">low</span>
                ) : (
                  <span className="badge paid">ok</span>
                )}
              </td>
              <td className="right">
                <button onClick={() => setAdjustItem(i)}>Adjust</button>{' '}
                <button className="ghost" onClick={() => openHistory(i)}>History</button>
              </td>
            </tr>
          ))}
          {tracked.length === 0 && <tr><td colSpan={6} className="muted">No tracked items yet.</td></tr>}
        </tbody>
      </table>

      <h2 className="mt">Untracked items</h2>
      <div className="row wrap">
        {untracked.map((i) => (
          <button key={i.id} onClick={() => setAdjustItem(i)} className="ghost">
            {i.name}
          </button>
        ))}
      </div>

      {adjustItem && (
        <Modal title={`Adjust — ${adjustItem.name}`} onClose={() => setAdjustItem(null)}>
          <p className="muted small">Current stock: {adjustItem.track_stock ? adjustItem.stock_qty : 'untracked'}</p>
          <label>Change (+ receive, − write off)</label>
          <input inputMode="numeric" value={deltaStr} onChange={(e) => setDeltaStr(e.target.value)} placeholder="e.g. 24 or -3" style={{ width: '100%' }} className="mb" />
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. delivery received / spoilage" style={{ width: '100%' }} />
          <button className="primary mt" onClick={doAdjust}>Apply</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {historyItem && (
        <Modal title={`Stock history — ${historyItem.name}`} onClose={() => setHistoryItem(null)} wide>
          <table className="data">
            <thead><tr><th>When</th><th className="num">Δ</th><th>Reason</th><th>Ref</th><th>By</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="small muted">{m.created_at}</td>
                  <td className="num" style={{ color: m.delta > 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {m.delta > 0 ? '+' : ''}{m.delta}
                  </td>
                  <td>{m.reason}</td>
                  <td className="muted small">{m.ref}</td>
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

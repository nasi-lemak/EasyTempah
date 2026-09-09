import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import type { Ingredient } from '../types';
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
  const [tab, setTab] = useState<'items' | 'ingredients'>('items');
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

  if (tab === 'ingredients') {
    return (
      <div>
        <div className="row mb">
          <h1 className="grow">Inventory</h1>
          <button onClick={() => setTab('items')}>Items</button>
          <button className="primary" onClick={() => setTab('ingredients')}>Ingredients</button>
        </div>
        <IngredientsView />
      </div>
    );
  }

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Inventory</h1>
        <button className="primary" onClick={() => setTab('items')}>Items</button>
        <button onClick={() => setTab('ingredients')}>Ingredients</button>
      </div>
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

function IngredientsView() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [form, setForm] = useState({ name: '', unit: 'g', stock: '', cost: '', low: '' });
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [history, setHistory] = useState<{ ing: Ingredient; movements: Movement[] } | null>(null);
  const [deltaStr, setDeltaStr] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ ingredients: Ingredient[] }>('/api/inventory/ingredients')
      .then((r) => setIngredients(r.ingredients))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);
  useEvents(['inventory'], load);

  const add = async () => {
    setError('');
    try {
      await api.post('/api/inventory/ingredients', {
        name: form.name,
        unit: form.unit,
        stock_qty: Number(form.stock) || 0,
        cost_per_unit_cents: Math.round((Number(form.cost) || 0) * 100),
        low_stock_threshold: Number(form.low) || 0,
      });
      setForm({ name: '', unit: 'g', stock: '', cost: '', low: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const adjust = async () => {
    setError('');
    try {
      await api.post('/api/inventory/ingredients/adjust', {
        ingredient_id: adjusting!.id,
        delta: Number(deltaStr),
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

  const openHistory = async (ing: Ingredient) => {
    const r = await api.get<{ movements: Movement[] }>(`/api/inventory/ingredients/${ing.id}/movements`);
    setHistory({ ing, movements: r.movements });
  };

  return (
    <div>
      <p className="muted small">
        Ingredients are consumed automatically by item and add-on recipes when lines fire, and
        returned on cancellations and voids. Stock may go negative — that flags a counting gap
        rather than blocking the kitchen. Recipes are edited in Menu → item / modifier.
      </p>
      <div className="row wrap mb">
        <input placeholder="New ingredient" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="unit (g/ml/pcs)" style={{ width: 100 }} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <input placeholder="stock" style={{ width: 90 }} inputMode="decimal" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
        <input placeholder="RM/unit" style={{ width: 90 }} inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <input placeholder="low at" style={{ width: 90 }} inputMode="decimal" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} />
        <button className="primary" onClick={add}>Add</button>
      </div>
      {error && <div className="error-text mb">{error}</div>}
      <table className="data">
        <thead>
          <tr><th>Ingredient</th><th className="num">In stock</th><th>Unit</th><th className="num">Cost/unit</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {ingredients.map((ing) => (
            <tr key={ing.id}>
              <td>{ing.name}</td>
              <td className="num" style={{ fontWeight: 700, color: ing.stock_qty < 0 ? 'var(--danger)' : undefined }}>
                {ing.stock_qty % 1 === 0 ? ing.stock_qty : ing.stock_qty.toFixed(1)}
              </td>
              <td className="muted">{ing.unit}</td>
              <td className="num muted">RM {(ing.cost_per_unit_cents / 100).toFixed(2)}</td>
              <td>
                {ing.stock_qty < 0 ? (
                  <span className="badge void">negative</span>
                ) : ing.stock_qty <= ing.low_stock_threshold ? (
                  <span className="badge preparing">low</span>
                ) : (
                  <span className="badge paid">ok</span>
                )}
              </td>
              <td className="right">
                <button onClick={() => setAdjusting(ing)}>Adjust</button>{' '}
                <button className="ghost" onClick={() => openHistory(ing)}>History</button>
              </td>
            </tr>
          ))}
          {ingredients.length === 0 && <tr><td colSpan={6} className="muted">No ingredients yet.</td></tr>}
        </tbody>
      </table>

      {adjusting && (
        <Modal title={`Adjust — ${adjusting.name}`} onClose={() => setAdjusting(null)}>
          <p className="muted small">Current: {adjusting.stock_qty} {adjusting.unit}</p>
          <label>Change (+ receive, − write off), in {adjusting.unit}</label>
          <input inputMode="decimal" value={deltaStr} onChange={(e) => setDeltaStr(e.target.value)} style={{ width: '100%' }} className="mb" />
          <label>Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. delivery / stocktake / spoilage" style={{ width: '100%' }} />
          <button className="primary mt" onClick={adjust}>Apply</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {history && (
        <Modal title={`History — ${history.ing.name}`} onClose={() => setHistory(null)} wide>
          <table className="data">
            <thead><tr><th>When</th><th className="num">Δ ({history.ing.unit})</th><th>Reason</th><th>Ref</th><th>By</th></tr></thead>
            <tbody>
              {history.movements.map((m) => (
                <tr key={m.id}>
                  <td className="small muted">{m.created_at}</td>
                  <td className="num" style={{ color: m.delta > 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {m.delta > 0 ? '+' : ''}{m.delta % 1 === 0 ? m.delta : m.delta.toFixed(1)}
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

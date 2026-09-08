import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import ModifierDialog, { type ModifierChoice } from '../components/ModifierDialog';
import PayDialog from '../components/PayDialog';
import Receipt from '../components/Receipt';
import { hasRole, useMoney, useStore } from '../store';
import type { Item, MenuData, ModifierSnapshot, Order } from '../types';
import { useEvents } from '../useEvents';

export default function Pos() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const money = useMoney();
  const user = useStore((s) => s.user);
  const business = useStore((s) => s.business);
  const tax = useStore((s) => s.tax);

  const [menu, setMenu] = useState<MenuData | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [modItem, setModItem] = useState<Item | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');

  const loadMenu = useCallback(() => {
    api.get<MenuData>('/api/menu').then(setMenu).catch(() => {});
  }, []);

  const loadOrder = useCallback(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    api
      .get<{ order: Order }>(`/api/orders/${orderId}`)
      .then((r) => setOrder(r.order))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load order'));
  }, [orderId]);

  useEffect(loadMenu, [loadMenu]);
  useEffect(loadOrder, [loadOrder]);
  useEvents(['menu'], loadMenu);
  useEvents(['orders'], loadOrder);

  const categories = menu?.categories ?? [];
  const catId = activeCat ?? categories[0]?.id ?? null;
  const items = useMemo(
    () => (menu?.items ?? []).filter((i) => i.category_id === catId),
    [menu, catId],
  );

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const startOrder = (type: 'takeaway' | 'delivery') =>
    run(async () => {
      const r = await api.post<{ order: Order }>('/api/orders', { type });
      navigate(`/pos/${r.order.id}`);
    });

  const itemHasModifiers = (item: Item) =>
    (menu?.links ?? []).some((l) => l.item_id === item.id);

  const addLine = (choice: ModifierChoice) =>
    run(async () => {
      if (!order) return;
      const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/items`, {
        lines: [
          {
            item_id: choice.item.id,
            qty: choice.qty,
            modifier_ids: choice.modifier_ids,
            notes: choice.notes || undefined,
          },
        ],
      });
      setOrder(r.order);
      setModItem(null);
    });

  const tapItem = (item: Item) => {
    if (!order) return;
    if (item.track_stock && item.stock_qty <= 0) return;
    if (itemHasModifiers(item)) {
      setModItem(item);
    } else {
      addLine({ item, qty: 1, modifier_ids: [], notes: '' });
    }
  };

  const changeQty = (lineId: number, qty: number) =>
    run(async () => {
      if (!order) return;
      const r = await api.patch<{ order: Order }>(`/api/orders/${order.id}/items/${lineId}`, { qty });
      setOrder(r.order);
    });

  const cancelLine = (lineId: number) =>
    run(async () => {
      if (!order) return;
      const r = await api.patch<{ order: Order }>(`/api/orders/${order.id}/items/${lineId}`, {
        cancel: true,
      });
      setOrder(r.order);
    });

  const sendToKitchen = () =>
    run(async () => {
      if (!order) return;
      const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/send`);
      setOrder(r.order);
    });

  const voidOrder = () => {
    const reason = window.prompt('Void reason?');
    if (!reason) return;
    run(async () => {
      if (!order) return;
      await api.post(`/api/orders/${order.id}/void`, { reason });
      navigate(order.type === 'dine_in' ? '/tables' : '/pos');
    });
  };

  const onPaid = (paidOrder: Order) => {
    setShowPay(false);
    setReceiptOrder(paidOrder);
  };

  const closeReceipt = () => {
    const wasDineIn = order?.type === 'dine_in';
    setReceiptOrder(null);
    navigate(wasDineIn ? '/tables' : '/pos');
  };

  // ---------- No active order: start screen ----------
  if (!orderId) {
    return (
      <div>
        <h1>New Order</h1>
        <div className="row wrap mt">
          <button className="primary" style={{ minHeight: 90, minWidth: 180, fontSize: '1.1rem' }}
            onClick={() => navigate('/tables')}>
            Dine-in<br /><span className="small">choose a table</span>
          </button>
          <button style={{ minHeight: 90, minWidth: 180, fontSize: '1.1rem' }} onClick={() => startOrder('takeaway')}>
            Takeaway
          </button>
          <button style={{ minHeight: 90, minWidth: 180, fontSize: '1.1rem' }} onClick={() => startOrder('delivery')}>
            Delivery
          </button>
        </div>
        {error && <div className="error-text mt">{error}</div>}
        <RecentOpenOrders />
      </div>
    );
  }

  if (!order || !menu) return <div className="muted">Loading…</div>;

  const activeLines = order.items.filter((l) => l.status !== 'cancelled');
  const pendingCount = order.items.filter((l) => l.status === 'pending').length;
  const isOpen = order.status === 'open';

  return (
    <div className="pos-layout">
      <div className="pos-menu">
        <div className="cat-tabs">
          {categories.map((c) => (
            <button key={c.id} className={c.id === catId ? 'active' : ''} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="item-grid">
          {items.map((item) => {
            const oos = item.track_stock === 1 && item.stock_qty <= 0;
            return (
              <button key={item.id} className="item-card" onClick={() => tapItem(item)} disabled={!isOpen || oos}>
                <span className="name">{item.name}</span>
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="price">{money(item.price_cents)}</span>
                  {oos ? (
                    <span className="oos">SOLD OUT</span>
                  ) : item.track_stock === 1 && item.stock_qty <= item.low_stock_threshold ? (
                    <span className="small" style={{ color: 'var(--warn)' }}>{item.stock_qty} left</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pos-cart">
        <div className="cart-panel">
          <div className="cart-head">
            <div className="row">
              <strong className="grow">
                #{order.order_no}
                {order.table_name ? ` · Table ${order.table_name}` : ` · ${order.type.replace('_', ' ')}`}
              </strong>
              <span className={`badge ${order.status}`}>{order.status}</span>
            </div>
            <div className="muted small">
              {order.covers} pax · opened by {order.opened_by_name}
            </div>
          </div>

          <div className="cart-lines">
            {activeLines.length === 0 && <div className="muted" style={{ padding: '1rem' }}>Tap items to add them.</div>}
            {activeLines.map((line) => {
              const mods = JSON.parse(line.modifiers_json) as ModifierSnapshot[];
              const editable = isOpen && line.status === 'pending';
              return (
                <div key={line.id} className="cart-line">
                  <div className="row">
                    <span className="grow">
                      <strong>{line.qty}×</strong> {line.source === 'guest' && <span title="Ordered by guest via QR">📱</span>} {line.name}{' '}
                      {line.status !== 'pending' && <span className={`badge ${line.status}`}>{line.status}</span>}
                    </span>
                    <span className="mono">{money(line.line_total_cents)}</span>
                  </div>
                  {mods.length > 0 && (
                    <div className="mods">{mods.map((m) => m.name).join(', ')}</div>
                  )}
                  {line.notes && <div className="note">» {line.notes}</div>}
                  {isOpen && (
                    <div className="row mt" style={{ marginTop: '0.35rem' }}>
                      {editable && (
                        <>
                          <button className="qty-btn" onClick={() => line.qty > 1 ? changeQty(line.id, line.qty - 1) : cancelLine(line.id)}>−</button>
                          <button className="qty-btn" onClick={() => changeQty(line.id, line.qty + 1)}>+</button>
                        </>
                      )}
                      <div className="grow" />
                      <button className="ghost small" style={{ color: 'var(--danger)' }} onClick={() => cancelLine(line.id)}>
                        remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cart-totals">
            <div className="line"><span>Subtotal</span><span className="mono">{money(order.subtotal_cents)}</span></div>
            {order.discount_cents > 0 && (
              <div className="line"><span>Discount</span><span className="mono">-{money(order.discount_cents)}</span></div>
            )}
            {order.service_cents > 0 && (
              <div className="line"><span>{tax?.serviceLabel ?? 'Service'}</span><span className="mono">{money(order.service_cents)}</span></div>
            )}
            {order.tax_cents > 0 && (
              <div className="line"><span>{tax?.taxLabel ?? 'Tax'}</span><span className="mono">{money(order.tax_cents)}</span></div>
            )}
            {order.rounding_cents !== 0 && (
              <div className="line"><span>Rounding</span><span className="mono">{money(order.rounding_cents)}</span></div>
            )}
            {order.paid_cents > 0 && (
              <div className="line"><span>Paid</span><span className="mono">-{money(order.paid_cents)}</span></div>
            )}
            <div className="line grand">
              <span>{order.paid_cents > 0 ? 'Balance' : 'Total'}</span>
              <span className="mono">{money(order.total_cents - order.paid_cents)}</span>
            </div>
          </div>

          {isOpen && (
            <div className="cart-actions">
              <button onClick={() => setShowDiscount(true)}>Discount</button>
              <button onClick={sendToKitchen} disabled={pendingCount === 0}>
                Send{pendingCount > 0 ? ` (${pendingCount})` : ''}
              </button>
              <button
                className="primary full"
                onClick={() => setShowPay(true)}
                disabled={activeLines.length === 0 || pendingCount > 0}
                title={pendingCount > 0 ? 'Send pending items to the kitchen first' : ''}
              >
                Pay · {money(order.total_cents - order.paid_cents)}
              </button>
              {hasRole(user, 'manager') && (
                <button className="danger full" onClick={voidOrder}>Void order</button>
              )}
            </div>
          )}
          {error && <div className="error-text" style={{ padding: '0 1rem 0.8rem' }}>{error}</div>}
        </div>
      </div>

      {modItem && (
        <ModifierDialog item={modItem} menu={menu} onConfirm={addLine} onClose={() => setModItem(null)} />
      )}
      {showPay && (
        <PayDialog order={order} onUpdated={setOrder} onPaid={onPaid} onClose={() => setShowPay(false)} />
      )}
      {showDiscount && (
        <DiscountDialog
          order={order}
          onDone={(o) => {
            setOrder(o);
            setShowDiscount(false);
          }}
          onClose={() => setShowDiscount(false)}
        />
      )}
      {receiptOrder && business && tax && (
        <Modal title="Payment complete" onClose={closeReceipt}>
          <Receipt order={receiptOrder} business={business} tax={tax} />
          <div className="row mt">
            <button className="primary grow" onClick={() => window.print()}>Print receipt</button>
            <button className="grow" onClick={closeReceipt}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DiscountDialog({
  order,
  onDone,
  onClose,
}: {
  order: Order;
  onDone: (o: Order) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<'percent' | 'fixed' | 'none'>(order.discount_type ?? 'none');
  const [value, setValue] = useState(
    order.discount_type === 'fixed' ? (order.discount_value / 100).toFixed(2) : String(order.discount_value || ''),
  );
  const [error, setError] = useState('');

  const apply = async () => {
    setError('');
    try {
      const discount =
        type === 'none'
          ? { type: null, value: 0 }
          : {
              type,
              value: type === 'fixed' ? Math.round(parseFloat(value || '0') * 100) : Math.round(parseFloat(value || '0')),
            };
      const r = await api.patch<{ order: Order }>(`/api/orders/${order.id}`, { discount });
      onDone(r.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <Modal title="Discount" onClose={onClose}>
      <div className="row wrap mb">
        <button className={type === 'none' ? 'primary' : ''} onClick={() => setType('none')}>None</button>
        <button className={type === 'percent' ? 'primary' : ''} onClick={() => setType('percent')}>Percent %</button>
        <button className={type === 'fixed' ? 'primary' : ''} onClick={() => setType('fixed')}>Fixed (RM)</button>
      </div>
      {type !== 'none' && (
        <div className="mb">
          <label>{type === 'percent' ? 'Percent (0–100)' : 'Amount (RM)'}</label>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
          <div className="muted small mt">Discounts above 20% (or any fixed amount) need manager rights.</div>
        </div>
      )}
      <button className="primary" onClick={apply}>Apply</button>
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

function RecentOpenOrders() {
  const money = useMoney();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);

  const load = useCallback(() => {
    api
      .get<{ orders: Order[] }>('/api/orders?status=open&limit=20')
      .then((r) => setOrders(r.orders))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['orders'], load);

  if (orders.length === 0) return null;
  return (
    <div className="mt">
      <h2>Open orders</h2>
      <table className="data">
        <thead>
          <tr><th>#</th><th>Type</th><th>Table</th><th className="num">Items</th><th className="num">Total</th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => navigate(`/pos/${o.id}`)}>
              <td>{o.order_no}</td>
              <td>{o.type.replace('_', ' ')}</td>
              <td>{o.table_name ?? '—'}</td>
              <td className="num">{o.item_count ?? ''}</td>
              <td className="num">{money(o.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

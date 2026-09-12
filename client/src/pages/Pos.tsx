import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import ComboDialog, { type ComboChoice } from '../components/ComboDialog';
import { ConfirmDialog, TextPromptDialog } from '../components/Dialogs';
import Modal from '../components/Modal';
import ModifierDialog, { type ModifierChoice } from '../components/ModifierDialog';
import PayDialog from '../components/PayDialog';
import Receipt from '../components/Receipt';
import { itemImageUrl } from '../images';
import { hasRole, useMoney, useStore } from '../store';
import type { Item, MenuData, ModifierSnapshot, Order } from '../types';
import { useEvents } from '../useEvents';

function usePlatformLabel(): (key: string) => string {
  const platforms = useStore((s) => s.platforms);
  return (key) => platforms?.platforms.find((p) => p.key === key)?.label ?? key;
}

export default function Pos() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const money = useMoney();
  const user = useStore((s) => s.user);
  const business = useStore((s) => s.business);
  const tax = useStore((s) => s.tax);
  const printers = useStore((s) => s.printers);
  const platformLabel = usePlatformLabel();

  const [menu, setMenu] = useState<MenuData | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [modItem, setModItem] = useState<Item | null>(null);
  const [comboItem, setComboItem] = useState<Item | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showOpenItem, setShowOpenItem] = useState(false);
  const [itemQuery, setItemQuery] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [showPager, setShowPager] = useState(false);
  const [priceLine, setPriceLine] = useState<{ id: number; name: string; cents: number } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<{ id: number; name: string } | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [showDelivery, setShowDelivery] = useState(false);
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
  // Searching looks across the whole menu, not just the active category.
  const items = useMemo(() => {
    const all = menu?.items ?? [];
    const q = itemQuery.trim().toLowerCase();
    if (q) return all.filter((i) => i.name.toLowerCase().includes(q));
    return all.filter((i) => i.category_id === catId);
  }, [menu, catId, itemQuery]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const startOrder = (type: 'takeaway' | 'delivery', platform?: string, platformRef?: string) =>
    run(async () => {
      const r = await api.post<{ order: Order }>('/api/orders', {
        type,
        platform: platform || undefined,
        platform_ref: platformRef || undefined,
      });
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

  const addComboLine = (choice: ComboChoice) =>
    run(async () => {
      if (!order) return;
      const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/items`, {
        lines: [
          {
            item_id: choice.item.id,
            qty: choice.qty,
            combo_choices: choice.combo_choices,
            notes: choice.notes || undefined,
          },
        ],
      });
      setOrder(r.order);
      setComboItem(null);
    });

  const tapItem = (item: Item) => {
    if (!order) return;
    if (item.track_stock && item.stock_qty <= 0) return;
    setItemQuery(''); // picked — return to the category view for the next item
    if (item.is_combo) {
      setComboItem(item);
    } else if (itemHasModifiers(item)) {
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

  const setPager = (value: string) => {
    setShowPager(false);
    run(async () => {
      if (!order) return;
      const trimmed = value.trim();
      const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/pager`, {
        pager_no: trimmed === '' ? null : parseInt(trimmed, 10),
      });
      setOrder(r.order);
    });
  };

  const voidOrder = (reason: string) => {
    setShowVoid(false);
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
          <button style={{ minHeight: 90, minWidth: 180, fontSize: '1.1rem' }} onClick={() => setShowDelivery(true)}>
            Delivery
          </button>
        </div>
        {error && <div className="error-text mt">{error}</div>}
        {showDelivery && (
          <DeliveryDialog
            onStart={(platform, ref) => {
              setShowDelivery(false);
              startOrder('delivery', platform, ref);
            }}
            onClose={() => setShowDelivery(false)}
          />
        )}
        <RecentOpenOrders />
      </div>
    );
  }

  if (!order || !menu) return <div className="muted">Loading…</div>;

  // Set-meal component rows are internal (KDS/stock); the cart shows the set line.
  const activeLines = order.items.filter((l) => l.status !== 'cancelled' && !l.parent_line_id);
  const pendingCount = order.items.filter((l) => l.status === 'pending' && !l.parent_line_id).length;
  const isOpen = order.status === 'open';

  return (
    <div className="pos-layout">
      <div className="pos-menu">
        <input
          className="pos-search"
          placeholder="🔍 Search menu…"
          value={itemQuery}
          onChange={(e) => setItemQuery(e.target.value)}
        />
        <div className="cat-tabs">
          {categories.map((c) => (
            <button key={c.id} className={c.id === catId ? 'active' : ''} onClick={() => setActiveCat(c.id)}>
              {c.name}
            </button>
          ))}
          <button title="Ring up something that isn't on the menu" disabled={!isOpen} onClick={() => setShowOpenItem(true)}>
            ✎ Open item
          </button>
        </div>
        <div className="item-grid">
          {items.map((item) => {
            const oos = item.track_stock === 1 && item.stock_qty <= 0;
            return (
              <button key={item.id} className="item-card" onClick={() => tapItem(item)} disabled={!isOpen || oos}>
                {itemImageUrl(item.id, item.image_v) && (
                  <img className="thumb" src={itemImageUrl(item.id, item.image_v)!} alt="" loading="lazy" />
                )}
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
                {order.table_name
                  ? ` · Table ${order.table_name}`
                  : order.platform
                    ? ` · ${platformLabel(order.platform)}${order.platform_ref ? ` #${order.platform_ref}` : ''}`
                    : ` · ${order.type.replace('_', ' ')}`}
              </strong>
              {business?.usePagers && !order.platform && (
                <button
                  className="ghost small"
                  disabled={!isOpen}
                  title="Key the collection pager handed to this customer"
                  onClick={() => setShowPager(true)}
                >
                  📟 {order.pager_no ?? 'Pager'}
                </button>
              )}
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
                          {hasRole(user, 'manager') && (
                            <button
                              className="ghost small"
                              onClick={() => setPriceLine({ id: line.id, name: line.name, cents: line.unit_price_cents })}
                            >
                              price
                            </button>
                          )}
                        </>
                      )}
                      <div className="grow" />
                      <button
                        className="ghost small"
                        style={{ color: 'var(--danger)' }}
                        onClick={() =>
                          line.status === 'pending'
                            ? cancelLine(line.id) // not sent yet — nothing to undo in the kitchen
                            : setConfirmCancel({ id: line.id, name: line.name })
                        }
                      >
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
            {order.promo_cents > 0 && (
              <div className="line"><span>🏷 {order.promo_name ?? 'Promo'}</span><span className="mono">-{money(order.promo_cents)}</span></div>
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
                className="full"
                onClick={() => setShowSplit(true)}
                disabled={order.paid_cents > 0 || activeLines.reduce((s, l) => s + l.qty, 0) < 2}
                title={order.paid_cents > 0 ? 'Cannot split after partial payment' : ''}
              >
                Split bill
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
                <button className="danger full" onClick={() => setShowVoid(true)}>Void order</button>
              )}
            </div>
          )}
          {error && <div className="error-text" style={{ padding: '0 1rem 0.8rem' }}>{error}</div>}
        </div>
      </div>

      {modItem && (
        <ModifierDialog item={modItem} menu={menu} onConfirm={addLine} onClose={() => setModItem(null)} />
      )}
      {comboItem && (
        <ComboDialog item={comboItem} menu={menu} onConfirm={addComboLine} onClose={() => setComboItem(null)} />
      )}
      {showPay && (
        <PayDialog order={order} onUpdated={setOrder} onPaid={onPaid} onClose={() => setShowPay(false)} />
      )}
      {showSplit && (
        <SplitDialog
          order={order}
          onDone={(newId) => {
            setShowSplit(false);
            navigate(`/pos/${newId}`);
          }}
          onClose={() => setShowSplit(false)}
        />
      )}
      {showPager && (
        <TextPromptDialog
          title="Collection pager"
          label="Pager number handed to the customer (blank clears it)"
          initial={order.pager_no != null ? String(order.pager_no) : ''}
          inputMode="numeric"
          placeholder="e.g. 14"
          confirmLabel="Set pager"
          allowEmpty
          onSubmit={setPager}
          onClose={() => setShowPager(false)}
        />
      )}
      {showVoid && (
        <TextPromptDialog
          title="Void order"
          label="Reason (goes to the audit log)"
          placeholder="Wrong table / customer left…"
          confirmLabel="Void order"
          danger
          onSubmit={voidOrder}
          onClose={() => setShowVoid(false)}
        />
      )}
      {priceLine && (
        <TextPromptDialog
          title={`New price — ${priceLine.name}`}
          label="Unit price (RM)"
          initial={(priceLine.cents / 100).toFixed(2)}
          inputMode="decimal"
          confirmLabel="Set price"
          onSubmit={(v) => {
            const cents = Math.round(parseFloat(v) * 100);
            setPriceLine(null);
            if (!Number.isInteger(cents) || cents < 0) return;
            run(async () => {
              const r = await api.patch<{ order: Order }>(`/api/orders/${order.id}/items/${priceLine.id}`, {
                unit_price_cents: cents,
              });
              setOrder(r.order);
            });
          }}
          onClose={() => setPriceLine(null)}
        />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title="Remove sent item?"
          message={`"${confirmCancel.name}" is already in the kitchen. Removing it puts stock back and takes it off the ticket.`}
          confirmLabel="Remove item"
          danger
          onConfirm={() => {
            cancelLine(confirmCancel.id);
            setConfirmCancel(null);
          }}
          onClose={() => setConfirmCancel(null)}
        />
      )}
      {showOpenItem && (
        <OpenItemDialog
          onAdd={async (custom, qty) => {
            await run(async () => {
              const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/items`, {
                lines: [{ qty, custom }],
              });
              setOrder(r.order);
            });
            setShowOpenItem(false);
          }}
          onClose={() => setShowOpenItem(false)}
        />
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
            {printers?.receipt.enabled && (
              <button
                className="primary grow"
                onClick={() =>
                  run(() => api.post(`/api/print/receipt/${receiptOrder.id}?drawer=1`))
                }
              >
                Print (thermal)
              </button>
            )}
            <button className={printers?.receipt.enabled ? 'grow' : 'primary grow'} onClick={() => window.print()}>
              Print (browser)
            </button>
            <button className="grow" onClick={closeReceipt}>Done</button>
          </div>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

function SplitDialog({
  order,
  onDone,
  onClose,
}: {
  order: Order;
  onDone: (newOrderId: number) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const active = order.items.filter((l) => l.status !== 'cancelled' && !l.parent_line_id);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setPick = (lineId: number, qty: number, max: number) =>
    setPicks((p) => ({ ...p, [lineId]: Math.max(0, Math.min(max, qty)) }));

  const movedEstimate = active.reduce((sum, l) => {
    const qty = picks[l.id] ?? 0;
    return sum + Math.round((l.line_total_cents / l.qty) * qty);
  }, 0);
  const movedCount = Object.values(picks).reduce((s, q) => s + q, 0);
  const totalUnits = active.reduce((s, l) => s + l.qty, 0);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const lines = Object.entries(picks)
        .filter(([, qty]) => qty > 0)
        .map(([line_id, qty]) => ({ line_id: Number(line_id), qty }));
      const r = await api.post<{ order: Order }>(`/api/orders/${order.id}/split`, { lines });
      onDone(r.order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Split failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Split bill — #${order.order_no}`} onClose={onClose}>
      <p className="muted small">Pick the items (and quantities) moving to a new bill.</p>
      {active.map((l) => {
        const qty = picks[l.id] ?? 0;
        return (
          <div key={l.id} className="row" style={{ padding: '0.35rem 0' }}>
            <span className="grow">
              {l.name} <span className="muted small">×{l.qty}</span>
            </span>
            <button className="qty-btn" onClick={() => setPick(l.id, qty - 1, l.qty)}>−</button>
            <strong style={{ minWidth: '1.6rem', textAlign: 'center' }}>{qty}</strong>
            <button className="qty-btn" onClick={() => setPick(l.id, qty + 1, l.qty)}>+</button>
          </div>
        );
      })}
      <div className="row mt">
        <strong className="grow">Moving {movedCount} item{movedCount === 1 ? '' : 's'}</strong>
        <strong className="mono">≈ {money(movedEstimate)}</strong>
      </div>
      <p className="muted small">Taxes and charges recalculate on each bill after the split.</p>
      <button
        className="primary"
        style={{ width: '100%' }}
        onClick={submit}
        disabled={busy || movedCount === 0 || movedCount >= totalUnits}
      >
        {movedCount >= totalUnits ? 'Leave at least one item on this bill' : 'Split to new bill'}
      </button>
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

function DeliveryDialog({
  onStart,
  onClose,
}: {
  onStart: (platform: string | undefined, ref: string | undefined) => void;
  onClose: () => void;
}) {
  const platforms = useStore((s) => s.platforms);
  const enabled = (platforms?.platforms ?? []).filter((p) => p.enabled);
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const [ref, setRef] = useState('');

  return (
    <Modal title="Delivery order" onClose={onClose}>
      <label>Source</label>
      <div className="row wrap mb">
        <button className={platform === undefined ? 'primary' : ''} onClick={() => setPlatform(undefined)}>
          In-house delivery
        </button>
        {enabled.map((p) => (
          <button key={p.key} className={platform === p.key ? 'primary' : ''} onClick={() => setPlatform(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {platform && (
        <div className="mb">
          <label>Platform order no. (from the merchant tablet)</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. GF-1234" style={{ width: '100%' }} />
          <div className="muted small mt">
            The platform collects payment and issues the customer's e-invoice — this order is
            excluded from your consolidated e-invoice automatically.
          </div>
        </div>
      )}
      <button className="primary" onClick={() => onStart(platform, ref.trim() || undefined)}>
        Start order
      </button>
    </Modal>
  );
}

/** Ring up something off-menu: "special of the day, RM 8". Audited server-side. */
function OpenItemDialog({
  onAdd,
  onClose,
}: {
  onAdd: (custom: { name: string; price_cents: number; station: string }, qty: number) => void;
  onClose: () => void;
}) {
  const stationDefs = useStore((s) => s.stations?.list) ?? [{ key: 'kitchen', label: 'Kitchen' }, { key: 'bar', label: 'Bar' }];
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [station, setStation] = useState<string>(stationDefs[0]?.key ?? 'kitchen');
  const [qty, setQty] = useState(1);
  const cents = Math.round(parseFloat(price || '0') * 100);
  return (
    <Modal title="Open item" onClose={onClose}>
      <label>Name (as it should print)</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Special of the day" style={{ width: '100%' }} className="mb" autoFocus />
      <label>Price (RM)</label>
      <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%' }} className="mb" />
      <label>Prepared by</label>
      <div className="row mb">
        {stationDefs.map((st) => (
          <button key={st.key} className={station === st.key ? 'primary' : ''} onClick={() => setStation(st.key)}>{st.label}</button>
        ))}
        <div className="grow" />
        <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <strong>{qty}</strong>
        <button className="qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
      </div>
      <button
        className="primary"
        disabled={!name.trim() || !Number.isFinite(cents) || cents < 0}
        onClick={() => onAdd({ name: name.trim(), price_cents: cents, station }, qty)}
      >
        Add to bill
      </button>
    </Modal>
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

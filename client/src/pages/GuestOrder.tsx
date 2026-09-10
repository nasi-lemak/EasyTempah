import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import ComboDialog, { type ComboChoice } from '../components/ComboDialog';
import Modal from '../components/Modal';
import ModifierDialog, { type ModifierChoice } from '../components/ModifierDialog';
import { itemImageUrl } from '../images';
import { formatMoney } from '../store';
import { applyAccent } from '../theme';
import type { Item, MenuData, ModifierSnapshot } from '../types';

interface GuestInfo {
  table: { name: string; zone: string };
  business: { name: string; currencySymbol: string; accentColor?: string };
  tax: { taxLabel: string; serviceLabel: string };
  menu: MenuData;
}

interface GuestTabItem {
  id: number;
  name: string;
  qty: number;
  modifiers_json: string;
  notes: string | null;
  status: string;
  line_total_cents: number;
  source: 'staff' | 'guest';
}

interface GuestTab {
  order_no: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  promo_name: string | null;
  promo_cents: number;
  service_cents: number;
  tax_cents: number;
  total_cents: number;
  items: GuestTabItem[];
}

interface CartLine {
  key: number;
  item: Item;
  qty: number;
  modifier_ids: number[];
  combo_choices?: { group_id: number; item_id: number }[];
  modNames: string[];
  modDelta: number;
  notes: string;
}

async function guestGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Something went wrong');
  return body as T;
}

export default function GuestOrder() {
  const { token } = useParams();
  const [info, setInfo] = useState<GuestInfo | null>(null);
  const [tab, setTab] = useState<GuestTab | null>(null);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [modItem, setModItem] = useState<Item | null>(null);
  const [comboItem, setComboItem] = useState<Item | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showTab, setShowTab] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');

  const loadTab = useCallback(() => {
    guestGet<{ order: GuestTab | null }>(`/api/guest/${token}/order`)
      .then((r) => setTab(r.order))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    guestGet<GuestInfo>(`/api/guest/${token}/menu`)
      .then((r) => {
        setInfo(r);
        applyAccent(r.business.accentColor);
      })
      .catch((e) => setFatal(e instanceof Error ? e.message : 'Unable to load the menu'));
    loadTab();
    const id = setInterval(loadTab, 20000);
    return () => clearInterval(id);
  }, [token, loadTab]);

  const money = (c: number | null | undefined) => formatMoney(c, info?.business.currencySymbol ?? 'RM');

  const categories = info?.menu.categories ?? [];
  const catId = activeCat ?? categories[0]?.id ?? null;
  const items = useMemo(
    () => (info?.menu.items ?? []).filter((i) => i.category_id === catId),
    [info, catId],
  );

  const itemHasModifiers = (item: Item) => (info?.menu.links ?? []).some((l) => l.item_id === item.id);

  const addToCart = (choice: ModifierChoice) => {
    const mods = (info?.menu.modifiers ?? []).filter((m) => choice.modifier_ids.includes(m.id));
    setCart((c) => [
      ...c,
      {
        key: Date.now() + Math.random(),
        item: choice.item,
        qty: choice.qty,
        modifier_ids: choice.modifier_ids,
        modNames: mods.map((m) => m.name),
        modDelta: mods.reduce((s, m) => s + m.price_delta_cents, 0),
        notes: choice.notes,
      },
    ]);
    setModItem(null);
  };

  const addComboToCart = (choice: ComboChoice) => {
    const surcharge = choice.combo_choices.reduce((s, c) => {
      const opt = info?.menu.comboItems.find((ci) => ci.group_id === c.group_id && ci.item_id === c.item_id);
      return s + (opt?.surcharge_cents ?? 0);
    }, 0);
    const names = choice.combo_choices.map(
      (c) => info?.menu.items.find((i) => i.id === c.item_id)?.name ?? '',
    );
    setCart((c) => [
      ...c,
      {
        key: Date.now() + Math.random(),
        item: choice.item,
        qty: choice.qty,
        modifier_ids: [],
        combo_choices: choice.combo_choices,
        modNames: names,
        modDelta: surcharge,
        notes: choice.notes,
      },
    ]);
    setComboItem(null);
  };

  const tapItem = (item: Item) => {
    if (item.track_stock === 1 && item.stock_qty <= 0) return;
    if (item.is_combo) setComboItem(item);
    else if (itemHasModifiers(item)) setModItem(item);
    else addToCart({ item, qty: 1, modifier_ids: [], notes: '' });
  };

  const cartTotal = cart.reduce((s, l) => s + l.qty * (l.item.price_cents + l.modDelta), 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  const submit = async () => {
    if (busy || cart.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/guest/${token}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: cart.map((l) => ({
            item_id: l.item.id,
            qty: l.qty,
            modifier_ids: l.modifier_ids,
            combo_choices: l.combo_choices,
            notes: l.notes || undefined,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Order failed');
      setCart([]);
      setShowReview(false);
      setSent(true);
      loadTab();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  };

  if (fatal) {
    return (
      <div className="guest-wrap">
        <div className="panel mt" style={{ textAlign: 'center' }}>
          <h2>😕 {fatal}</h2>
          <p className="muted">Please ask a member of staff for help.</p>
        </div>
      </div>
    );
  }
  if (!info) return <div className="guest-wrap muted" style={{ padding: '2rem' }}>Loading menu…</div>;

  return (
    <div className="guest-wrap">
      <header className="guest-head">
        <div>
          <div className="gname">{info.business.name}</div>
          <div className="muted small">Table {info.table.name} · {info.table.zone}</div>
        </div>
        {tab && (
          <button onClick={() => { setShowTab(true); loadTab(); }}>
            My tab · {money(tab.total_cents)}
          </button>
        )}
      </header>

      {sent && (
        <div className="guest-sent" onClick={() => setSent(false)}>
          ✅ Order sent to the kitchen! Add more below, or view your tab. Pay at the counter when you're done.
        </div>
      )}

      <div className="cat-tabs">
        {categories.map((c) => (
          <button key={c.id} className={c.id === catId ? 'active' : ''} onClick={() => setActiveCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="guest-items">
        {items.map((item) => {
          const oos = item.track_stock === 1 && item.stock_qty <= 0;
          return (
            <button key={item.id} className="guest-item" onClick={() => tapItem(item)} disabled={oos}>
              {itemImageUrl(item.id, item.image_v) && (
                <img className="thumb" src={itemImageUrl(item.id, item.image_v)!} alt="" loading="lazy" />
              )}
              <span className="grow" style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>{item.name}</div>
                {oos && <div className="small" style={{ color: 'var(--danger)' }}>Sold out</div>}
              </span>
              <span className="price">{money(item.price_cents)}</span>
              <span className="add">＋</span>
            </button>
          );
        })}
      </div>

      {cart.length > 0 && (
        <div className="guest-cartbar" onClick={() => setShowReview(true)}>
          <span>{cartCount} item{cartCount === 1 ? '' : 's'}</span>
          <span>Review & send · {money(cartTotal)}</span>
        </div>
      )}

      {modItem && info && (
        <ModifierDialog item={modItem} menu={info.menu} onConfirm={addToCart} onClose={() => setModItem(null)} />
      )}
      {comboItem && info && (
        <ComboDialog item={comboItem} menu={info.menu} onConfirm={addComboToCart} onClose={() => setComboItem(null)} />
      )}

      {showReview && (
        <Modal title="Your order" onClose={() => setShowReview(false)}>
          {cart.map((l) => (
            <div key={l.key} className="cart-line" style={{ padding: '0.5rem 0' }}>
              <div className="row">
                <span className="grow"><strong>{l.qty}×</strong> {l.item.name}</span>
                <span className="mono">{money(l.qty * (l.item.price_cents + l.modDelta))}</span>
                <button className="ghost small" style={{ color: 'var(--danger)' }}
                  onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
                  ✕
                </button>
              </div>
              {l.modNames.length > 0 && <div className="mods">{l.modNames.join(', ')}</div>}
              {l.notes && <div className="note">» {l.notes}</div>}
            </div>
          ))}
          <div className="row mt">
            <strong className="grow">Items total</strong>
            <strong className="mono">{money(cartTotal)}</strong>
          </div>
          <p className="muted small">
            {info.tax.serviceLabel} and {info.tax.taxLabel} are added to your final bill at the counter.
          </p>
          <button className="primary" style={{ width: '100%' }} onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Send to kitchen'}
          </button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}

      {showTab && tab && (
        <Modal title={`Your tab — #${tab.order_no}`} onClose={() => setShowTab(false)}>
          {tab.items.map((i) => {
            const mods = (JSON.parse(i.modifiers_json) as ModifierSnapshot[]).map((m) => m.name);
            return (
              <div key={i.id} className="cart-line" style={{ padding: '0.45rem 0' }}>
                <div className="row">
                  <span className="grow">
                    <strong>{i.qty}×</strong> {i.name} <span className={`badge ${i.status}`}>{i.status}</span>
                  </span>
                  <span className="mono">{money(i.line_total_cents)}</span>
                </div>
                {mods.length > 0 && <div className="mods">{mods.join(', ')}</div>}
              </div>
            );
          })}
          <div className="cart-totals" style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0 0' }}>
            <div className="line"><span>Subtotal</span><span className="mono">{money(tab.subtotal_cents)}</span></div>
            {tab.discount_cents > 0 && <div className="line"><span>Discount</span><span className="mono">-{money(tab.discount_cents)}</span></div>}
            {tab.promo_cents > 0 && <div className="line"><span>🏷 {tab.promo_name ?? 'Promo'}</span><span className="mono">-{money(tab.promo_cents)}</span></div>}
            {tab.service_cents > 0 && <div className="line"><span>{info.tax.serviceLabel}</span><span className="mono">{money(tab.service_cents)}</span></div>}
            {tab.tax_cents > 0 && <div className="line"><span>{info.tax.taxLabel}</span><span className="mono">{money(tab.tax_cents)}</span></div>}
            <div className="line grand"><span>Total</span><span className="mono">{money(tab.total_cents)}</span></div>
          </div>
          <p className="muted small">Pay at the counter when you're ready.</p>
        </Modal>
      )}
    </div>
  );
}

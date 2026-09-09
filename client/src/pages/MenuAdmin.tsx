import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import { useMoney } from '../store';
import type { Category, ComboGroup, ComboGroupItem, Item, Modifier, ModifierGroup } from '../types';

interface AdminMenu {
  categories: Category[];
  items: Item[];
  groups: ModifierGroup[];
  modifiers: Modifier[];
  links: { item_id: number; group_id: number }[];
  comboGroups: ComboGroup[];
  comboItems: ComboGroupItem[];
}

interface ComboGroupForm {
  name: string;
  items: { item_id: number; surcharge_cents: number }[];
}

const emptyItemForm = {
  id: 0,
  name: '',
  category_id: 0,
  price: '',
  station: 'kitchen' as 'kitchen' | 'bar',
  active: true,
  modifier_group_ids: [] as number[],
};

export default function MenuAdmin() {
  const money = useMoney();
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [tab, setTab] = useState<'items' | 'categories' | 'modifiers'>('items');
  const [itemForm, setItemForm] = useState<typeof emptyItemForm | null>(null);
  const [comboForm, setComboForm] = useState<ComboGroupForm[]>([]);
  const [catName, setCatName] = useState('');
  const [groupForm, setGroupForm] = useState({ name: '', min: 0, max: 0 });
  const [modForm, setModForm] = useState({ group_id: 0, name: '', price: '' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<AdminMenu>('/api/menu/admin').then(setMenu).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (!menu) return <div className="muted">Loading…</div>;

  const saveItem = () =>
    run(async () => {
      if (!itemForm) return;
      const body = {
        name: itemForm.name,
        category_id: itemForm.category_id || menu.categories[0]?.id,
        price_cents: Math.round(parseFloat(itemForm.price || '0') * 100),
        station: itemForm.station,
        active: itemForm.active,
        modifier_group_ids: itemForm.modifier_group_ids,
      };
      let itemId = itemForm.id;
      if (itemId) {
        await api.patch(`/api/menu/items/${itemId}`, body);
      } else {
        const r = await api.post<{ id: number }>('/api/menu/items', body);
        itemId = r.id;
      }
      await api.put(`/api/menu/items/${itemId}/combo`, { groups: comboForm });
      setItemForm(null);
    });

  const editItem = (item: Item) => {
    setItemForm({
      id: item.id,
      name: item.name,
      category_id: item.category_id,
      price: (item.price_cents / 100).toFixed(2),
      station: item.station,
      active: item.active === 1,
      modifier_group_ids: menu.links.filter((l) => l.item_id === item.id).map((l) => l.group_id),
    });
    setComboForm(
      menu.comboGroups
        .filter((g) => g.item_id === item.id)
        .map((g) => ({
          name: g.name,
          items: menu.comboItems
            .filter((ci) => ci.group_id === g.id)
            .map((ci) => ({ item_id: ci.item_id, surcharge_cents: ci.surcharge_cents })),
        })),
    );
  };

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Menu Management</h1>
        {(['items', 'categories', 'modifiers'] as const).map((t) => (
          <button key={t} className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {error && <div className="error-text mb">{error}</div>}

      {tab === 'items' && (
        <>
          <button
            className="primary mb"
            onClick={() => {
              setItemForm({ ...emptyItemForm, category_id: menu.categories[0]?.id ?? 0 });
              setComboForm([]);
            }}
          >
            + New item
          </button>
          <table className="data">
            <thead>
              <tr><th>Item</th><th>Category</th><th>Station</th><th className="num">Price</th><th>Modifiers</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {menu.items.map((item) => {
                const cat = menu.categories.find((c) => c.id === item.category_id);
                const groups = menu.links
                  .filter((l) => l.item_id === item.id)
                  .map((l) => menu.groups.find((g) => g.id === l.group_id)?.name)
                  .filter(Boolean);
                return (
                  <tr key={item.id}>
                    <td>{item.name}{item.is_combo ? <span className="badge sent" style={{ marginLeft: 6 }}>set</span> : null}</td>
                    <td>{cat?.name}</td>
                    <td>{item.station}</td>
                    <td className="num">{money(item.price_cents)}</td>
                    <td className="small muted">{groups.join(', ') || '—'}</td>
                    <td>{item.active ? '✓' : <span className="muted">off</span>}</td>
                    <td className="right"><button onClick={() => editItem(item)}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="row mb">
            <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category name" />
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await api.post('/api/menu/categories', { name: catName, sort: menu.categories.length + 1 });
                  setCatName('');
                })
              }
            >
              Add
            </button>
          </div>
          <table className="data">
            <thead><tr><th>Category</th><th className="num">Items</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {menu.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">{menu.items.filter((i) => i.category_id === c.id).length}</td>
                  <td>{c.active ? '✓' : <span className="muted">off</span>}</td>
                  <td className="right">
                    <button onClick={() => run(() => api.patch(`/api/menu/categories/${c.id}`, { active: !c.active }))}>
                      {c.active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'modifiers' && (
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="panel grow">
            <h2>Groups</h2>
            <div className="row mb wrap">
              <input placeholder="Group name" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
              <input type="number" style={{ width: 70 }} title="min" value={groupForm.min} onChange={(e) => setGroupForm({ ...groupForm, min: Number(e.target.value) })} />
              <input type="number" style={{ width: 70 }} title="max (0 = unlimited)" value={groupForm.max} onChange={(e) => setGroupForm({ ...groupForm, max: Number(e.target.value) })} />
              <button className="primary" onClick={() => run(async () => {
                await api.post('/api/menu/modifier-groups', { name: groupForm.name, min_select: groupForm.min, max_select: groupForm.max });
                setGroupForm({ name: '', min: 0, max: 0 });
              })}>Add group</button>
            </div>
            {menu.groups.map((g) => (
              <div key={g.id} className="mb">
                <h3>{g.name} <span className="muted small">min {g.min_select} / max {g.max_select || '∞'}</span></h3>
                <div className="row wrap">
                  {menu.modifiers.filter((m) => m.group_id === g.id).map((m) => (
                    <button
                      key={m.id}
                      className={m.active ? '' : 'ghost'}
                      title="Toggle active"
                      onClick={() => run(() => api.patch(`/api/menu/modifiers/${m.id}`, { active: !m.active }))}
                    >
                      {m.name}{m.price_delta_cents ? ` +${money(m.price_delta_cents)}` : ''}{m.active ? '' : ' (off)'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="panel" style={{ minWidth: 280 }}>
            <h2>New modifier</h2>
            <label>Group</label>
            <select value={modForm.group_id} onChange={(e) => setModForm({ ...modForm, group_id: Number(e.target.value) })} style={{ width: '100%' }} className="mb">
              <option value={0}>Choose…</option>
              {menu.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <label>Name</label>
            <input value={modForm.name} onChange={(e) => setModForm({ ...modForm, name: e.target.value })} style={{ width: '100%' }} className="mb" />
            <label>Price delta (RM, 0 for free)</label>
            <input inputMode="decimal" value={modForm.price} onChange={(e) => setModForm({ ...modForm, price: e.target.value })} style={{ width: '100%' }} className="mb" />
            <button className="primary" onClick={() => run(async () => {
              await api.post('/api/menu/modifiers', {
                group_id: modForm.group_id,
                name: modForm.name,
                price_delta_cents: Math.round(parseFloat(modForm.price || '0') * 100),
              });
              setModForm({ group_id: 0, name: '', price: '' });
            })}>Add modifier</button>
          </div>
        </div>
      )}

      {itemForm && (
        <Modal title={itemForm.id ? `Edit ${itemForm.name}` : 'New item'} onClose={() => setItemForm(null)}>
          <label>Name</label>
          <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} style={{ width: '100%' }} className="mb" />
          <label>Category</label>
          <select value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: Number(e.target.value) })} style={{ width: '100%' }} className="mb">
            {menu.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Price (RM)</label>
          <input inputMode="decimal" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} style={{ width: '100%' }} className="mb" />
          <label>Station</label>
          <div className="row mb">
            <button className={itemForm.station === 'kitchen' ? 'primary' : ''} onClick={() => setItemForm({ ...itemForm, station: 'kitchen' })}>Kitchen</button>
            <button className={itemForm.station === 'bar' ? 'primary' : ''} onClick={() => setItemForm({ ...itemForm, station: 'bar' })}>Bar</button>
            <div className="grow" />
            <button className={itemForm.active ? 'primary' : 'danger'} onClick={() => setItemForm({ ...itemForm, active: !itemForm.active })}>
              {itemForm.active ? 'Active' : 'Inactive'}
            </button>
          </div>
          <label>Modifier groups</label>
          <div className="row wrap mb">
            {menu.groups.map((g) => {
              const on = itemForm.modifier_group_ids.includes(g.id);
              return (
                <button key={g.id} className={on ? 'primary' : ''} onClick={() =>
                  setItemForm({
                    ...itemForm,
                    modifier_group_ids: on
                      ? itemForm.modifier_group_ids.filter((id) => id !== g.id)
                      : [...itemForm.modifier_group_ids, g.id],
                  })
                }>
                  {g.name}
                </button>
              );
            })}
          </div>
          <label>Set meal (combo) — choice groups</label>
          {comboForm.map((g, gi) => (
            <div key={gi} className="panel mb" style={{ padding: '0.6rem' }}>
              <div className="row mb">
                <input
                  value={g.name}
                  placeholder="Group name, e.g. Drink"
                  className="grow"
                  onChange={(e) => {
                    const next = comboForm.slice();
                    next[gi] = { ...g, name: e.target.value };
                    setComboForm(next);
                  }}
                />
                <button className="danger" onClick={() => setComboForm(comboForm.filter((_, i) => i !== gi))}>✕</button>
              </div>
              {g.items.map((opt, oi) => (
                <div key={opt.item_id} className="row mb" style={{ marginBottom: '0.3rem' }}>
                  <span className="grow small">{menu.items.find((i) => i.id === opt.item_id)?.name}</span>
                  <span className="muted small">+RM</span>
                  <input
                    inputMode="decimal"
                    style={{ width: 70 }}
                    value={(opt.surcharge_cents / 100).toFixed(2)}
                    onChange={(e) => {
                      const next = comboForm.slice();
                      next[gi].items[oi] = {
                        ...opt,
                        surcharge_cents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)),
                      };
                      setComboForm(next);
                    }}
                  />
                  <button
                    className="ghost small"
                    onClick={() => {
                      const next = comboForm.slice();
                      next[gi] = { ...g, items: g.items.filter((_, i) => i !== oi) };
                      setComboForm(next);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <select
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id || g.items.some((x) => x.item_id === id)) return;
                  const next = comboForm.slice();
                  next[gi] = { ...g, items: [...g.items, { item_id: id, surcharge_cents: 0 }] };
                  setComboForm(next);
                }}
              >
                <option value="">+ add option…</option>
                {menu.items
                  .filter((i) => !i.is_combo && i.id !== itemForm.id && i.active)
                  .map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
              </select>
            </div>
          ))}
          <div className="row mb">
            <button onClick={() => setComboForm([...comboForm, { name: '', items: [] }])}>+ Add choice group</button>
            {comboForm.length > 0 && (
              <span className="muted small">Groups make this item a set meal; remove all to revert.</span>
            )}
          </div>

          <button className="primary" onClick={saveItem}>Save</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

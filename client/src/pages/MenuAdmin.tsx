import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import Modal from '../components/Modal';
import { useMoney } from '../store';
import type {
  Category,
  ComboGroup,
  ComboGroupItem,
  Ingredient,
  Item,
  Modifier,
  ModifierGroup,
  ModifierRecipeLine,
  Promotion,
  RecipeLine,
} from '../types';

interface AdminMenu {
  categories: Category[];
  items: Item[];
  groups: ModifierGroup[];
  modifiers: Modifier[];
  links: { item_id: number; group_id: number }[];
  comboGroups: ComboGroup[];
  comboItems: ComboGroupItem[];
  ingredients: Ingredient[];
  recipeLines: RecipeLine[];
  modifierRecipeLines: ModifierRecipeLine[];
}

interface RecipeForm {
  ingredient_id: number;
  qty: number;
}

/** Shared recipe rows editor (items and modifiers). */
function RecipeEditor({
  ingredients,
  lines,
  onChange,
}: {
  ingredients: Ingredient[];
  lines: RecipeForm[];
  onChange: (lines: RecipeForm[]) => void;
}) {
  const cost = lines.reduce((sum, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredient_id);
    return sum + (ing?.cost_per_unit_cents ?? 0) * l.qty;
  }, 0);
  return (
    <div className="panel mb" style={{ padding: '0.6rem' }}>
      {lines.map((l, i) => {
        const ing = ingredients.find((x) => x.id === l.ingredient_id);
        return (
          <div key={l.ingredient_id} className="row" style={{ marginBottom: '0.3rem' }}>
            <span className="grow small">{ing?.name}</span>
            <input
              inputMode="decimal"
              style={{ width: 80 }}
              value={String(l.qty)}
              onChange={(e) => {
                const next = lines.slice();
                next[i] = { ...l, qty: Number(e.target.value) || 0 };
                onChange(next);
              }}
            />
            <span className="muted small" style={{ width: 30 }}>{ing?.unit}</span>
            <button className="ghost small" onClick={() => onChange(lines.filter((_, x) => x !== i))}>✕</button>
          </div>
        );
      })}
      <div className="row">
        <select
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!id || lines.some((l) => l.ingredient_id === id)) return;
            onChange([...lines, { ingredient_id: id, qty: 1 }]);
          }}
        >
          <option value="">+ add ingredient…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
          ))}
        </select>
        <div className="grow" />
        {cost > 0 && <span className="muted small">Food cost ≈ RM {(cost / 100).toFixed(2)}</span>}
      </div>
    </div>
  );
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
  const [tab, setTab] = useState<'items' | 'categories' | 'modifiers' | 'promos'>('items');
  const [itemForm, setItemForm] = useState<typeof emptyItemForm | null>(null);
  const [comboForm, setComboForm] = useState<ComboGroupForm[]>([]);
  const [recipeForm, setRecipeForm] = useState<RecipeForm[]>([]);
  const [modRecipe, setModRecipe] = useState<{ modifier: Modifier; lines: RecipeForm[] } | null>(null);
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
      await api.put(`/api/menu/items/${itemId}/recipe`, {
        lines: recipeForm.filter((l) => l.qty > 0),
      });
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
    setRecipeForm(
      menu.recipeLines
        .filter((r) => r.item_id === item.id)
        .map((r) => ({ ingredient_id: r.ingredient_id, qty: r.qty })),
    );
  };

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Menu Management</h1>
        {(['items', 'categories', 'modifiers', 'promos'] as const).map((t) => (
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
              setRecipeForm([]);
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
                    <span key={m.id} className="row" style={{ gap: '0.15rem' }}>
                      <button
                        className={m.active ? '' : 'ghost'}
                        title="Toggle active"
                        onClick={() => run(() => api.patch(`/api/menu/modifiers/${m.id}`, { active: !m.active }))}
                      >
                        {m.name}{m.price_delta_cents ? ` +${money(m.price_delta_cents)}` : ''}{m.active ? '' : ' (off)'}
                      </button>
                      <button
                        className="ghost small"
                        title="Edit ingredient recipe"
                        onClick={() =>
                          setModRecipe({
                            modifier: m,
                            lines: menu.modifierRecipeLines
                              .filter((r) => r.modifier_id === m.id)
                              .map((r) => ({ ingredient_id: r.ingredient_id, qty: r.qty })),
                          })
                        }
                      >
                        🧾
                      </button>
                    </span>
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

      {tab === 'promos' && <PromosTab categories={menu.categories} items={menu.items} />}

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
          <label>Recipe — ingredients consumed per unit sold (optional)</label>
          <RecipeEditor ingredients={menu.ingredients} lines={recipeForm} onChange={setRecipeForm} />

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

      {modRecipe && (
        <Modal title={`Recipe — ${modRecipe.modifier.name}`} onClose={() => setModRecipe(null)}>
          <p className="muted small">Ingredients consumed each time this add-on is chosen.</p>
          <RecipeEditor
            ingredients={menu.ingredients}
            lines={modRecipe.lines}
            onChange={(lines) => setModRecipe({ ...modRecipe, lines })}
          />
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.put(`/api/menu/modifiers/${modRecipe.modifier.id}/recipe`, {
                  lines: modRecipe.lines.filter((l) => l.qty > 0),
                });
                setModRecipe(null);
              })
            }
          >
            Save recipe
          </button>
        </Modal>
      )}
    </div>
  );
}

// ---------- Promotions ----------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
const TYPE_LABELS: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };

interface PromoForm {
  id: number;
  name: string;
  active: boolean;
  type: 'percent' | 'amount';
  value: string; // percent, or RM for 'amount'
  scope: 'order' | 'category' | 'item';
  category_id: number;
  item_id: number;
  days: number[];
  start_time: string;
  end_time: string;
  starts_on: string;
  ends_on: string;
  order_types: string[];
}

const emptyPromoForm: PromoForm = {
  id: 0, name: '', active: true, type: 'percent', value: '', scope: 'order',
  category_id: 0, item_id: 0, days: [0, 1, 2, 3, 4, 5, 6],
  start_time: '', end_time: '', starts_on: '', ends_on: '',
  order_types: [...ALL_ORDER_TYPES],
};

function describePromo(p: Promotion): string {
  const off = p.type === 'percent' ? `${p.value}% off` : `RM ${(p.value / 100).toFixed(2)} off`;
  const what = p.scope === 'order' ? 'whole order' : p.scope === 'category' ? (p.category_name ?? 'category') : (p.item_name ?? 'item');
  const days = JSON.parse(p.days_json) as number[];
  const daysTxt = days.length >= 7 ? 'daily' : days.map((d) => DAY_LABELS[d]).join(' ');
  const timeTxt = p.start_time && p.end_time ? ` ${p.start_time}–${p.end_time}` : '';
  const dateTxt = p.starts_on || p.ends_on ? ` (${p.starts_on ?? '…'} → ${p.ends_on ?? '…'})` : '';
  return `${off} · ${what} · ${daysTxt}${timeTxt}${dateTxt}`;
}

function PromosTab({ categories, items }: { categories: Category[]; items: Item[] }) {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [form, setForm] = useState<PromoForm | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ promotions: Promotion[] }>('/api/promotions').then((r) => setPromos(r.promotions)).catch(() => {});
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

  const save = () =>
    run(async () => {
      if (!form) return;
      const body = {
        name: form.name,
        active: form.active,
        type: form.type,
        value: form.type === 'percent' ? Math.round(Number(form.value)) : Math.round(parseFloat(form.value || '0') * 100),
        scope: form.scope,
        category_id: form.scope === 'category' ? form.category_id || null : null,
        item_id: form.scope === 'item' ? form.item_id || null : null,
        days: form.days,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        order_types: form.order_types,
      };
      if (form.id) await api.put(`/api/promotions/${form.id}`, body);
      else await api.post('/api/promotions', body);
      setForm(null);
    });

  const edit = (p: Promotion) =>
    setForm({
      id: p.id,
      name: p.name,
      active: !!p.active,
      type: p.type,
      value: p.type === 'percent' ? String(p.value) : (p.value / 100).toFixed(2),
      scope: p.scope,
      category_id: p.category_id ?? 0,
      item_id: p.item_id ?? 0,
      days: JSON.parse(p.days_json) as number[],
      start_time: p.start_time ?? '',
      end_time: p.end_time ?? '',
      starts_on: p.starts_on ?? '',
      ends_on: p.ends_on ?? '',
      order_types: JSON.parse(p.order_types_json) as string[],
    });

  return (
    <div>
      <div className="row mb">
        <button className="primary" onClick={() => setForm({ ...emptyPromoForm })}>+ New promotion</button>
        <span className="muted small">The single best-value active promotion applies per order; platform orders are excluded.</span>
      </div>
      {error && <div className="error-text mb">{error}</div>}
      {promos.length === 0 && <div className="muted">No promotions yet. Try a weekday happy hour on Drinks.</div>}
      {promos.map((p) => (
        <div key={p.id} className="panel row mb" style={{ alignItems: 'center', padding: '0.6rem 0.8rem' }}>
          <div className="grow">
            <strong>{p.name}</strong>{!p.active && <span className="muted"> (off)</span>}
            <div className="muted small">{describePromo(p)}</div>
          </div>
          <button onClick={() => run(() => api.put(`/api/promotions/${p.id}`, { active: !p.active }))}>
            {p.active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={() => edit(p)}>Edit</button>
          <button className="ghost" onClick={() => run(() => api.delete(`/api/promotions/${p.id}`))}>Delete</button>
        </div>
      ))}

      {form && (
        <Modal title={form.id ? `Edit ${form.name}` : 'New promotion'} onClose={() => setForm(null)}>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} className="mb" placeholder="Happy Hour" />
          <div className="row mb">
            <button className={form.type === 'percent' ? 'primary' : ''} onClick={() => setForm({ ...form, type: 'percent' })}>Percent %</button>
            <button className={form.type === 'amount' ? 'primary' : ''} onClick={() => setForm({ ...form, type: 'amount' })}>Amount RM</button>
            <input
              inputMode="decimal"
              placeholder={form.type === 'percent' ? '%' : 'RM'}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              style={{ width: 90 }}
            />
          </div>
          <label>Applies to</label>
          <div className="row mb wrap">
            <button className={form.scope === 'order' ? 'primary' : ''} onClick={() => setForm({ ...form, scope: 'order' })}>Whole order</button>
            <button className={form.scope === 'category' ? 'primary' : ''} onClick={() => setForm({ ...form, scope: 'category' })}>Category</button>
            <button className={form.scope === 'item' ? 'primary' : ''} onClick={() => setForm({ ...form, scope: 'item' })}>Item</button>
            {form.scope === 'category' && (
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })}>
                <option value={0}>Choose category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {form.scope === 'item' && (
              <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: Number(e.target.value) })}>
                <option value={0}>Choose item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
          <label>Days</label>
          <div className="row mb wrap">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                className={form.days.includes(i) ? 'primary' : ''}
                onClick={() =>
                  setForm({
                    ...form,
                    days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i],
                  })
                }
              >
                {d}
              </button>
            ))}
          </div>
          <label>Time window (blank = all day; end before start = overnight)</label>
          <div className="row mb">
            <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            <span className="muted">to</span>
            <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <label>Date range (optional)</label>
          <div className="row mb">
            <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </div>
          <label>Order types</label>
          <div className="row mb wrap">
            {ALL_ORDER_TYPES.map((t) => (
              <button
                key={t}
                className={form.order_types.includes(t) ? 'primary' : ''}
                onClick={() =>
                  setForm({
                    ...form,
                    order_types: form.order_types.includes(t)
                      ? form.order_types.filter((x) => x !== t)
                      : [...form.order_types, t],
                  })
                }
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="row mb" style={{ gap: '0.4rem' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <button className="primary" onClick={save}>{form.id ? 'Save promotion' : 'Create promotion'}</button>
        </Modal>
      )}
    </div>
  );
}

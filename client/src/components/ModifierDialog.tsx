import { useMemo, useState } from 'react';
import { useMoney } from '../store';
import type { Item, MenuData, Modifier, ModifierGroup } from '../types';
import Modal from './Modal';

export interface ModifierChoice {
  item: Item;
  qty: number;
  modifier_ids: number[];
  notes: string;
}

export default function ModifierDialog({
  item,
  menu,
  onConfirm,
  onClose,
}: {
  item: Item;
  menu: MenuData;
  onConfirm: (choice: ModifierChoice) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const groups = useMemo(() => {
    const groupIds = menu.links.filter((l) => l.item_id === item.id).map((l) => l.group_id);
    return menu.groups
      .filter((g) => groupIds.includes(g.id))
      .map((g) => ({
        group: g,
        mods: menu.modifiers.filter((m) => m.group_id === g.id),
      }));
  }, [item, menu]);

  const toggle = (group: ModifierGroup, mod: Modifier) => {
    setError('');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mod.id)) {
        next.delete(mod.id);
        return next;
      }
      const groupMods = menu.modifiers.filter((m) => m.group_id === group.id).map((m) => m.id);
      const inGroup = [...next].filter((id) => groupMods.includes(id));
      if (group.max_select === 1) {
        for (const id of inGroup) next.delete(id);
      } else if (group.max_select > 1 && inGroup.length >= group.max_select) {
        return next; // at limit
      }
      next.add(mod.id);
      return next;
    });
  };

  const confirm = () => {
    for (const { group, mods } of groups) {
      const count = mods.filter((m) => selected.has(m.id)).length;
      if (count < group.min_select) {
        setError(`Choose at least ${group.min_select} from "${group.name}"`);
        return;
      }
    }
    onConfirm({ item, qty, modifier_ids: [...selected], notes: notes.trim() });
  };

  const extra = menu.modifiers
    .filter((m) => selected.has(m.id))
    .reduce((s, m) => s + m.price_delta_cents, 0);

  return (
    <Modal title={item.name} onClose={onClose}>
      {groups.map(({ group, mods }) => (
        <div key={group.id} className="mb">
          <h3>
            {group.name}{' '}
            <span className="muted small">
              {group.min_select > 0 ? `(required` : '(optional'}
              {group.max_select > 0 ? `, max ${group.max_select})` : ')'}
            </span>
          </h3>
          <div className="row wrap">
            {mods.map((m) => (
              <button
                key={m.id}
                className={selected.has(m.id) ? 'primary' : ''}
                onClick={() => toggle(group, m)}
              >
                {m.name}
                {m.price_delta_cents > 0 && ` +${money(m.price_delta_cents)}`}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="mb">
        <label>Notes for the kitchen</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. no peanuts"
          style={{ width: '100%' }}
        />
      </div>

      <div className="row">
        <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <strong>{qty}</strong>
        <button className="qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
        <div className="grow" />
        <button className="primary" onClick={confirm}>
          Add · {money(qty * (item.price_cents + extra))}
        </button>
      </div>
      {error && <div className="error-text mt">{error}</div>}
    </Modal>
  );
}

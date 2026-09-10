import { useMemo, useState } from 'react';
import { useMoney } from '../store';
import type { Item, MenuData } from '../types';
import Modal from './Modal';

export interface ComboChoice {
  item: Item;
  qty: number;
  combo_choices: { group_id: number; item_id: number }[];
  notes: string;
}

/** Set-meal picker: exactly one component per choice group, surcharges shown. */
export default function ComboDialog({
  item,
  menu,
  onConfirm,
  onClose,
}: {
  item: Item;
  menu: MenuData;
  onConfirm: (choice: ComboChoice) => void;
  onClose: () => void;
}) {
  const money = useMoney();
  const groups = useMemo(
    () => menu.comboGroups.filter((g) => g.item_id === item.id),
    [menu, item],
  );
  const [picks, setPicks] = useState<Record<number, number>>({}); // group_id -> item_id
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const surcharge = groups.reduce((sum, g) => {
    const picked = picks[g.id];
    if (!picked) return sum;
    const opt = menu.comboItems.find((ci) => ci.group_id === g.id && ci.item_id === picked);
    return sum + (opt?.surcharge_cents ?? 0);
  }, 0);

  const confirm = () => {
    for (const g of groups) {
      if (!picks[g.id]) {
        setError(`Choose an option for "${g.name}"`);
        return;
      }
    }
    onConfirm({
      item,
      qty,
      combo_choices: groups.map((g) => ({ group_id: g.id, item_id: picks[g.id] })),
      notes: notes.trim(),
    });
  };

  return (
    <Modal title={item.name} onClose={onClose}>
      {groups.map((g) => (
        <div key={g.id} className="mb">
          <h3>{g.name}</h3>
          <div className="row wrap">
            {menu.comboItems
              .filter((ci) => ci.group_id === g.id)
              .map((ci) => {
                const component = menu.items.find((i) => i.id === ci.item_id);
                if (!component) return null;
                const oos = component.track_stock === 1 && component.stock_qty <= 0;
                return (
                  <button
                    key={ci.item_id}
                    className={picks[g.id] === ci.item_id ? 'primary' : ''}
                    disabled={oos}
                    onClick={() => {
                      setError('');
                      setPicks((p) => ({ ...p, [g.id]: ci.item_id }));
                    }}
                  >
                    {component.name}
                    {ci.surcharge_cents > 0 && ` +${money(ci.surcharge_cents)}`}
                    {oos && ' (out)'}
                  </button>
                );
              })}
          </div>
        </div>
      ))}

      <div className="mb">
        <label>Notes for the kitchen</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} />
      </div>

      <div className="row">
        <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <strong>{qty}</strong>
        <button className="qty-btn" onClick={() => setQty((q) => q + 1)}>+</button>
        <div className="grow" />
        <button className="primary" onClick={confirm}>
          Add · {money(qty * (item.price_cents + surcharge))}
        </button>
      </div>
      {error && <div className="error-text mt" role="alert">{error}</div>}
    </Modal>
  );
}

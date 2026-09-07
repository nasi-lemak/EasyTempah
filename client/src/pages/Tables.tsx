import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import { useMoney } from '../store';
import type { DiningTable, Order } from '../types';
import { minutesSince } from '../time';
import { useEvents } from '../useEvents';

export default function Tables() {
  const navigate = useNavigate();
  const money = useMoney();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [seatTable, setSeatTable] = useState<DiningTable | null>(null);
  const [covers, setCovers] = useState(2);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ tables: DiningTable[] }>('/api/tables').then((r) => setTables(r.tables)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['tables', 'orders'], load);

  const zones = useMemo(() => {
    const map = new Map<string, DiningTable[]>();
    for (const t of tables) {
      if (!map.has(t.zone)) map.set(t.zone, []);
      map.get(t.zone)!.push(t);
    }
    return [...map.entries()];
  }, [tables]);

  const tapTable = (t: DiningTable) => {
    if (t.order_id) {
      navigate(`/pos/${t.order_id}`);
    } else {
      setCovers(Math.min(2, t.seats));
      setSeatTable(t);
    }
  };

  const seat = async () => {
    if (!seatTable) return;
    setError('');
    try {
      const r = await api.post<{ order: Order }>('/api/orders', {
        type: 'dine_in',
        table_id: seatTable.id,
        covers,
      });
      setSeatTable(null);
      navigate(`/pos/${r.order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open table');
    }
  };

  const age = (iso: string | null) => {
    if (!iso) return '';
    const mins = minutesSince(iso);
    return mins < 1 ? 'just now' : `${mins}m`;
  };

  return (
    <div>
      <h1>Tables</h1>
      {zones.map(([zone, zoneTables]) => (
        <div key={zone}>
          <div className="zone-title">{zone}</div>
          <div className="table-grid">
            {zoneTables.map((t) => (
              <button
                key={t.id}
                className={`table-card ${t.order_id ? 'occupied' : 'free'}`}
                onClick={() => tapTable(t)}
              >
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="tname">{t.name}</span>
                  <span className="muted small">{t.seats} seats</span>
                </span>
                {t.order_id ? (
                  <span>
                    <div className="small">#{t.order_no} · {t.covers} pax · {age(t.order_opened_at)}</div>
                    <div style={{ fontWeight: 700, color: 'var(--warn)' }}>{money(t.total_cents)}</div>
                  </span>
                ) : (
                  <span className="muted small">Available</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {seatTable && (
        <Modal title={`Seat table ${seatTable.name}`} onClose={() => setSeatTable(null)}>
          <label>Guests</label>
          <div className="row mb">
            <button className="qty-btn" onClick={() => setCovers((c) => Math.max(1, c - 1))}>−</button>
            <strong style={{ fontSize: '1.3rem' }}>{covers}</strong>
            <button className="qty-btn" onClick={() => setCovers((c) => c + 1)}>+</button>
          </div>
          <button className="primary" onClick={seat}>Open table</button>
          {error && <div className="error-text mt">{error}</div>}
        </Modal>
      )}
    </div>
  );
}

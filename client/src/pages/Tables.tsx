import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import { hasRole, useMoney, useStore } from '../store';
import { minutesSince } from '../time';
import type { DiningTable, Order } from '../types';
import { useEvents } from '../useEvents';

type ViewMode = 'floor' | 'grid';
type Draft = Map<number, { pos_x: number | null; pos_y: number | null; shape: 'square' | 'round' }>;

const VIEW_KEY = 'easytempah.tablesView';

function age(iso: string | null): string {
  if (!iso) return '';
  const mins = minutesSince(iso);
  return mins < 1 ? 'now' : `${mins}m`;
}

export default function Tables() {
  const navigate = useNavigate();
  const money = useMoney();
  const user = useStore((s) => s.user);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'floor';
    } catch {
      return 'floor';
    }
  });
  const [zone, setZone] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Draft>(new Map());
  const [seatTable, setSeatTable] = useState<DiningTable | null>(null);
  const [covers, setCovers] = useState(2);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ tables: DiningTable[] }>('/api/tables').then((r) => setTables(r.tables)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEvents(['tables', 'orders', 'kds'], load);

  const setViewPersist = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const zones = useMemo(() => {
    const names: string[] = [];
    for (const t of tables) if (!names.includes(t.zone)) names.push(t.zone);
    return names;
  }, [tables]);
  const activeZone = zone && zones.includes(zone) ? zone : zones[0] ?? null;

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

  const saveLayout = async () => {
    if (draft.size === 0) {
      setEditMode(false);
      return;
    }
    setError('');
    try {
      await api.post('/api/tables/layout', {
        positions: [...draft.entries()].map(([id, p]) => ({ id, ...p })),
      });
      setDraft(new Map());
      setEditMode(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save layout');
    }
  };

  const zoneTables = tables.filter((t) => t.zone === activeZone);

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Tables</h1>
        <button className={view === 'floor' ? 'primary' : ''} onClick={() => setViewPersist('floor')}>
          Floor plan
        </button>
        <button className={view === 'grid' ? 'primary' : ''} onClick={() => setViewPersist('grid')}>
          Grid
        </button>
        {hasRole(user, 'manager') && <button onClick={() => navigate('/table-qr')}>QR codes</button>}
        {view === 'floor' && hasRole(user, 'manager') && (
          editMode ? (
            <>
              <button className="primary" onClick={saveLayout}>Save layout</button>
              <button onClick={() => { setDraft(new Map()); setEditMode(false); }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)}>Edit layout</button>
          )
        )}
      </div>
      {error && <div className="error-text mb">{error}</div>}

      {view === 'floor' ? (
        <>
          <div className="row wrap mb">
            {zones.map((z) => (
              <button key={z} className={z === activeZone ? 'primary' : ''} onClick={() => setZone(z)}>
                {z}
              </button>
            ))}
          </div>
          <FloorPlan
            tables={zoneTables}
            editMode={editMode}
            draft={draft}
            setDraft={setDraft}
            onTap={tapTable}
            money={money}
          />
          <div className="floor-legend">
            <span><span className="dot" style={{ background: 'var(--warn)', borderRadius: 2 }} />occupied</span>
            <span><span className="dot cooking" style={{ background: 'var(--warn)' }} />cooking</span>
            <span><span className="dot" style={{ background: 'var(--accent)' }} />food ready</span>
            {editMode && <span className="grow right">Drag tables to arrange · tap a table to toggle square/round</span>}
          </div>
        </>
      ) : (
        <GridView tables={tables} onTap={tapTable} money={money} />
      )}

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

function FloorPlan({
  tables,
  editMode,
  draft,
  setDraft,
  onTap,
  money,
}: {
  tables: DiningTable[];
  editMode: boolean;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onTap: (t: DiningTable) => void;
  money: (cents: number | null | undefined) => string;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; moved: boolean } | null>(null);

  const posOf = (t: DiningTable) => {
    const d = draft.get(t.id);
    return {
      pos_x: d ? d.pos_x : t.pos_x,
      pos_y: d ? d.pos_y : t.pos_y,
      shape: d ? d.shape : t.shape,
    };
  };

  const setPos = (t: DiningTable, patch: Partial<{ pos_x: number | null; pos_y: number | null; shape: 'square' | 'round' }>) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const cur = posOf(t);
      next.set(t.id, { ...cur, ...patch });
      return next;
    });
  };

  const toCanvasPct = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.min(96, Math.max(4, x)), y: Math.min(92, Math.max(8, y)) };
  };

  const onPointerDown = (e: React.PointerEvent, t: DiningTable) => {
    if (!editMode) return;
    dragRef.current = { id: t.id, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent, t: DiningTable) => {
    if (!editMode || dragRef.current?.id !== t.id) return;
    if (e.buttons === 0) return;
    dragRef.current.moved = true;
    const { x, y } = toCanvasPct(e);
    setPos(t, { pos_x: Math.round(x * 10) / 10, pos_y: Math.round(y * 10) / 10 });
  };

  const onPointerUp = (t: DiningTable) => {
    if (!editMode) return;
    const wasDrag = dragRef.current?.moved;
    dragRef.current = null;
    if (!wasDrag) {
      // A plain tap in edit mode toggles the table's shape.
      const { shape } = posOf(t);
      setPos(t, { shape: shape === 'round' ? 'square' : 'round' });
    }
  };

  const placed = tables.filter((t) => posOf(t).pos_x != null && posOf(t).pos_y != null);
  const unplaced = tables.filter((t) => posOf(t).pos_x == null || posOf(t).pos_y == null);

  return (
    <>
      <div className="floor-canvas" ref={canvasRef}>
        {placed.map((t) => {
          const { pos_x, pos_y, shape } = posOf(t);
          const occupied = !!t.order_id;
          const size = (occupied ? 72 : 58) + t.seats * 4;
          const ready = (t.ready_lines ?? 0) > 0;
          const cooking = (t.cooking_lines ?? 0) > 0;
          return (
            <div
              key={t.id}
              className={`floor-node ${shape} ${occupied ? 'occupied' : 'free'}${editMode ? ' editing' : ''}`}
              style={{ left: `${pos_x}%`, top: `${pos_y}%`, width: size, height: size }}
              onClick={() => !editMode && onTap(t)}
              onPointerDown={(e) => onPointerDown(e, t)}
              onPointerMove={(e) => onPointerMove(e, t)}
              onPointerUp={() => onPointerUp(t)}
              role="button"
              title={occupied ? `#${t.order_no} · ${t.covers} pax · ${age(t.order_opened_at)}` : `${t.seats} seats — tap to seat`}
            >
              {occupied && (ready || cooking) && <span className={`dot ${ready ? 'ready' : 'cooking'}`} />}
              <span className="tname">{t.name}</span>
              {occupied ? (
                <>
                  <span className="sub">{t.covers} pax · {age(t.order_opened_at)}</span>
                  <span className="amt">{money(t.total_cents)}</span>
                </>
              ) : (
                <span className="sub">{t.seats} seats</span>
              )}
            </div>
          );
        })}
        {placed.length === 0 && (
          <div className="muted" style={{ padding: '1rem' }}>
            No tables placed in this zone yet{editMode ? ' — tap one below to place it.' : '. A manager can arrange them via “Edit layout”.'}
          </div>
        )}
      </div>

      {unplaced.length > 0 && (
        <div className="floor-tray">
          <span className="muted small">Not on the floor plan:</span>
          {unplaced.map((t) => (
            <button
              key={t.id}
              onClick={() => (editMode ? setPos(t, { pos_x: 50, pos_y: 50 }) : onTap(t))}
              title={editMode ? 'Place at centre, then drag into position' : undefined}
            >
              {t.name}{t.order_id ? ` · ${money(t.total_cents)}` : ''}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function GridView({
  tables,
  onTap,
  money,
}: {
  tables: DiningTable[];
  onTap: (t: DiningTable) => void;
  money: (cents: number | null | undefined) => string;
}) {
  const zones = useMemo(() => {
    const map = new Map<string, DiningTable[]>();
    for (const t of tables) {
      if (!map.has(t.zone)) map.set(t.zone, []);
      map.get(t.zone)!.push(t);
    }
    return [...map.entries()];
  }, [tables]);

  return (
    <>
      {zones.map(([zone, zoneTables]) => (
        <div key={zone}>
          <div className="zone-title">{zone}</div>
          <div className="table-grid">
            {zoneTables.map((t) => (
              <button
                key={t.id}
                className={`table-card ${t.order_id ? 'occupied' : 'free'}`}
                onClick={() => onTap(t)}
              >
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="tname">{t.name}</span>
                  <span className="muted small">{t.seats} seats</span>
                </span>
                {t.order_id ? (
                  <span>
                    <div className="small">
                      #{t.order_no} · {t.covers} pax · {age(t.order_opened_at)}
                      {(t.ready_lines ?? 0) > 0 ? ' · ✅ ready' : (t.cooking_lines ?? 0) > 0 ? ' · 🍳 cooking' : ''}
                    </div>
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
    </>
  );
}

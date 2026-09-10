import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import type { DiningTable, Reservation } from '../types';
import { useEvents } from '../useEvents';

const STATUS_BADGE: Record<Reservation['status'], string> = {
  booked: 'open',
  seated: 'paid',
  cancelled: 'void',
  no_show: 'cancelled',
};

interface BookingForm {
  id: number;
  name: string;
  phone: string;
  party_size: number;
  reserved_at: string; // datetime-local value
  table_id: number;
  notes: string;
}

function emptyForm(date: string): BookingForm {
  return { id: 0, name: '', phone: '', party_size: 2, reserved_at: `${date}T19:00`, table_id: 0, notes: '' };
}

export default function Bookings() {
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [form, setForm] = useState<BookingForm | null>(null);
  const [seatFor, setSeatFor] = useState<Reservation | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ reservations: Reservation[] }>(`/api/reservations?date=${date}`).then((r) => setRows(r.reservations)).catch(() => {});
    api.get<{ tables: DiningTable[] }>('/api/tables').then((r) => setTables(r.tables)).catch(() => {});
  }, [date]);
  useEffect(load, [load]);
  useEvents(['reservations', 'tables'], load);

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
        phone: form.phone || undefined,
        party_size: form.party_size,
        reserved_at: form.reserved_at,
        table_id: form.table_id || undefined,
        notes: form.notes || undefined,
      };
      if (form.id) await api.patch(`/api/reservations/${form.id}`, body);
      else await api.post('/api/reservations', body);
      setForm(null);
      setDate(form.reserved_at.slice(0, 10));
    });

  const setStatus = (r: Reservation, status: 'cancelled' | 'no_show' | 'booked') =>
    run(() => api.patch(`/api/reservations/${r.id}`, { status }));

  const seat = (r: Reservation, tableId: number) =>
    run(async () => {
      const resp = await api.post<{ order_id: number }>(`/api/reservations/${r.id}/seat`, { table_id: tableId });
      setSeatFor(null);
      navigate(`/pos/${resp.order_id}`);
    });

  const freeTables = tables.filter((t) => !t.order_id);
  const time = (at: string) =>
    new Date(at.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className="row mb wrap">
        <h1 className="grow">Bookings</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="primary" onClick={() => setForm(emptyForm(date))}>+ New booking</button>
      </div>
      {error && <div className="error-text mb">{error}</div>}

      {rows.length === 0 && <div className="muted">No bookings on this day yet.</div>}
      {rows.map((r) => (
        <div key={r.id} className="panel row wrap mb" style={{ padding: '0.6rem 0.9rem', alignItems: 'center' }}>
          <strong style={{ minWidth: 62 }}>{time(r.reserved_at)}</strong>
          <span className="grow">
            <strong>{r.name}</strong> · {r.party_size} pax
            {r.table_name && <span className="muted"> · {r.table_name}</span>}
            {r.customer_id && <span title="Loyalty member — attaches to the bill on seating"> ⭐</span>}
            {r.phone && <div className="muted small">{r.phone}</div>}
            {r.notes && <div className="muted small">» {r.notes}</div>}
          </span>
          <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span>
          {r.status === 'booked' && (
            <>
              <button className="primary" onClick={() => (r.table_id && freeTables.some((t) => t.id === r.table_id) ? seat(r, r.table_id) : setSeatFor(r))}>
                Seat
              </button>
              <button onClick={() => setForm({
                id: r.id, name: r.name, phone: r.phone ?? '', party_size: r.party_size,
                reserved_at: r.reserved_at.replace(' ', 'T').slice(0, 16), table_id: r.table_id ?? 0, notes: r.notes ?? '',
              })}>Edit</button>
              <button className="ghost" onClick={() => setStatus(r, 'no_show')}>No-show</button>
              <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => setStatus(r, 'cancelled')}>Cancel</button>
            </>
          )}
          {r.status === 'seated' && r.seated_order_id && (
            <button onClick={() => navigate(`/pos/${r.seated_order_id}`)}>Open bill</button>
          )}
          {(r.status === 'cancelled' || r.status === 'no_show') && (
            <button className="ghost" onClick={() => setStatus(r, 'booked')}>Restore</button>
          )}
        </div>
      ))}

      {form && (
        <Modal title={form.id ? `Edit booking — ${form.name}` : 'New booking'} onClose={() => setForm(null)}>
          <label>Guest name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} className="mb" autoFocus />
          <label>Phone (links their loyalty membership)</label>
          <input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ width: '100%' }} className="mb" />
          <div className="row mb">
            <div>
              <label>When</label>
              <input type="datetime-local" value={form.reserved_at} onChange={(e) => setForm({ ...form, reserved_at: e.target.value })} />
            </div>
            <div>
              <label>Pax</label>
              <input type="number" min={1} value={form.party_size} style={{ width: 70 }}
                onChange={(e) => setForm({ ...form, party_size: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          </div>
          <label>Table (optional — pick at seating otherwise)</label>
          <select value={form.table_id} onChange={(e) => setForm({ ...form, table_id: Number(e.target.value) })} style={{ width: '100%' }} className="mb">
            <option value={0}>Decide later</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.zone} · {t.seats} seats</option>
            ))}
          </select>
          <label>Notes (birthday, highchair, window seat…)</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: '100%' }} className="mb" />
          <button className="primary" onClick={save} disabled={!form.name.trim()}>
            {form.id ? 'Save booking' : 'Create booking'}
          </button>
        </Modal>
      )}

      {seatFor && (
        <Modal title={`Seat ${seatFor.name} (${seatFor.party_size} pax)`} onClose={() => setSeatFor(null)}>
          {freeTables.length === 0 && <p className="muted">No free tables right now.</p>}
          <div className="row wrap">
            {freeTables.map((t) => (
              <button key={t.id} onClick={() => seat(seatFor, t.id)}>
                {t.name} <span className="muted small">{t.seats} seats</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

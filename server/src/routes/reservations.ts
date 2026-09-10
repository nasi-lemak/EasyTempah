import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import { audit } from '../services/audit';
import { attachCustomer, createOrder } from '../services/orders';
import { getLoyaltySettings } from '../services/settings';
import type { Customer } from '../types';

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth, requireRole('cashier'));

export interface ReservationRow {
  id: number;
  name: string;
  phone: string | null;
  party_size: number;
  reserved_at: string;
  table_id: number | null;
  status: 'booked' | 'seated' | 'cancelled' | 'no_show';
  notes: string | null;
  customer_id: number | null;
  seated_order_id: number | null;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const clean = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(clean)) throw badRequest('Phone number looks invalid');
  return clean;
}

function validate(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw badRequest('Guest name required');
  const party = Number(body.party_size);
  if (!Number.isInteger(party) || party < 1 || party > 100) throw badRequest('Party size must be 1-100');
  const when = typeof body.reserved_at === 'string' ? body.reserved_at.replace('T', ' ').slice(0, 16) + ':00' : '';
  if (!DATETIME_RE.test(when)) throw badRequest('reserved_at must be YYYY-MM-DD HH:MM');
  let tableId: number | null = null;
  if (body.table_id) {
    const t = db.prepare('SELECT id, seats FROM dining_tables WHERE id = ? AND active = 1').get(body.table_id);
    if (!t) throw badRequest('Unknown table');
    tableId = Number(body.table_id);
  }
  const phone = normalizePhone(body.phone);
  // Reservations link to an existing member by phone so seating carries loyalty over.
  const customer = phone
    ? ((db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone) as { id: number } | undefined)?.id ?? null)
    : null;
  return {
    name,
    phone,
    party_size: party,
    reserved_at: when,
    table_id: tableId,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    customer_id: customer,
  };
}

function listForDate(date: string): ReservationRow[] {
  return db
    .prepare(
      `SELECT r.*, t.name AS table_name, t.zone AS table_zone
       FROM reservations r LEFT JOIN dining_tables t ON t.id = r.table_id
       WHERE date(r.reserved_at) = ?
       ORDER BY r.reserved_at, r.id`,
    )
    .all(date) as ReservationRow[];
}

reservationsRouter.get('/', (req, res) => {
  const date =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
  res.json({ date, reservations: listForDate(date) });
});

reservationsRouter.post('/', (req: AuthedRequest, res) => {
  const v = validate(req.body as Record<string, unknown>);
  const info = db
    .prepare(
      `INSERT INTO reservations (name, phone, party_size, reserved_at, table_id, notes, customer_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(v.name, v.phone, v.party_size, v.reserved_at, v.table_id, v.notes, v.customer_id, req.user!.id);
  audit(req.user!.id, 'reservation.create', { id: Number(info.lastInsertRowid), name: v.name, at: v.reserved_at });
  publish('reservations');
  publish('tables');
  res.status(201).json({ id: Number(info.lastInsertRowid), reservations: listForDate(v.reserved_at.slice(0, 10)) });
});

reservationsRouter.patch('/:id', (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id) as ReservationRow | undefined;
  if (!row) throw notFound('Reservation not found');
  const body = req.body as Record<string, unknown>;

  // Status-only transitions: cancel / no_show (and back to booked to undo).
  if (typeof body.status === 'string') {
    if (!['booked', 'cancelled', 'no_show'].includes(body.status)) throw badRequest('Invalid status');
    if (row.status === 'seated') throw conflict('Already seated — manage it from the order instead');
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(body.status, row.id);
    audit(req.user!.id, 'reservation.status', { id: row.id, status: body.status });
  } else {
    if (row.status !== 'booked') throw conflict(`Cannot edit a ${row.status} reservation`);
    const v = validate({ ...row, ...body });
    db.prepare(
      `UPDATE reservations SET name = ?, phone = ?, party_size = ?, reserved_at = ?, table_id = ?, notes = ?, customer_id = ?
       WHERE id = ?`,
    ).run(v.name, v.phone, v.party_size, v.reserved_at, v.table_id, v.notes, v.customer_id, row.id);
  }
  publish('reservations');
  publish('tables');
  res.json({ reservations: listForDate(row.reserved_at.slice(0, 10)) });
});

/** Seat the party: opens a dine-in order on the (given or booked) table. */
reservationsRouter.post('/:id/seat', (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id) as ReservationRow | undefined;
  if (!row) throw notFound('Reservation not found');
  if (row.status !== 'booked') throw conflict(`Reservation is ${row.status}`);
  const tableId = Number((req.body as { table_id?: number }).table_id ?? row.table_id);
  if (!tableId) throw badRequest('Pick a table to seat this party');
  const open = db
    .prepare("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open' LIMIT 1")
    .get(tableId);
  if (open) throw conflict('That table already has an open bill — pick another');

  const orderId = createOrder(
    { type: 'dine_in', table_id: tableId, covers: row.party_size, notes: null },
    req.user!.id,
  );
  db.prepare(
    "UPDATE reservations SET status = 'seated', table_id = ?, seated_order_id = ? WHERE id = ?",
  ).run(tableId, orderId, row.id);
  // Carry an EXISTING member onto the bill so points work without re-asking
  // for the phone. Seating never creates a member — joining loyalty needs the
  // customer's consent at the till (PDPA), not a booking phone number.
  let member: Customer | null = null;
  if (row.phone && getLoyaltySettings().enabled) {
    const existing = db
      .prepare("SELECT id FROM customers WHERE phone = ? AND phone NOT LIKE 'deleted-%'")
      .get(row.phone.replace(/[^\d+]/g, '')) as { id: number } | undefined;
    if (existing) {
      try {
        member = attachCustomer(orderId, '', row.name, req.user!.id, { customerId: existing.id });
      } catch {
        /* loyalty attach is best-effort — seating must not fail on it */
      }
    }
  }
  audit(req.user!.id, 'reservation.seat', { id: row.id, orderId, tableId });
  publish('reservations');
  publish('orders');
  publish('tables');
  res.status(201).json({ order_id: orderId, member: member ? { id: member.id, phone: member.phone } : null });
});

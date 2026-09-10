import { db } from '../db/connection';
import { conflict, notFound } from '../middleware/errors';
import type { Customer } from '../types';
import { audit } from './audit';
import { getLoyaltySettings } from './settings';

/**
 * PDPA erasure: strip everything that identifies the person, keep the ledger
 * rows (with identity gone they are just numbers) so historical totals and
 * audits still add up. Remaining points are forfeited with a ledger entry.
 */
export const anonymiseCustomer = db.transaction(
  (customerId: number, userId: number | null, why: 'request' | 'retention'): void => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as
      | Customer
      | undefined;
    if (!customer) throw notFound('Member not found');
    if (customer.phone.startsWith('deleted-')) throw conflict('Member is already deleted');
    if (customer.points > 0) {
      db.prepare(
        'INSERT INTO point_movements (customer_id, delta, reason, user_id) VALUES (?, ?, ?, ?)',
      ).run(customerId, -customer.points, `forfeit: member deleted (${why})`, userId);
    }
    db.prepare(
      `UPDATE customers
       SET phone = 'deleted-' || id, name = NULL, points = 0, consent_at = NULL
       WHERE id = ?`,
    ).run(customerId);
    audit(userId, 'customer.delete', { customerId, why });
  },
);

/**
 * Retention principle: anonymise members whose last visit (or creation, if
 * they never earned) is older than the configured window. 0 disables it.
 * Returns how many members were anonymised.
 */
export function purgeInactiveMembers(): number {
  const { retentionMonths } = getLoyaltySettings();
  if (!retentionMonths) return 0;
  const stale = db
    .prepare(
      `SELECT id FROM customers
       WHERE phone NOT LIKE 'deleted-%'
       AND COALESCE(last_visit_at, created_at) < datetime('now', ?)`,
    )
    .all(`-${retentionMonths} months`) as { id: number }[];
  for (const row of stale) anonymiseCustomer(row.id, null, 'retention');
  return stale.length;
}

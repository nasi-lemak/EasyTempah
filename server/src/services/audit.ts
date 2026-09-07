import { db } from '../db/connection';

export function audit(userId: number | null, action: string, detail?: unknown): void {
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)').run(
    userId,
    action,
    detail === undefined ? null : JSON.stringify(detail),
  );
}

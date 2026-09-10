import { Router } from 'express';
import { db } from '../db/connection';
import {
  AuthedRequest,
  createSession,
  destroySession,
  requireAuth,
  verifyPin,
} from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { audit } from '../services/audit';
import type { User } from '../types';

export const authRouter = Router();

// Brute-force protection: a 4-digit PIN space is small, so failed attempts are
// throttled per source IP — 5 misses inside 10 minutes locks that IP for 5 minutes.
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;
const failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failures) {
    if (entry.lockedUntil < now && now - entry.firstAt > FAIL_WINDOW_MS) failures.delete(ip);
  }
}, 60_000).unref();

/**
 * Shared PIN check with per-IP lockout. Returns the matched user, or null
 * after writing the 429/401 response itself.
 */
function pinToUser(req: { ip?: string; body: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }): User | null {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.lockedUntil > now) {
    const wait = Math.ceil((entry.lockedUntil - now) / 1000);
    res.status(429).json({ error: `Too many failed attempts — try again in ${wait}s` });
    return null;
  }
  const { pin } = req.body as { pin?: string };
  if (!pin || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    throw badRequest('PIN must be 4-8 digits');
  }
  const users = db.prepare('SELECT * FROM users WHERE active = 1').all() as User[];
  const user = users.find((u) => verifyPin(pin, u.pin_hash));
  if (!user) {
    const cur =
      entry && now - entry.firstAt <= FAIL_WINDOW_MS
        ? { ...entry, count: entry.count + 1 }
        : { count: 1, firstAt: now, lockedUntil: 0 };
    if (cur.count >= MAX_FAILS) {
      cur.lockedUntil = now + LOCKOUT_MS;
      cur.count = 0;
      cur.firstAt = now;
      audit(null, 'auth.lockout', { ip });
    }
    failures.set(ip, cur);
    res.status(401).json({ error: 'Invalid PIN' });
    return null;
  }
  failures.delete(ip);
  return user;
}

authRouter.post('/login', (req, res) => {
  const user = pinToUser(req, res);
  if (!user) return;
  const token = createSession(user.id);
  audit(user.id, 'auth.login');
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

/**
 * Time clock: the PIN identifies the person and toggles their open entry —
 * no session is created, so anyone can clock in/out from the login screen.
 */
authRouter.post('/clock', (req, res) => {
  const user = pinToUser(req, res);
  if (!user) return;
  const open = db
    .prepare('SELECT id, clock_in FROM time_clock WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1')
    .get(user.id) as { id: number; clock_in: string } | undefined;
  if (open) {
    db.prepare("UPDATE time_clock SET clock_out = datetime('now') WHERE id = ?").run(open.id);
    audit(user.id, 'clock.out');
    res.json({ name: user.name, action: 'out', since: open.clock_in });
  } else {
    db.prepare('INSERT INTO time_clock (user_id) VALUES (?)').run(user.id);
    audit(user.id, 'clock.in');
    res.json({ name: user.name, action: 'in' });
  }
});

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) destroySession(header.slice(7));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

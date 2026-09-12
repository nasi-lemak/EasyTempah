import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/connection';
import type { Role, User } from '../types';

const FALLBACK_SESSION_HOURS = 12;

/** Session lifetime follows Settings → Terminals (a 24h venue outlives a mall unit's day). */
function sessionTtlMs(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'terminals'").get() as
      | { value: string }
      | undefined;
    const hours = row ? (JSON.parse(row.value) as { sessionHours?: number }).sessionHours : undefined;
    if (Number.isInteger(hours) && (hours as number) >= 1 && (hours as number) <= 48) {
      return (hours as number) * 60 * 60 * 1000;
    }
  } catch {
    /* fall through to the default */
  }
  return FALLBACK_SESSION_HOURS * 60 * 60 * 1000;
}

const ROLE_RANK: Record<Role, number> = { kitchen: 1, cashier: 2, manager: 3, admin: 4 };

export interface AuthedRequest extends Request {
  user?: Pick<User, 'id' | 'name' | 'role'>;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pin, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + sessionTtlMs(),
  );
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userForToken(token: string): Pick<User, 'id' | 'name' | 'role'> | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.role, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1`,
    )
    .get(token) as { id: number; name: string; role: Role; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return { id: row.id, name: row.name, role: row.role };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // SSE (EventSource) cannot set headers; allow token via query string there.
  if (typeof req.query.token === 'string') return req.query.token;
  return null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = token ? userForToken(token) : null;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(minRole: Role) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Periodically purge expired sessions.
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000).unref();

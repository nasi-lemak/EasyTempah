import { Router } from 'express';
import { db } from '../db/connection';
import { AuthedRequest, hashPin, requireAuth, requireRole } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errors';
import { audit } from '../services/audit';
import type { Role, User } from '../types';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

const ROLES: Role[] = ['admin', 'manager', 'cashier', 'kitchen'];

usersRouter.get('/', (_req, res) => {
  const users = db
    .prepare('SELECT id, name, role, active, created_at FROM users ORDER BY name')
    .all();
  res.json({ users });
});

usersRouter.post('/', (req: AuthedRequest, res) => {
  const { name, role, pin } = req.body as { name?: string; role?: Role; pin?: string };
  if (!name?.trim()) throw badRequest('Name required');
  if (!role || !ROLES.includes(role)) throw badRequest('Invalid role');
  if (!pin || !/^\d{4,8}$/.test(pin)) throw badRequest('PIN must be 4-8 digits');
  const info = db
    .prepare('INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)')
    .run(name.trim(), role, hashPin(pin));
  audit(req.user!.id, 'user.create', { name: name.trim(), role });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

usersRouter.patch('/:id', (req: AuthedRequest, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as User | undefined;
  if (!user) throw notFound('User not found');
  const { name, role, pin, active } = req.body as {
    name?: string;
    role?: Role;
    pin?: string;
    active?: boolean;
  };
  if (role && !ROLES.includes(role)) throw badRequest('Invalid role');
  if (pin && !/^\d{4,8}$/.test(pin)) throw badRequest('PIN must be 4-8 digits');
  if (user.id === req.user!.id && active === false) throw badRequest('You cannot deactivate yourself');
  db.prepare('UPDATE users SET name = ?, role = ?, pin_hash = ?, active = ? WHERE id = ?').run(
    name?.trim() || user.name,
    role ?? user.role,
    pin ? hashPin(pin) : user.pin_hash,
    active !== undefined ? (active ? 1 : 0) : user.active,
    user.id,
  );
  // A changed PIN (the fix when one leaks) or deactivation ends every live
  // session for that user immediately — the new PIN is the only way back in.
  if (pin || active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(req.user!.id, 'user.update', { userId: user.id });
  res.json({ ok: true });
});

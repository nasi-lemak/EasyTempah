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

authRouter.post('/login', (req, res) => {
  const { pin } = req.body as { pin?: string };
  if (!pin || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    throw badRequest('PIN must be 4-8 digits');
  }
  const users = db.prepare('SELECT * FROM users WHERE active = 1').all() as User[];
  const user = users.find((u) => verifyPin(pin, u.pin_hash));
  if (!user) {
    res.status(401).json({ error: 'Invalid PIN' });
    return;
  }
  const token = createSession(user.id);
  audit(user.id, 'auth.login');
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) destroySession(header.slice(7));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

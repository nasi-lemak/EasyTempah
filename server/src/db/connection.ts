import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { applySchema } from './schema';

const DATA_DIR = process.env.EASYTEMPAH_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.EASYTEMPAH_DB_PATH || path.join(DATA_DIR, 'easytempah.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

applySchema(db);

// Every table gets a QR ordering token; backfill any that predate migration v4.
{
  const missing = db.prepare('SELECT id FROM dining_tables WHERE qr_token IS NULL').all() as { id: number }[];
  const set = db.prepare('UPDATE dining_tables SET qr_token = ? WHERE id = ?');
  for (const row of missing) set.run(crypto.randomBytes(12).toString('hex'), row.id);
}

export function newQrToken(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

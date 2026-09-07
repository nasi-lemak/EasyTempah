import Database from 'better-sqlite3';
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

export function nowIso(): string {
  return new Date().toISOString();
}

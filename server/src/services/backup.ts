/**
 * Automated SQLite backups: a consistent snapshot (better-sqlite3's online
 * backup API, safe under WAL with live writers) into data/backups/, taken at
 * startup and daily thereafter, keeping the most recent copies.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection';

const BACKUP_DIR = process.env.EASYTEMPAH_BACKUP_DIR || path.join(__dirname, '..', '..', 'data', 'backups');
const KEEP = 14;
const DAILY_MS = 24 * 60 * 60 * 1000;

function stamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
}

export async function backupNow(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `easytempah-${stamp()}.db`);
  await db.backup(file);
  prune();
  return file;
}

function prune(): void {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('easytempah-') && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const stale of files.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, stale));
  }
}

export function listBackups(): { file: string; size: number; mtime: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('easytempah-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: st.size, mtime: st.mtime.toISOString() };
    });
}

export function scheduleBackups(): void {
  const run = () =>
    backupNow()
      .then((file) => console.log(`Backup written: ${file}`))
      .catch((err) => console.error('Backup failed:', err instanceof Error ? err.message : err));
  // First snapshot shortly after boot, then daily.
  setTimeout(run, 30_000).unref();
  setInterval(run, DAILY_MS).unref();
}

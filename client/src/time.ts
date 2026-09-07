/** SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"; ISO strings pass through. */
export function parseServerDate(value: string): Date {
  if (value.includes('T')) return new Date(value);
  return new Date(value.replace(' ', 'T') + 'Z');
}

export function minutesSince(value: string | null): number {
  if (!value) return 0;
  return Math.floor((Date.now() - parseServerDate(value).getTime()) / 60000);
}

export function formatDateTime(value: string | null): string {
  if (!value) return '';
  return parseServerDate(value).toLocaleString();
}

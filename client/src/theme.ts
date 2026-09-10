/**
 * Per-device theme preference (dark / light / follow system) and the
 * business-wide brand accent color.
 *
 * The resolved theme is stamped on <html data-theme="...">; the accent trio
 * (--accent, --accent-dark, --accent-text) is set inline from the admin's
 * chosen brand color so it wins in both themes.
 */

export type ThemePref = 'dark' | 'light' | 'system';

const KEY = 'easytempah.theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'system' || v === 'dark') return v;
  } catch {
    /* per-device convenience only */
  }
  return 'dark'; // the app's native look
}

function resolve(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') return media.matches ? 'light' : 'dark';
  return pref;
}

export function applyThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = resolve(pref);
}

/** Call once at startup: applies the stored choice and tracks OS changes. */
export function initTheme(): void {
  document.documentElement.dataset.theme = resolve(getThemePref());
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') {
      document.documentElement.dataset.theme = resolve('system');
    }
  });
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Brand accent from Settings; derives hover shade and readable button text. */
export function applyAccent(hex: string | undefined | null): void {
  const root = document.documentElement.style;
  if (!hex || !HEX_RE.test(hex)) {
    root.removeProperty('--accent');
    root.removeProperty('--accent-dark');
    root.removeProperty('--accent-text');
    return;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const shade = (v: number) => Math.round(v * 0.72);
  const dark = `#${[r, g, b].map((v) => shade(v).toString(16).padStart(2, '0')).join('')}`;
  // Relative-luminance pick for text on accent-filled buttons.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const text = lum > 0.45 ? '#0c1f18' : '#ffffff';
  root.setProperty('--accent', hex);
  root.setProperty('--accent-dark', dark);
  root.setProperty('--accent-text', text);
}

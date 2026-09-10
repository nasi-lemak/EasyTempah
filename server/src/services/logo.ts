/**
 * Receipt logo handling: a small PNG uploaded in Settings, stored as a data
 * URL, rendered on the HTML receipt as-is and converted here to a packed
 * 1-bit raster for ESC/POS printing (GS v 0).
 */
import { PNG } from 'pngjs';
import type { ReceiptLogo } from './escpos';

export const MAX_LOGO_BYTES = 200 * 1024; // decoded PNG file size
const MAX_PRINT_WIDTH = 384; // dots; safe on both 58/80mm heads, centered by the printer

export function parseLogoDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) throw new Error('Logo must be a PNG data URL');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) {
    throw new Error(`Logo PNG must be 1 byte – ${MAX_LOGO_BYTES / 1024} KB`);
  }
  return buf;
}

/**
 * PNG → monochrome ESC/POS raster. Downscales (nearest-neighbour) to the
 * printable width, treats transparency as white, thresholds on luminance.
 */
export function pngToRaster(png: Buffer): ReceiptLogo {
  const img = PNG.sync.read(png);
  const scale = img.width > MAX_PRINT_WIDTH ? MAX_PRINT_WIDTH / img.width : 1;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const bytesPerRow = Math.ceil(w / 8);
  const rows = Buffer.alloc(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const idx = (img.width * sy + sx) * 4;
      const alpha = img.data[idx + 3] / 255;
      // Composite onto white, then luminance threshold.
      const lum =
        (0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2]) * alpha +
        255 * (1 - alpha);
      if (lum < 128) rows[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, height: h, rows };
}

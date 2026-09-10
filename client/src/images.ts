/**
 * Client-side photo preparation: center-crop to a square, downscale to 512px,
 * encode WebP where the browser can (all Chromium terminals), JPEG otherwise
 * (e.g. Safari). Originals never leave the device — a 4 MB tablet photo
 * becomes a ~40 KB upload.
 */
const SIZE = 512;

export async function prepareItemPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Could not read that image file');
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();

  // toDataURL falls back to PNG when the requested type is unsupported —
  // detect that and step down to JPEG (universally encodable).
  const webp = canvas.toDataURL('image/webp', 0.82);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Cache-busted URL for an item's photo, or null when it has none. */
export function itemImageUrl(id: number, imageV: string | number | null | undefined): string | null {
  return imageV ? `/api/menu/images/${id}?v=${imageV}` : null;
}

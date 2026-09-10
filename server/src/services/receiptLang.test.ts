import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { makeLabels } from './receiptLang';
import { COLS, displayWidth, EscPos } from './escpos';
import { PNG } from 'pngjs';
import { parseLogoDataUrl, pngToRaster } from './logo';

describe('makeLabels', () => {
  it('single language returns plain labels', () => {
    expect(makeLabels('en').subtotal).toBe('Subtotal');
    expect(makeLabels('zh').subtotal).toBe('小计');
    expect(makeLabels('ms').total).toBe('JUMLAH');
  });

  it('bilingual labels join primary / secondary', () => {
    const L = makeLabels('zh', 'en');
    expect(L.subtotal).toBe('小计 / Subtotal');
    expect(L.total).toBe('总计 / TOTAL');
    expect(L.table).toBe('桌号 / Table');
  });

  it('secondary equal to primary collapses to one language', () => {
    expect(makeLabels('en', 'en').subtotal).toBe('Subtotal');
  });
});

describe('EscPos GBK charset', () => {
  it('emits FS & on init and GBK bytes for CJK text', () => {
    const buf = new EscPos('gbk').init().line('小计').build();
    expect(buf.indexOf(Buffer.from([0x1c, 0x26]))).toBeGreaterThanOrEqual(0);
    expect(buf.indexOf(iconv.encode('小计', 'gbk'))).toBeGreaterThanOrEqual(0);
  });

  it('cols() keeps 42 display columns with double-width CJK', () => {
    const buf = new EscPos('gbk').cols('小计 / Subtotal', 'RM 16.60').build();
    const text = iconv.decode(buf, 'gbk').trimEnd();
    expect(displayWidth(text)).toBe(COLS);
    expect(text.endsWith('RM 16.60')).toBe(true);
  });

  it('ascii charset still degrades CJK to ?', () => {
    const buf = new EscPos('ascii').line('小计').build();
    expect(buf.toString('ascii')).toBe('??\n');
  });
});

describe('logo raster', () => {
  function pngDataUrl(width: number, height: number, black: (x: number, y: number) => boolean): string {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (width * y + x) * 4;
        const v = black(x, y) ? 0 : 255;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
        png.data[i + 3] = 255;
      }
    }
    return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
  }

  it('converts a PNG to packed 1-bit rows (1 = black)', () => {
    const logo = pngToRaster(parseLogoDataUrl(pngDataUrl(16, 2, (x, y) => y === 0 && x < 8)));
    expect(logo.bytesPerRow).toBe(2);
    expect(logo.height).toBe(2);
    expect([...logo.rows]).toEqual([0xff, 0x00, 0x00, 0x00]); // top-left 8 px black
  });

  it('downscales wide images to the printable width', () => {
    const logo = pngToRaster(parseLogoDataUrl(pngDataUrl(768, 4, () => true)));
    expect(logo.bytesPerRow).toBe(384 / 8);
    expect(logo.height).toBe(2);
  });

  it('rejects non-PNG data URLs', () => {
    expect(() => parseLogoDataUrl('data:image/jpeg;base64,AAAA')).toThrow();
  });
});

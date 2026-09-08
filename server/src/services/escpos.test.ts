import { describe, expect, it } from 'vitest';
import { COLS, EscPos, renderKitchenTicket } from './escpos';

describe('EscPos builder', () => {
  it('starts documents with ESC @ init', () => {
    const buf = new EscPos().init().build();
    expect([...buf.slice(0, 2)]).toEqual([0x1b, 0x40]);
  });

  it('ends a cut document with GS V', () => {
    const buf = new EscPos().init().line('x').cut().build();
    const tail = [...buf.slice(-4)];
    expect(tail).toEqual([0x1d, 0x56, 66, 3]);
  });

  it('lays out two columns to exactly 42 chars', () => {
    const buf = new EscPos().cols('Nasi Lemak', 'RM 10.00').build();
    const text = buf.toString('ascii').replace(/\n$/, '');
    expect(text.length).toBe(COLS);
    expect(text.startsWith('Nasi Lemak')).toBe(true);
    expect(text.endsWith('RM 10.00')).toBe(true);
  });

  it('wraps long left column without disturbing the right value', () => {
    const long = 'Nasi Lemak Ayam Berempah Special Extra Large Portion';
    const buf = new EscPos().cols(long, 'RM 99.00').build();
    const lines = buf.toString('ascii').trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].endsWith('RM 99.00')).toBe(true);
    expect(lines[0].length).toBe(COLS);
  });

  it('replaces non-ASCII with ? instead of sending mojibake bytes', () => {
    const buf = new EscPos().line('Café — teh').build();
    const text = buf.toString('ascii');
    expect(text).toBe('Caf? ? teh\n');
  });

  it('drawer kick emits ESC p', () => {
    const buf = new EscPos().drawerKick().build();
    expect([...buf.slice(0, 3)]).toEqual([0x1b, 0x70, 0]);
  });
});

describe('renderKitchenTicket', () => {
  it('includes station, order and line content', () => {
    const buf = renderKitchenTicket({
      station: 'kitchen',
      order_no: '20260908-0007',
      where: 'Table T3',
      order_notes: 'birthday table',
      lines: [
        { qty: 2, name: 'Mee Goreng Mamak', modifiers: ['Extra Pedas'], notes: 'no egg', source: 'guest' },
      ],
    });
    const text = buf.toString('ascii');
    expect(text).toContain('Table T3');
    expect(text).toContain('[KITCHEN]');
    expect(text).toContain('2 x Mee Goreng Mamak [QR]');
    expect(text).toContain('+ Extra Pedas');
    expect(text).toContain('>> no egg');
    expect(text).toContain('>> birthday table');
    expect([...buf.slice(-4)]).toEqual([0x1d, 0x56, 66, 3]);
  });
});

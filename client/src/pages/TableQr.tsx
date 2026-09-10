import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ConfirmDialog } from '../components/Dialogs';
import { useStore } from '../store';
import type { DiningTable } from '../types';

export default function TableQr() {
  const business = useStore((s) => s.business);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ tables: DiningTable[] }>('/api/tables').then((r) => setTables(r.tables)).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<number, string> = {};
      for (const t of tables) {
        if (!t.qr_token) continue;
        next[t.id] = await QRCode.toDataURL(`${window.location.origin}/order/${t.qr_token}`, {
          width: 220,
          margin: 1,
          color: { dark: '#0f1419', light: '#ffffff' },
        });
      }
      if (!cancelled) setCodes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tables]);

  const [rotateFor, setRotateFor] = useState<DiningTable | null>(null);

  const rotate = async (t: DiningTable) => {
    setRotateFor(null);
    setError('');
    try {
      await api.post(`/api/tables/${t.id}/qr-rotate`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <div>
      <div className="row mb no-print">
        <h1 className="grow">Table QR Codes</h1>
        <button className="primary" onClick={() => window.print()}>Print all</button>
      </div>
      <p className="muted small no-print">
        Guests scan a table's code to browse the menu and send orders straight to the kitchen —
        items land on that table's tab, and payment stays at the counter. “New code” invalidates
        the printed one (e.g. if a code leaks or a card walks off).
      </p>
      {error && <div className="error-text mb no-print">{error}</div>}
      {rotateFor && (
        <ConfirmDialog
          title={`New code for ${rotateFor.name}?`}
          message="The code printed on the table stops working the moment you generate a new one — reprint and replace it."
          confirmLabel="Generate new code"
          danger
          onConfirm={() => rotate(rotateFor)}
          onClose={() => setRotateFor(null)}
        />
      )}

      <div className="qr-sheet">
        {tables.map((t) => (
          <div key={t.id} className="qr-card">
            <div className="qr-biz">{business?.name ?? 'EasyTempah'}</div>
            <div className="qr-table">{t.name}</div>
            <div className="qr-zone">{t.zone}</div>
            {codes[t.id] ? <img src={codes[t.id]} alt={`QR code for table ${t.name}`} /> : <div className="muted small">…</div>}
            <div className="qr-hint">Scan to order</div>
            <button className="no-print small" onClick={() => setRotateFor(t)}>New code</button>
          </div>
        ))}
      </div>
    </div>
  );
}

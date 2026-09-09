import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { KdsLine, KdsTicket, Station } from '../types';
import { minutesSince } from '../time';
import { useEvents } from '../useEvents';

const NEXT_LABEL: Record<string, string> = {
  sent: 'Start',
  preparing: 'Ready',
  ready: 'Serve',
};

interface RecentLine extends KdsLine {
  order_no: string;
  table_name: string | null;
}

export default function Kds() {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [station, setStation] = useState<Station | 'all'>('all');
  const [showRecall, setShowRecall] = useState(false);
  const [recent, setRecent] = useState<RecentLine[]>([]);
  const [, forceTick] = useState(0);

  const load = useCallback(() => {
    const q = station === 'all' ? '' : `?station=${station}`;
    api.get<{ tickets: KdsTicket[] }>(`/api/kds/tickets${q}`).then((r) => setTickets(r.tickets)).catch(() => {});
    api.get<{ lines: RecentLine[] }>('/api/kds/recent').then((r) => setRecent(r.lines)).catch(() => {});
  }, [station]);
  useEffect(load, [load]);
  useEvents(['kds'], load);

  const unbump = (lineId: number) => api.post(`/api/kds/lines/${lineId}/unbump`).then(load).catch(() => {});

  // Re-render every 30s so ticket ages stay fresh.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const bumpLine = (lineId: number) => api.post(`/api/kds/lines/${lineId}/bump`).then(load).catch(() => {});
  const bumpTicket = (orderId: number) => api.post(`/api/kds/tickets/${orderId}/bump`).then(load).catch(() => {});

  const ageMinutes = minutesSince;

  return (
    <div>
      <div className="row mb">
        <h1 className="grow">Kitchen Display</h1>
        {(['all', 'kitchen', 'bar'] as const).map((s) => (
          <button key={s} className={station === s ? 'primary' : ''} onClick={() => setStation(s)}>
            {s === 'all' ? 'All stations' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
        <button className={showRecall ? 'primary' : ''} onClick={() => setShowRecall(!showRecall)}>
          Recall{recent.length > 0 ? ` (${recent.length})` : ''}
        </button>
      </div>

      {showRecall && (
        <div className="panel mb">
          <h2>Recently served — recall to bring a ticket back</h2>
          {recent.length === 0 && <div className="muted">Nothing served recently on open orders.</div>}
          {recent.map((line) => (
            <div key={line.id} className="row" style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
              <span className="grow">
                <strong>{line.qty}×</strong> {line.name}
                <span className="muted small"> · {line.table_name ? `Table ${line.table_name}` : line.type.replace('_', ' ')} · #{line.order_no.slice(-4)}</span>
              </span>
              <button onClick={() => unbump(line.id)}>Recall → ready</button>
            </div>
          ))}
        </div>
      )}

      {tickets.length === 0 && <div className="muted">No open tickets. 🎉</div>}

      <div className="kds-grid">
        {tickets.map((t) => {
          const mins = ageMinutes(t.sent_at);
          const ageClass = mins >= 15 ? 'late' : mins >= 8 ? 'warn' : '';
          return (
            <div key={t.order_id} className="kds-ticket">
              <div className="head">
                <strong>
                  {t.table_name ? `Table ${t.table_name}` : t.type.replace('_', ' ')} · #{t.order_no.slice(-4)}
                </strong>
                <span className={`age ${ageClass}`}>{mins}m</span>
              </div>
              {t.order_notes && <div className="kds-line note">» {t.order_notes}</div>}
              {t.lines.map((line) => {
                const mods = (JSON.parse(line.modifiers_json) as { name: string }[]).map((m) => m.name);
                return (
                  <div key={line.id} className="kds-line">
                    <span className="qty">{line.qty}×</span>
                    <span className="grow">
                      <div>
                        {line.source === 'guest' && <span title="Ordered by guest via QR">📱 </span>}
                        {line.name} <span className={`badge ${line.status}`}>{line.status}</span>
                      </div>
                      {mods.length > 0 && <div className="mods">{mods.join(', ')}</div>}
                      {line.notes && <div className="note">» {line.notes}</div>}
                    </span>
                    <button onClick={() => bumpLine(line.id)}>{NEXT_LABEL[line.status] ?? '✓'}</button>
                  </div>
                );
              })}
              <div style={{ padding: '0.6rem 0.8rem' }}>
                <button className="primary" style={{ width: '100%' }} onClick={() => bumpTicket(t.order_id)}>
                  Bump all
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

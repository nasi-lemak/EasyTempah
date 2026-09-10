import { useEffect, useRef, useState } from 'react';

interface BoardOrder {
  id: number;
  queue: number | null;
  platform: string | null;
  platform_ref: string | null;
  pager_no: number | null;
  state: 'preparing' | 'ready';
}

/** Two-tone chime when an order flips to Ready — the board's "pager ring". */
function chime() {
  try {
    const ctx = new AudioContext();
    for (const [freq, at] of [[880, 0], [1175, 0.18]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.4);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.45);
    }
  } catch {
    /* no audio on this device */
  }
}

const MUTE_KEY = 'easytempah.board.muted';

/**
 * Public collection board — meant for a TV or spare tablet at the counter.
 * Customers and delivery drivers watch their number move from Preparing to
 * Ready; staff never touch this screen (KDS "Serve" clears entries).
 */
export default function Board() {
  const [business, setBusiness] = useState('');
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [stale, setStale] = useState(false);
  const readyIds = useRef<Set<number> | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/board');
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as { business: string; orders: BoardOrder[] };
        if (stop) return;
        setBusiness(d.business);
        setOrders(d.orders);
        setStale(false);
        const nowReady = new Set(d.orders.filter((o) => o.state === 'ready').map((o) => o.id));
        // Chime only for genuinely new ready orders, never on the first load.
        if (readyIds.current && !mutedRef.current) {
          for (const id of nowReady) {
            if (!readyIds.current.has(id)) {
              chime();
              break;
            }
          }
        }
        readyIds.current = nowReady;
      } catch {
        if (!stop) setStale(true);
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      /* per-device convenience */
    }
  };

  const label = (o: BoardOrder) => {
    if (o.platform) return `${o.platform}${o.platform_ref ? ` · ${o.platform_ref}` : ''}`;
    if (o.pager_no != null) return `📟 ${o.pager_no}`;
    return o.queue != null ? String(o.queue) : '—';
  };

  const preparing = orders.filter((o) => o.state === 'preparing');
  const ready = orders.filter((o) => o.state === 'ready');

  return (
    <div className="board">
      <header className="board-head">
        <h1>{business || 'Collection'}</h1>
        <div className="row" style={{ gap: '0.6rem' }}>
          {stale && <span className="badge cancelled">offline — retrying</span>}
          <button className="ghost small" onClick={toggleMute} aria-label={muted ? 'Unmute chime' : 'Mute chime'}>
            {muted ? '🔇' : '🔔'}
          </button>
        </div>
      </header>
      <div className="board-cols">
        <section>
          <h2>Preparing 🍳</h2>
          <div className="board-nums">
            {preparing.map((o) => (
              <div key={o.id} className="board-num">{label(o)}</div>
            ))}
            {preparing.length === 0 && <div className="muted">—</div>}
          </div>
        </section>
        <section className="ready-col">
          <h2>Ready — please collect ✅</h2>
          <div className="board-nums">
            {ready.map((o) => (
              <div key={o.id} className="board-num ready">{label(o)}</div>
            ))}
            {ready.length === 0 && <div className="muted">—</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

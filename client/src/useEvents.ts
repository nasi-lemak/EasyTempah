import { useEffect, useRef } from 'react';
import { useStore } from './store';

type Channel = 'orders' | 'tables' | 'kds' | 'menu' | 'shifts' | 'inventory' | 'reservations';

/**
 * Subscribe to server-sent events; invokes the callback when any of the given
 * channels fires. The callback ref is kept fresh so callers can pass inline
 * closures without re-opening the stream.
 */
export function useEvents(channels: Channel[], onEvent: () => void): void {
  const token = useStore((s) => s.token);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const key = channels.join(',');

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    const handler = () => cbRef.current();
    for (const ch of key.split(',')) source.addEventListener(ch, handler);
    // Surface server reachability: EventSource retries on its own; when it
    // reconnects, refresh so the screen catches up on anything missed.
    source.onopen = () => {
      if (!useStore.getState().connected) {
        useStore.getState().setConnected(true);
        cbRef.current();
      }
    };
    source.onerror = () => useStore.getState().setConnected(false);
    return () => source.close();
  }, [token, key]);
}

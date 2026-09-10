import type { Response } from 'express';

export type Channel = 'orders' | 'tables' | 'kds' | 'menu' | 'shifts' | 'inventory' | 'reservations';

interface Client {
  id: number;
  res: Response;
}

let nextId = 1;
const clients = new Map<number, Client>();

export function addClient(res: Response): () => void {
  const id = nextId++;
  clients.set(id, { id, res });
  return () => clients.delete(id);
}

export function publish(channel: Channel, payload: Record<string, unknown> = {}): void {
  const data = JSON.stringify({ channel, ...payload, at: Date.now() });
  for (const client of clients.values()) {
    client.res.write(`event: ${channel}\ndata: ${data}\n\n`);
  }
}

// Keep proxies from closing idle SSE connections.
setInterval(() => {
  for (const client of clients.values()) {
    client.res.write(': ping\n\n');
  }
}, 25_000).unref();

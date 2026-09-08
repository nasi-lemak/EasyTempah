/**
 * Payment gateway layer: payment intents at the till + webhook auto-confirmation.
 *
 * Flow: cashier picks a wallet → an intent is created for the order's balance →
 * the till shows a QR and waits → the gateway POSTs a webhook → the event is
 * matched to an intent (exactly by intent id for dynamic QRs, or by amount
 * within a time window for a static counter QR) → the payment is recorded and
 * the till updates over SSE. Manual confirmation stays available as fallback.
 *
 * Providers:
 *  - mock:    simulator — dynamic QRs embed the intent id; a simulate call
 *             signs and processes a webhook exactly like a real gateway would.
 *  - generic: any gateway that can POST {amount_cents, reference, intent_id?}
 *             signed with HMAC-SHA256 (hex) of the raw body in the
 *             X-Signature header.
 */
import crypto from 'crypto';
import { db } from '../db/connection';
import { badRequest, conflict, notFound } from '../middleware/errors';
import { publish } from '../realtime/bus';
import type { GatewaySettings, Order, PaymentIntent } from '../types';
import { audit } from './audit';
import { addPayment, getOrder } from './orders';
import { getGatewaySettings, getPaymentsSettings } from './settings';

const INTENT_TTL_MS = 3 * 60 * 1000;
/** Static-QR matching window: how old a pending intent may be to claim an amount-only event. */
const STATIC_MATCH_WINDOW_MS = INTENT_TTL_MS;

export function verifySignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted);
}

function requireGateway(): GatewaySettings {
  const gw = getGatewaySettings();
  if (!gw.enabled) throw conflict('Payment gateway is not enabled in Settings');
  if (!gw.webhookSecret) throw conflict('Gateway webhook secret is not configured');
  return gw;
}

function expireStale(): void {
  db.prepare(
    `UPDATE payment_intents SET status = 'expired', updated_at = datetime('now')
     WHERE status = 'pending' AND expires_at < ?`,
  ).run(Date.now());
}

export function getIntent(id: number): PaymentIntent {
  expireStale();
  const row = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id) as
    | PaymentIntent
    | undefined;
  if (!row) throw notFound('Payment intent not found');
  return row;
}

export function createIntent(orderId: number, channelKey: string, userId: number): PaymentIntent {
  const gw = requireGateway();
  expireStale();

  const channel = getPaymentsSettings().channels.find((c) => c.key === channelKey && c.enabled);
  if (!channel) throw badRequest('Unknown or disabled payment channel');
  if (channel.kind === 'cash') throw badRequest('Cash does not go through the gateway');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order | undefined;
  if (!order) throw notFound('Order not found');
  if (order.status !== 'open') throw conflict(`Order is ${order.status}`);
  const balance = order.total_cents - order.paid_cents;
  if (balance <= 0) throw conflict('Order has no balance');

  // One live intent per order at a time keeps static matching unambiguous per lane.
  db.prepare(
    `UPDATE payment_intents SET status = 'cancelled', updated_at = datetime('now')
     WHERE order_id = ? AND status = 'pending'`,
  ).run(orderId);

  const info = db
    .prepare(
      `INSERT INTO payment_intents (order_id, channel_key, channel_label, kind, amount_cents, provider, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(orderId, channel.key, channel.label, channel.kind, balance, gw.provider, userId, Date.now() + INTENT_TTL_MS);
  const id = Number(info.lastInsertRowid);

  // Dynamic QRs embed the intent so the webhook can name it exactly. A real
  // gateway adapter would call its create-transaction API here instead.
  if (gw.dynamicQr) {
    const payload = `EASYTEMPAH|INTENT:${id}|AMT:${(balance / 100).toFixed(2)}|${crypto
      .randomBytes(6)
      .toString('hex')}`;
    db.prepare('UPDATE payment_intents SET qr_payload = ? WHERE id = ?').run(payload, id);
  }

  publish('orders');
  return getIntent(id);
}

export function cancelIntent(id: number): PaymentIntent {
  const intent = getIntent(id);
  if (intent.status === 'pending') {
    db.prepare(
      `UPDATE payment_intents SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
    ).run(id);
  }
  return getIntent(id);
}

export interface WebhookEvent {
  amount_cents: number;
  reference: string;
  intent_id?: number;
}

export function parseWebhookBody(rawBody: Buffer): WebhookEvent {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw badRequest('Webhook body must be JSON');
  }
  const amount =
    typeof parsed.amount_cents === 'number'
      ? Math.round(parsed.amount_cents)
      : typeof parsed.amount === 'number'
        ? Math.round(parsed.amount * 100)
        : NaN;
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Webhook missing a valid amount');
  const reference = typeof parsed.reference === 'string' && parsed.reference ? parsed.reference : `wh-${Date.now()}`;
  const intentId = Number(parsed.intent_id);
  return {
    amount_cents: amount,
    reference,
    intent_id: Number.isInteger(intentId) && intentId > 0 ? intentId : undefined,
  };
}

function recordEvent(provider: string, rawBody: Buffer, matched: number | null, outcome: string): void {
  db.prepare(
    'INSERT INTO webhook_events (provider, payload, matched_intent_id, outcome) VALUES (?, ?, ?, ?)',
  ).run(provider, rawBody.toString('utf8').slice(0, 4000), matched, outcome);
}

/**
 * Match a verified webhook event to a pending intent and record the payment.
 * Returns the outcome; never throws for match failures (gateways retry on 5xx).
 */
export function processWebhook(
  provider: string,
  rawBody: Buffer,
  event: WebhookEvent,
): { outcome: string; intent_id: number | null } {
  expireStale();

  // Replay guard: a reference we've already consumed is ignored.
  const seen = db
    .prepare("SELECT 1 FROM payments WHERE reference = ? LIMIT 1")
    .get(event.reference);
  if (seen) {
    recordEvent(provider, rawBody, null, 'duplicate_reference');
    return { outcome: 'duplicate_reference', intent_id: null };
  }

  let intent: PaymentIntent | undefined;
  if (event.intent_id) {
    intent = db
      .prepare("SELECT * FROM payment_intents WHERE id = ? AND status = 'pending'")
      .get(event.intent_id) as PaymentIntent | undefined;
    if (intent && intent.amount_cents !== event.amount_cents) {
      recordEvent(provider, rawBody, intent.id, 'amount_mismatch');
      return { outcome: 'amount_mismatch', intent_id: intent.id };
    }
  } else {
    // Static QR: amount + recency. Exactly one candidate or we refuse to guess.
    const cutoff = new Date(Date.now() - STATIC_MATCH_WINDOW_MS)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const candidates = db
      .prepare(
        `SELECT * FROM payment_intents
         WHERE status = 'pending' AND amount_cents = ? AND created_at >= ?
         ORDER BY id DESC`,
      )
      .all(event.amount_cents, cutoff) as PaymentIntent[];
    if (candidates.length > 1) {
      recordEvent(provider, rawBody, null, 'ambiguous');
      return { outcome: 'ambiguous', intent_id: null };
    }
    intent = candidates[0];
  }

  if (!intent) {
    recordEvent(provider, rawBody, null, 'unmatched');
    return { outcome: 'unmatched', intent_id: null };
  }

  try {
    const result = addPayment(
      intent.order_id,
      {
        method: intent.kind,
        channel: intent.channel_label,
        amount_cents: intent.amount_cents,
        reference: event.reference,
      },
      intent.created_by,
    );
    db.prepare(
      `UPDATE payment_intents SET status = 'confirmed', provider_ref = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(event.reference, intent.id);
    recordEvent(provider, rawBody, intent.id, 'confirmed');
    audit(intent.created_by, 'payment.webhook_confirmed', {
      intentId: intent.id,
      orderId: intent.order_id,
      reference: event.reference,
    });
    publish('orders');
    if (result.paid) publish('tables');
    return { outcome: 'confirmed', intent_id: intent.id };
  } catch (err) {
    recordEvent(provider, rawBody, intent.id, `payment_failed: ${err instanceof Error ? err.message : err}`);
    return { outcome: 'payment_failed', intent_id: intent.id };
  }
}

/** Mock provider only: simulate the gateway confirming an intent (demo/testing). */
export function simulateIntentPayment(id: number): { outcome: string } {
  const gw = requireGateway();
  if (gw.provider !== 'mock') throw conflict('Simulation is only available on the mock provider');
  const intent = getIntent(id);
  if (intent.status !== 'pending') throw conflict(`Intent is ${intent.status}`);
  // The simulator always names its intent — it stands in for the customer who
  // scanned THIS request, so it never suffers static-mode ambiguity.
  const body = Buffer.from(
    JSON.stringify({
      amount_cents: intent.amount_cents,
      reference: `MOCK-${Date.now()}-${intent.id}`,
      intent_id: intent.id,
    }),
  );
  return { outcome: processWebhook('mock', body, parseWebhookBody(body)).outcome };
}

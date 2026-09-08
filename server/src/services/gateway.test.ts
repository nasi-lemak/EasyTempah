import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhookBody, verifySignature } from './gateway';

const SECRET = 'test-secret';
const sign = (body: Buffer) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ amount_cents: 1000, reference: 'abc' }));

  it('accepts a correct HMAC over the raw body', () => {
    expect(verifySignature(SECRET, body, sign(body))).toBe(true);
  });

  it('rejects a wrong signature, missing signature, and empty secret', () => {
    expect(verifySignature(SECRET, body, sign(Buffer.from('tampered')))).toBe(false);
    expect(verifySignature(SECRET, body, undefined)).toBe(false);
    expect(verifySignature('', body, sign(body))).toBe(false);
  });

  it('rejects when the body was modified after signing', () => {
    const sig = sign(body);
    expect(verifySignature(SECRET, Buffer.from(body.toString() + ' '), sig)).toBe(false);
  });
});

describe('parseWebhookBody', () => {
  it('reads amount_cents and reference', () => {
    const e = parseWebhookBody(Buffer.from(JSON.stringify({ amount_cents: 2787, reference: 'TX1', intent_id: 7 })));
    expect(e).toEqual({ amount_cents: 2787, reference: 'TX1', intent_id: 7 });
  });

  it('accepts decimal amount as an alternative', () => {
    const e = parseWebhookBody(Buffer.from(JSON.stringify({ amount: 27.87, reference: 'TX2' })));
    expect(e.amount_cents).toBe(2787);
    expect(e.intent_id).toBeUndefined();
  });

  it('rejects garbage bodies and non-positive amounts', () => {
    expect(() => parseWebhookBody(Buffer.from('not json'))).toThrow();
    expect(() => parseWebhookBody(Buffer.from(JSON.stringify({ amount_cents: 0, reference: 'x' })))).toThrow();
    expect(() => parseWebhookBody(Buffer.from(JSON.stringify({ reference: 'x' })))).toThrow();
  });
});

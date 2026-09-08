import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import {
  cancelIntent,
  createIntent,
  getIntent,
  parseWebhookBody,
  processWebhook,
  simulateIntentPayment,
  verifySignature,
} from '../services/gateway';
import { getOrder } from '../services/orders';
import { getGatewaySettings } from '../services/settings';

/** Authenticated till-side endpoints for payment intents. */
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post('/intents', (req: AuthedRequest, res) => {
  const { order_id, channel_key } = req.body as { order_id?: number; channel_key?: string };
  if (!order_id || !channel_key) throw badRequest('order_id and channel_key required');
  const intent = createIntent(order_id, channel_key, req.user!.id);
  res.status(201).json({ intent });
});

paymentsRouter.get('/intents/:id', (req, res) => {
  const intent = getIntent(Number(req.params.id));
  // Include the order so the till can flip to "paid" state without another fetch.
  res.json({ intent, order: getOrder(intent.order_id) });
});

paymentsRouter.post('/intents/:id/cancel', (req, res) => {
  res.json({ intent: cancelIntent(Number(req.params.id)) });
});

paymentsRouter.post('/intents/:id/simulate', (req, res) => {
  const result = simulateIntentPayment(Number(req.params.id));
  const intent = getIntent(Number(req.params.id));
  res.json({ ...result, intent, order: getOrder(intent.order_id) });
});

/**
 * Public webhook endpoint for the gateway. Mounted with a raw body parser and
 * NO auth — authenticity comes from the HMAC-SHA256 signature over the raw
 * body (X-Signature header, hex).
 */
export const webhookRouter = Router();

webhookRouter.post('/:provider', (req, res) => {
  const gw = getGatewaySettings();
  if (!gw.enabled) {
    res.status(409).json({ error: 'Gateway disabled' });
    return;
  }
  if (req.params.provider !== gw.provider) {
    res.status(404).json({ error: 'Unknown provider' });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signature = req.header('x-signature') ?? undefined;
  if (!verifySignature(gw.webhookSecret, rawBody, signature)) {
    res.status(401).json({ error: 'Bad signature' });
    return;
  }
  const event = parseWebhookBody(rawBody);
  const result = processWebhook(gw.provider, rawBody, event);
  // 200 for anything we consciously decided (including unmatched) so gateways don't retry forever.
  res.json(result);
});

import express from 'express';
import fs from 'fs';
import path from 'path';
import './db/connection'; // opens DB + applies migrations
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import { addClient } from './realtime/bus';
import { authRouter } from './routes/auth';
import { einvoiceRouter } from './routes/einvoice';
import { guestRouter } from './routes/guest';
import { inventoryRouter } from './routes/inventory';
import { kdsRouter } from './routes/kds';
import { menuRouter } from './routes/menu';
import { ordersRouter } from './routes/orders';
import { paymentsRouter, webhookRouter } from './routes/payments';
import { printRouter } from './routes/print';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { shiftsRouter } from './routes/shifts';
import { tablesRouter } from './routes/tables';
import { usersRouter } from './routes/users';

const app = express();
// Webhooks need the raw body for HMAC verification — mount before the JSON parser.
app.use('/api/payment-webhooks', express.raw({ type: '*/*', limit: '256kb' }), webhookRouter);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'EasyTempah POS' }));

app.use('/api/auth', authRouter);
app.use('/api/guest', guestRouter); // public: QR table ordering, token-scoped
app.use('/api/menu', menuRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/kds', kdsRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/print', printRouter);
app.use('/api/einvoice', einvoiceRouter);
app.use('/api/payments', paymentsRouter);

// Server-Sent Events stream for realtime updates.
app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const remove = addClient(res);
  req.on('close', remove);
});

// Serve the built client in production.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`EasyTempah POS server listening on http://localhost:${PORT}`);
});

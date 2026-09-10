import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from './db/connection'; // opens DB + applies migrations
import { scheduleBackups } from './services/backup';
import { purgeInactiveMembers } from './services/customers';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import { addClient } from './realtime/bus';
import { authRouter } from './routes/auth';
import { boardRouter } from './routes/board';
import { customersRouter } from './routes/customers';
import { einvoiceRouter } from './routes/einvoice';
import { guestRouter } from './routes/guest';
import { inventoryRouter } from './routes/inventory';
import { kdsRouter } from './routes/kds';
import { menuRouter } from './routes/menu';
import { ordersRouter } from './routes/orders';
import { paymentsRouter, webhookRouter } from './routes/payments';
import { printRouter } from './routes/print';
import { promotionsRouter } from './routes/promotions';
import { reservationsRouter } from './routes/reservations';
import { reportsRouter } from './routes/reports';
import { settingsRouter } from './routes/settings';
import { shiftsRouter } from './routes/shifts';
import { tablesRouter } from './routes/tables';
import { usersRouter } from './routes/users';

const app = express();
app.disable('x-powered-by');
// Node's flat query parser instead of qs: every query string here is flat
// (?phone=, ?q=, ?from=&to=), and it removes the qs advisories' code path.
app.set('query parser', 'simple');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// Webhooks need the raw body for HMAC verification — mount before the JSON parser.
app.use('/api/payment-webhooks', express.raw({ type: '*/*', limit: '256kb' }), webhookRouter);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'EasyTempah POS' }));

app.use('/api/auth', authRouter);
app.use('/api/guest', guestRouter); // public: QR table ordering, token-scoped
app.use('/api/board', boardRouter); // public: collection board (queue numbers only)
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
app.use('/api/customers', customersRouter);
app.use('/api/promotions', promotionsRouter);
app.use('/api/reservations', reservationsRouter);

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

scheduleBackups();

// PDPA retention: anonymise long-inactive members on boot and daily after.
const runRetention = () => {
  try {
    const n = purgeInactiveMembers();
    if (n > 0) console.log(`Loyalty retention: anonymised ${n} inactive member(s)`);
  } catch (err) {
    console.error('Loyalty retention purge failed', err);
  }
};
runRetention();
setInterval(runRetention, 24 * 60 * 60 * 1000).unref();

// Session hygiene: expired rows otherwise die only when their token is next
// presented, so sweep them hourly.
const sweepSessions = () => {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  } catch (err) {
    console.error('Session sweep failed', err);
  }
};
sweepSessions();
setInterval(sweepSessions, 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`EasyTempah POS server listening on http://localhost:${PORT}`);
});

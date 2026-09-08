import { Router } from 'express';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth';
import { badRequest } from '../middleware/errors';
import { audit } from '../services/audit';
import { printKitchenTickets, printReceipt, testPrint } from '../services/printer';
import { getOrder } from '../services/orders';

export const printRouter = Router();
printRouter.use(requireAuth);

/** Print a receipt to the thermal printer; ?drawer=1 also kicks the cash drawer. */
printRouter.post('/receipt/:orderId', (req: AuthedRequest, res, next) => {
  const orderId = Number(req.params.orderId);
  printReceipt(orderId, { drawer: req.query.drawer === '1' })
    .then(() => {
      audit(req.user!.id, 'print.receipt', { orderId });
      res.json({ ok: true });
    })
    .catch(next);
});

/** Reprint kitchen tickets for an order's already-sent lines (e.g. printer was down). */
printRouter.post('/kitchen/:orderId', (req: AuthedRequest, res, next) => {
  const orderId = Number(req.params.orderId);
  const order = getOrder(orderId);
  const ids = order.items
    .filter((l) => !['pending', 'cancelled'].includes(l.status))
    .map((l) => l.id);
  if (!ids.length) throw badRequest('No sent lines to print');
  // Reprint surfaces errors (unlike the fire-and-forget path) so staff see a dead printer.
  printKitchenTickets(orderId, ids)
    .then(() => res.json({ ok: true, lines: ids.length }))
    .catch(next);
});

printRouter.post('/test/:which', requireRole('manager'), (req, res, next) => {
  const which = req.params.which;
  if (which !== 'receipt' && which !== 'kitchen' && which !== 'bar') throw badRequest('Unknown printer');
  testPrint(which)
    .then(() => res.json({ ok: true }))
    .catch(next);
});

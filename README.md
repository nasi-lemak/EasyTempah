# EasyTempah POS 🍜

A full-featured, deployment-ready point-of-sale system for food & beverage
businesses — cafés, restaurants, kopitiams and takeaway kitchens. One server
process and one SQLite file serve every terminal in the shop: POS lanes,
kitchen displays and the back office, all over the local network.

## Features

**Front of house**
- Dine-in with a live spatial floor plan (tables positioned per zone, square/round shapes, occupancy, running totals, cooking / food-ready indicators) plus a grid fallback view; managers arrange the floor with a drag-and-drop layout editor
- Takeaway and delivery orders
- Menu with categories and item modifiers (required/optional groups, priced add-ons, kitchen notes)
- Order-level discounts (percent/fixed, manager-gated above 20%), order notes, table transfer
- Payments: cash (tendered/change), card, e-wallet; split bills by amount; Malaysian 5-sen cash rounding (configurable)
- Refunds (partial or full) with a manager-approval flow: managers refund directly, cashiers approve with a manager's PIN; refunds hit the drawer, shift reconciliation and reports
- QR table ordering: guests scan a per-table code, browse the menu on their phone and send orders straight to the kitchen — items land on the table's tab marked 📱, guests watch their live tab with exact totals, and payment stays at the counter. Managers print the QR sheet and can rotate a table's code to invalidate printed ones
- ESC/POS thermal printing over the network (raw port 9100): kitchen and bar tickets print automatically per station when orders are sent (QR guest orders included), receipts print from the payment screen with optional cash-drawer kick, and Settings has per-printer config with a test button. Browser printing remains as a fallback
- Printable 80 mm thermal-style receipts

**Kitchen**
- Real-time Kitchen Display System with per-station routing (kitchen / bar)
- Ticket aging with color thresholds, per-line and whole-ticket bumping
  (`sent → preparing → ready → served`)

**Cash control**
- Shift sessions with opening float, paid-in/paid-out movements
- Live X-report (sales by method, expected drawer) and end-of-shift
  reconciliation with variance tracking

**Back office**
- Sales reports: summary KPIs, hourly chart, top items, payment mix, order-type split
- Menu management (categories, items, modifier groups) without restarts — changes push live to terminals
- Inventory: per-item stock tracking, automatic deduction on kitchen send, restock on void/cancel, adjustment audit trail, low-stock badges and sold-out lockout on the POS
- Users & roles (admin / manager / cashier / kitchen) with PIN sign-in
- Business settings: identity, receipt footer, tax (SST), service charge, cash rounding
- Audit log of sensitive actions (voids, discounts, shift events)

**Under the hood** — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
full design: domain model, order lifecycle, totals math, realtime (SSE) and the
security model. All money is integer cents; all order math runs server-side in
SQLite transactions.

## Quick start

```bash
npm install
npm run seed     # demo menu, tables and users
npm run dev      # server on :4000, client dev server on :5173
```

Sign in with a demo PIN:

| Role    | PIN  |
|---------|------|
| Admin   | 9999 |
| Manager | 5555 |
| Cashier | 1234 |
| Kitchen | 2468 |

## Production deployment

```bash
npm install
npm run seed
npm run build
npm start        # serves API + built client on http://<server>:4000
```

Point each terminal's browser at the server's LAN address (e.g.
`http://192.168.0.10:4000`) — POS lanes, the kitchen screen and the manager's
laptop all use the same URL and see role-appropriate screens. The entire state
lives in `server/data/easytempah.db`; back it up by copying the file.
`PORT` and `EASYTEMPAH_DB_PATH` environment variables override the defaults.

## Development

```bash
npm run typecheck   # strict TS across both workspaces
npm test            # order-math unit tests (totals, discounts, rounding)
```

The repo is an npm workspace monorepo: `server/` (Express + better-sqlite3 +
TypeScript) and `client/` (React 18 + Vite). In dev, Vite proxies `/api` to the
server; in production the server serves the built client itself.

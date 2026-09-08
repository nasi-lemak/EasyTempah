# EasyTempah — Architecture & Design

EasyTempah is a full-featured point-of-sale (POS) system built for food & beverage
deployment: cafés, restaurants, kopitiams, food courts and takeaway kitchens.
It is designed to run on a single on-premise machine (or small cloud VM) serving
multiple POS terminals, kitchen displays and back-office screens over the local
network from one server process.

## Goals

- **Complete front-of-house flow** — dine-in with table management, takeaway and
  delivery orders, item modifiers, order notes, discounts, split payments, cash
  rounding and printable receipts.
- **Back-of-house** — a real-time Kitchen Display System (KDS) with per-station
  routing (kitchen / bar) and ticket bumping.
- **Cash control** — shift (till) sessions with opening float, cash in/out
  movements, X-reports and end-of-shift reconciliation with variance tracking.
- **Back office** — menu management, inventory with stock deduction and low-stock
  alerts, user & role management, sales reporting, business settings.
- **Deployable** — one server process, one SQLite file, no external services.
  `npm run build && npm start` is a production deployment.

## Stack

| Layer     | Choice                                   | Why |
|-----------|------------------------------------------|-----|
| Server    | Node.js + Express 4 + TypeScript         | Ubiquitous, easy to deploy on cheap hardware |
| Database  | SQLite via `better-sqlite3` (WAL mode)   | Zero-ops, single file, synchronous API keeps order math transactional and race-free |
| Realtime  | Server-Sent Events (SSE)                 | One-directional push is all a POS needs; survives proxies, auto-reconnects |
| Client    | React 18 + Vite + TypeScript             | Fast dev loop, static build served by the API server in production |
| State     | Zustand                                  | Minimal global store for auth/settings/cart |
| Auth      | PIN login → opaque bearer token (stored server-side, scrypt-hashed PINs) | POS terminals need fast operator switching; no JWT secret management |

## Monorepo layout

```
easytempah/
├── server/
│   └── src/
│       ├── index.ts          # Express app entry; serves API + built client
│       ├── db/               # schema (migrations), connection, seed
│       ├── middleware/       # auth (bearer token), role guard, error handler
│       ├── realtime/         # SSE event bus
│       ├── services/         # order math, receipts, reports
│       └── routes/           # one router per resource
└── client/
    └── src/
        ├── api.ts            # fetch wrapper + typed endpoints
        ├── store.ts          # zustand store (auth, settings, cart)
        ├── pages/            # Login, POS, Tables, KDS, Orders, Shift, Reports,
        │                     # Menu admin, Inventory, Users, Settings
        └── components/       # shared UI (dialogs, numpad, layout)
```

## Domain model

All money is stored as **integer cents** (sen). Currency defaults to MYR but is
configurable.

- **users** — name, role (`admin` | `manager` | `cashier` | `kitchen`), scrypt PIN hash.
- **sessions** — opaque bearer tokens with expiry.
- **settings** — key/value JSON: business identity, tax lines, service charge,
  cash-rounding rule, receipt footer.
- **categories → items** — menu structure. Items carry price, KDS station,
  optional stock tracking (stock qty + low-stock threshold).
- **modifier_groups → modifiers** — e.g. "Sugar level" (pick 1), "Add-ons"
  (pick many, priced). Linked to items via `item_modifier_groups`.
- **dining_tables** — floor layout by zone, seat count, live status derived from
  open orders. Each table carries optional `pos_x`/`pos_y` (percent coordinates
  within its zone's floor canvas) and a `shape` (square/round) for the spatial
  floor plan view; tables without coordinates fall back to a "not on the floor
  plan" tray. Managers arrange the floor with a drag-and-drop editor that saves
  via `POST /api/tables/layout`. Occupied tables also surface kitchen progress
  (cooking / food-ready line counts) so front-of-house can see order state at a
  glance.
- **orders** — type (`dine_in` | `takeaway` | `delivery`), status
  (`open` | `paid` | `void`), snapshot totals (subtotal, discount, service
  charge, tax, rounding, grand total), linked shift.
- **order_items** — immutable snapshots of item name/price/modifiers at the time
  of ordering, with a kitchen lifecycle:
  `pending → sent → preparing → ready → served` (or `cancelled`).
- **payments** — method (`cash` | `card` | `ewallet` | ...), amount, tendered &
  change for cash, reference for cards. Multiple payments per order = split bill.
- **shifts** & **cash_movements** — till sessions; expected cash is computed
  as float + cash sales − refunds + paid-ins − paid-outs.
- **stock_movements** — audit trail for every stock change (sale, void
  restock, manual adjustment, received stock).
- **audit_log** — who did what, when (voids, price overrides, shift events).

## Order lifecycle

```
create order (dine_in: attach table, table becomes occupied)
  → add items (status: pending, editable)
  → SEND to kitchen (pending → sent, stock deducted, KDS tickets appear)
  → kitchen bumps items (sent → preparing → ready → served)
  → cashier takes payment(s); cash is rounded per the configured rule
  → when paid in full: order closed, table freed
void order → sent stock is restocked, table freed, audit-logged (manager+)
```

### Totals math (single source of truth: `server/src/services/orderMath.ts`)

```
line total   = qty × (unit price + Σ modifier deltas)
subtotal     = Σ line totals (cancelled lines excluded)
discount     = order-level, percent or fixed, capped at subtotal
service chg  = rate × (subtotal − discount)
tax          = rate × (subtotal − discount [+ service if taxed])   # exclusive
grand total  = subtotal − discount + service + tax + rounding
rounding     = cash rounding (default: Malaysian 5-sen rounding) applied only
               when the balance is settled by cash
```

Totals are recomputed server-side inside a SQLite transaction on every mutation;
clients never submit prices.

## Realtime

`GET /api/events` is an SSE stream. Mutating routes publish coarse-grained
events (`orders`, `tables`, `kds`, `menu`, `shifts`). Clients subscribe and
re-fetch the affected resource — simple, idempotent, and safe across reconnects.

## Security & roles

| Capability                        | cashier | kitchen | manager | admin |
|-----------------------------------|:-------:|:-------:|:-------:|:-----:|
| Take orders / payments            | ✓       |         | ✓       | ✓     |
| KDS bump                          | ✓       | ✓       | ✓       | ✓     |
| Void orders, discounts > limit    |         |         | ✓       | ✓     |
| Shift open/close, cash movements  | ✓       |         | ✓       | ✓     |
| Reports, menu & inventory admin   |         |         | ✓       | ✓     |
| User management, settings         |         |         |         | ✓     |

PINs are hashed with scrypt; sessions are opaque random tokens with a 12-hour
TTL, checked on every request. The client keeps the token in memory +
localStorage for terminal convenience (LAN deployment model).

## Receipts & printing

Receipts render as a print-optimised HTML view (80 mm thermal CSS) driven by
`GET /api/orders/:id/receipt` JSON. Browsers print to any OS-installed thermal
printer driver; the JSON payload is also structured so an ESC/POS bridge can be
added without touching order logic.

## Deployment

```
npm install
npm run seed     # creates data/easytempah.db with demo menu + users
npm run build
npm start        # serves API + client on :4000
```

Point each terminal's browser (POS lane, kitchen screen, manager laptop) at the
server's LAN address. The SQLite file in `server/data/` is the entire state —
back it up by copying the file.

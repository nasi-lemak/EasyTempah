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
- **refunds** — money returned against a *paid* order (partial or full), each
  row recording who took it and which manager approved it. Managers/admins
  approve with their own session; a cashier must supply a manager's PIN, which
  the server verifies against manager/admin scrypt hashes. Refunds reduce the
  shift's expected cash (cash refunds), appear on receipts and X-reports, and
  reports show gross vs. net (gross − refunds).
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

## Payments & channels

Payments carry two identities: a **kind** (`cash` | `card` | `ewallet` | `other`)
that drives drawer math and X-report grouping, and an optional **channel** —
the specific instrument ("GrabPay", "DuitNow QR"), configured as an editable
list in settings. The pay screen renders the enabled channels; choosing one
resolves its kind server-side (clients never pick the kind directly when a
channel key is sent). A static wallet/DuitNow QR payload from settings renders
as a scan-to-pay code at the till for e-wallet channels. Shift summaries and
reports break revenue down per channel; expected-drawer math remains keyed on
the cash kind only.

## LHDN MyInvois e-invoicing

`services/einvoice/` implements Malaysia's e-invoice mandate in three layers:

- **`ubl.ts`** — pure, unit-tested builder for UBL 2.1 JSON documents
  (document version 1.0, no digital signature required): supplier/buyer parties
  with TIN + registration schemes, MSIC industry code, per-line item
  classification, document-level AllowanceCharge for discount and service
  charge, order-level tax apportioned across lines with exact-total remainder
  handling, and a LegalMonetaryTotal that reconciles to the sen (including
  Malaysian cash rounding via PayableRoundingAmount).
- **`client.ts`** — MyInvois transport: OAuth2 client-credentials token cache,
  base64+SHA256 document submission, and status polling. Three environments:
  `mock` (built-in simulator, no network — used in tests and demos), `sandbox`
  (pre-prod) and `production`. The client secret never reaches the browser.
- **`index.ts`** — orchestration + persistence in the `einvoices` table:
  buyer-requested **individual** e-invoices for paid orders (TIN/ID validated,
  one active document per order) and monthly **consolidated** e-invoices that
  roll every un-invoiced paid receipt into one document against LHDN's
  general-public TIN with classification code 004. Orders link to their
  covering document via `orders.einvoice_id`; invalid/errored documents release
  their orders for retry. Valid documents expose the MyInvois portal link,
  which the receipt renders as a QR alongside the UUID.

## QR table ordering

Every dining table carries a random `qr_token`; a printed QR points guests at
`/order/<token>`, a public mobile page served by the same app. The unauthenticated
`/api/guest/:token/*` endpoints are the only public surface and are strictly
token-scoped: menu browsing, viewing the table's own tab (totals and items,
never payments or staff data), and submitting items. Guest submissions reuse the
exact server-side validation as the staff POS (no client-trusted prices), land
on the table's open tab — created under a hidden, login-disabled "QR Guest"
system user when needed — already fired to the kitchen with stock deducted, and
are flagged `source = 'guest'` so the POS cart and KDS mark them 📱. Submission
size and quantities are capped. Managers print the QR sheet from the back office
and can rotate any table's token, which immediately invalidates printed codes.
Payment remains a staff action at the counter.

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

Two paths, both driven by the same order data:

- **HTML receipts** — a print-optimised view (80 mm thermal CSS) driven by
  `GET /api/orders/:id/receipt` JSON, for browsers printing through any
  OS-installed printer driver.
- **ESC/POS bridge** — `services/escpos.ts` is a pure byte encoder (42-column
  layout, alignment/bold/double-size, partial cut, drawer kick, ASCII-sanitised
  text) with unit tests; `services/printer.ts` delivers documents to network
  printers over raw TCP 9100 with a 5 s timeout. Kitchen and bar tickets print
  automatically when lines are fired (staff send and QR guest submissions),
  routed per station, as fire-and-forget so a dead printer never blocks an
  order; explicit prints (receipt, reprint, test page) surface a 502 to staff
  instead. Printer targets (host/port/enabled, drawer kick) live in settings
  with a per-printer test button in the back office.

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

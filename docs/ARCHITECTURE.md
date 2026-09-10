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
- **combo_groups → combo_group_items** — set meals: a combo item carries choice
  groups ("Main", "Drink"), each listing eligible component items with optional
  surcharges. Ordering a set inserts one parent line at the bundle price (the
  chosen components stored as modifier-style snapshots, so receipts, carts and
  e-invoices render them with zero extra code) plus zero-priced child lines
  (`order_items.parent_line_id`) per component — those drive KDS station
  routing and component stock deduction. Sets edit, cancel and split as a
  unit: parent quantity edits sync children, cancellation cascades with
  restock, and bill splits move or proportionally clone the whole set.
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
- **ingredients → recipe_lines / modifier_recipe_lines** — recipe-level
  inventory: ingredients in real units (g/ml/pcs) with per-unit cost, consumed
  automatically when a line fires — the item's recipe plus the recipes of its
  chosen add-ons, and set-meal components through their own recipes — and
  returned on cancels and voids, all logged in `ingredient_movements`.
  Ingredient stock is deliberately allowed to go negative: it flags a counting
  gap in the back office instead of blocking the kitchen, while item-level
  stock remains the hard sold-out enforcement. Recipes are edited in the menu
  admin, which also surfaces the computed food cost per item.
- **audit_log** — who did what, when (voids, price overrides, shift events).
- **customers → point_movements** — phone-number loyalty. Members attach to an
  open order at payment (created on first join); on full settlement the member
  earns points on net spend (total minus points tender) at the configured rate,
  updating lifetime visits/spend. Redemption converts points to currency and
  records it as a payment (kind `other`, channel "Points"), so split logic,
  settlement and drawer math need no special cases — cash reconciliation never
  sees points. Every earn/redeem/manual adjustment lands in the points ledger;
  platform delivery orders are excluded from membership.

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

### Gateway auto-confirmation (payment intents + webhooks)

Without a gateway, wallet payments are sight-verified (the Malaysian standee-QR
norm). With one enabled, `services/gateway.ts` closes the loop: the cashier's
channel choice creates a **payment intent** for the order's balance, the till
shows the QR and polls, and the gateway's webhook confirms the payment
automatically. The public `/api/payment-webhooks/:provider` endpoint is mounted
before the JSON body parser so HMAC-SHA256 signatures verify over the raw body
(X-Signature header); everything else about it is defensive — unknown provider
404s, disabled gateway 409s, bad signatures 401.

Matching has two modes. **Dynamic QR** (gateway issues per-transaction codes):
the webhook names the intent id, so matching is exact and amount-checked.
**Static QR** (one laminated counter code): events carry only an amount, so the
match is the single pending intent with that amount inside the TTL window — two
candidates means the system refuses to guess (`ambiguous`) and the cashier
falls back to manual confirmation, which always remains available. Consumed
gateway references are replay-guarded, every webhook is logged to
`webhook_events` with its outcome, intents expire after 3 minutes, and one
live intent per order keeps lanes unambiguous. The `mock` provider simulates
the entire loop (signed webhook included) for demos and tests; `generic`
accepts any acquirer that can POST `{amount_cents, reference, intent_id?}`
signed with the shared secret.

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

## Delivery platform orders (GrabFood / foodpanda / ShopeeFood)

Orders re-keyed from a platform's merchant tablet are first-class: the delivery
start flow tags the order with a configured platform (`orders.platform`) and
the platform's own order number (`orders.platform_ref`) for reconciliation.
Settlement is one tap at menu value under the platform's name (payment kind
`other`, channel = platform label, reference = platform order no.), so kitchen
tickets, stock deduction and reports all reconcile while drawer math is
untouched. Two compliance rules are enforced server-side: platform orders
cannot be individually e-invoiced, and they are excluded from the monthly
consolidated e-invoice — under LHDN's e-commerce rules the platform issues
those e-invoices, and including them would report the sale twice. Reports show
a per-platform breakdown: orders, gross, and estimated commission/net payout
from the configurable commission rate (an estimate to reconcile against the
platform's settlement report). Automatic order ingestion from platform APIs is
a future adapter on the same webhook pattern as the payment gateway.

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
  layout, alignment/bold/double-size, partial cut, drawer kick, native QR codes
  via GS ( k, and ASCII text where accented Latin transliterates — Café → Cafe —
  before anything else degrades to `?`) with unit tests; `services/printer.ts`
  delivers documents to network printers over raw TCP 9100 with a 5 s timeout.
  The thermal receipt renders the same content as the HTML one: itemised lines
  with modifiers, discount/promo/service/tax/rounding, payments with
  tendered/change, refunds, the member points block, and the LHDN e-invoice
  section (status, UUID, MyInvois portal QR printed natively).

Receipt identity and localization (`services/receiptLang.ts`, `logo.ts`):

- **Languages** — the business picks a primary and optional secondary receipt
  language (en/ms/zh) to fit its audience; fixed labels render as
  "primary / secondary" (小计 / Subtotal) and are computed server-side once, so
  the HTML and thermal receipts always agree. Operator-entered text (menu item
  names, tax/service labels, footer) prints as written. Each printer has a
  charset: 'ascii' (default; accented Latin transliterates) or 'gbk' for
  Chinese-firmware printers — GBK output enables the printer's Kanji mode
  (FS &) and the 42-column math counts CJK glyphs as double-width so money
  columns stay aligned.
- **Logo** — a small PNG uploaded in Settings (validated by actually
  rasterizing it), stored as a data URL, shown on the HTML receipt and printed
  as a packed 1-bit ESC/POS raster (GS v 0), downscaled to 384 dots wide with
  transparency composited to white.
- **Serial numbers** — orders get a sequential receipt serial (prefix +
  6-digit counter, e.g. INV-000123) stamped inside the payment transaction the
  moment the bill settles, so the counter is race-free, voids never consume a
  number and reprints reuse it. Separate from the per-day order number;
  included in the orders CSV export. Kitchen and bar tickets print
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

## Demo mode

`npm run seed:demo` layers ~3 weeks of generated sales history on top of the
base seed (`server/src/db/demo.ts`): closed shifts with drawer reconciliation,
orders across dine-in/takeaway/delivery and the delivery platforms, a realistic
payment-channel mix, occasional discounts and refunds, loyalty members earning
and redeeming points, plus an open shift and a couple of live kitchen tickets
for "today". The generator goes through the same totals math as the live code
(`computeTotals` / `cashRoundingAdjustment`) so every generated order satisfies
the app's invariants; it uses a fixed RNG seed, so the numbers are reproducible.

Safety properties:

- It refuses to run against a database holding sales it didn't generate itself
  (guarded by the `demo` settings flag), so it can never contaminate a
  production till.
- While the flag is set, every signed-in screen shows a **DEMO DATA** badge
  (hidden from receipt/QR printing).
- `npm run seed:demo -- --reset` wipes only transactional history (orders,
  payments, shifts, members, movements) and regenerates — menu, users, tables
  and stock levels are left alone. Item/ingredient stock is deliberately not
  back-consumed by the generated history: stock counts represent *now*.

Going live from a demo install: reset once, then delete `server/data/` and run
`npm run seed` for a clean database (the flag clears with the file).

## Promotions

Scheduled automatic discounts (`promotions` table, managed under Menu →
Promos, manager+): percent or fixed amount; scoped to the whole order, a
category or one item; targeted by weekday set, local time window (an end
before the start means overnight, e.g. 22:00–02:00, matched against the
current day's clock), inclusive date range and order types.

Application lives in `recomputeTotals` — the same single choke-point as all
other order math — via `bestPromo()` (`services/promotions.ts`, pure matching
and discount functions, unit-tested): every active matching promotion is
priced against the order's non-cancelled parent lines and the single best
value wins; promotions never stack with each other but do combine with a
manual discount (`computeTotals` clips `promoCents` to what remains of the
subtotal, and the service-charge/tax base is reduced by both). The applied
promotion is denormalized onto the order (`promo_id`, `promo_name`,
`promo_cents`) so receipts and reports read it without joins, and it
re-evaluates on every bill mutation — a promo locks in as rung and refreshes
whenever lines or the discount change, not on a background clock.

Exclusions and guards: platform orders never receive promotions (they settle
at the platform's menu value); combo child lines are skipped (the parent
carries the bundle price); deleting a promotion referenced by paid orders is
refused (409) — deactivate it instead, preserving reporting history. Reports
show promotions separately from manual discounts (summary `promos_cents`,
per-order CSV columns).

## Theming

The whole UI draws from one token block in `styles.css`; all tinted washes use
`color-mix()` over those tokens, so nothing is hardcoded per theme. Two layers:

- **Theme (per device)** — `theme.ts` stamps `<html data-theme="dark|light">`
  from a localStorage preference (dark / light / follow-system, cycled from
  the sidebar). The light palette re-tunes semantic colors for white rather
  than inverting. Receipts, QR sheets and print views stay paper-white in
  both themes by design.
- **Brand accent (business-wide)** — `business.accentColor` (validated hex,
  Settings → Business, swatches + free picker). Terminals apply it at
  settings load as inline `--accent`/`--accent-dark`/`--accent-text`
  overrides — the hover shade is derived and button text is picked by
  relative luminance, so any brand color stays readable in both themes.
  Guest QR pages apply it too, from the public menu payload.

## Menu item photos

Photos live in their own `item_images` table (`item_id PK, mime, data BLOB`)
so `SELECT *` item queries never drag blobs into JSON payloads; item lists
expose only `image_v` (the upload timestamp) for cache-busted URLs. Uploads
are prepared client-side (`client/src/images.ts`): center-crop to a 512px
square and encode WebP where the browser can (all Chromium terminals), JPEG
otherwise — originals never cross the wire, and the server enforces a 400 KB
cap plus a strict data-URL mime whitelist. Serving is a public, cacheable
endpoint (`GET /api/menu/images/:itemId`, mounted before auth — menu photos
are shown to unauthenticated QR guests by design) with `max-age=86400` and a
`?v=` version from `image_v`. Thumbnails render on POS tiles and guest menu
rows; items without photos keep the text-only layout. AVIF was considered
and deliberately deferred: browsers cannot reliably *encode* AVIF in canvas,
and server-side encoding would add a native codec dependency for ~10 KB per
image on a ~1 MB total menu — the schema stores any mime, so it can be
revisited without migration.

## Reservations

`reservations` (migration v16) records name/phone/party/time (stored as local
wall-clock text, matching how staff enter it), an optional table, notes, and a
status lifecycle `booked → seated | cancelled | no_show` (the latter two
restorable). Creating or editing a booking resolves the phone against
`customers`, so a member's booking carries `customer_id`; the seat endpoint
(`POST /api/reservations/:id/seat`) opens a dine-in order with the party's
cover count on the booked (or chosen) table — refusing tables with an open
bill — links the order back to the booking, and best-effort attaches the
member to the bill so points flow without re-asking for the phone. The tables
endpoint exposes each table's next booked reservation in a −30min/+2h window
(`reservation_name`/`reservation_at`) for the floor plan's 📅 marker.
Realtime rides a dedicated `reservations` SSE channel plus the existing
`tables` channel. No public self-booking page: bookings are staff-entered by
design (phone/WhatsApp remains the booking channel; a public page would need
spam and double-booking controls that a counter workflow doesn't).

## Menu performance & trend dashboards

`GET /api/reports/menu` aggregates paid, non-cancelled parent lines per item
for the range (set-meal children excluded — the set is the menu item being
judged), joins category/station for filtering, computes the same aggregate for
the preceding equal-length window (trend chips), and attaches a unit food cost
where the item has an ingredient recipe (`recipe_lines × cost_per_unit_cents`;
modifier recipes and modifier revenue are deliberately out of the margin
calculation). The client renders: a bar-list table with share-of-sales and
▲/▼/new trend chips; a menu-engineering scatter (x = share of items sold,
y = gross margin from realized unit revenue vs recipe cost, quadrant lines at
the plotted means, items without recipes excluded and counted in a note); and
a daily revenue line with the previous window overlaid dashed (zero-filled
days, `/api/reports/daily` called for both windows). Charts are hand-rolled
SVG on the app's theme tokens — single-hue marks plus a neutral dashed
comparison series, so identity never rides on hue alone and the admin-set
brand accent restyles them automatically.

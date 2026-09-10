# EasyTempah POS 🍜

A full-featured, deployment-ready point-of-sale system for food & beverage
businesses — cafés, restaurants, kopitiams and takeaway kitchens. One server
process and one SQLite file serve every terminal in the shop: POS lanes,
kitchen displays and the back office, all over the local network.

## Features

**Front of house**
- Dine-in with a live spatial floor plan (tables positioned per zone, square/round shapes, occupancy, running totals, cooking / food-ready indicators) plus a grid fallback view; managers arrange the floor with a drag-and-drop layout editor
- Takeaway and delivery orders, including delivery-platform orders (GrabFood / foodpanda / ShopeeFood): re-keyed from the merchant tablet with the platform's order number, settled one-tap at menu value under the platform's name, excluded from the merchant's consolidated e-invoice (the platform issues those), and reported per platform with gross vs. estimated net payout from configurable commission rates
- Menu with categories and item modifiers (required/optional groups, priced add-ons, kitchen notes)
- Set meals / combos: bundle-priced items with choice groups (e.g. "Drink: Teh Tarik / +RM1.50 Milo"); the bill shows one set line while each chosen component routes to its own kitchen/bar station and deducts its own stock. Sets edit/cancel/split as a unit, work from QR guest ordering too, and are configured in the menu admin
- Order-level discounts (percent/fixed, manager-gated above 20%), order notes, table transfer
- Scheduled promotions: happy hours and deals (percent or RM off; whole order, a category or a single item) with weekday, time-window (overnight supported), date-range and order-type targeting — applied automatically at the till, shown by name in the cart and on receipts, reported separately from manual discounts, and managed under Menu → Promos. The single best-value promotion applies per order; platform orders are excluded
- Split bills by items: move chosen items (whole or partial quantities) onto sibling bills on the same table; each bill recalculates its own charges and the table frees only when every bill is settled. Split by amount also supported
- Payments: cash (tendered/change), card, and named e-wallet channels (Touch 'n Go, GrabPay, Boost, ShopeePay, DuitNow QR — configurable in Settings) with an on-screen scan-to-pay QR; split bills by amount; Malaysian 5-sen cash rounding (configurable). Shift and reports break sales down per channel while drawer math stays keyed on cash
- Refunds (partial or full) with a manager-approval flow: managers refund directly, cashiers approve with a manager's PIN; refunds hit the drawer, shift reconciliation and reports
- QR table ordering: guests scan a per-table code, browse the menu on their phone and send orders straight to the kitchen — items land on the table's tab marked 📱, guests watch their live tab with exact totals, and payment stays at the counter. Managers print the QR sheet and can rotate a table's code to invalidate printed ones
- Payment gateway scaffold with webhook auto-confirmation: cashier requests a wallet/card payment, the till shows the QR and waits, and the payment confirms itself when the gateway's HMAC-signed webhook arrives — exact matching for dynamic per-transaction QRs, amount+time-window matching (with ambiguity refusal) for a static counter QR, replay protection, and a built-in mock provider that simulates the whole loop for testing. Manual sighted confirmation remains as fallback
- LHDN MyInvois e-invoicing: buyer-requested individual e-invoices captured at the till (TIN/ID validation, UBL 2.1 JSON, submission + validation tracking, MyInvois QR and UUID on the receipt), one-click monthly consolidated e-invoices for walk-in receipts, and automatic credit notes (type 02, referencing the original document) when an e-invoiced sale is refunded. Environments: built-in mock simulator for testing, MyInvois sandbox, and production
- ESC/POS thermal printing over the network (raw port 9100): kitchen and bar tickets print automatically per station when orders are sent (QR guest orders included), receipts print from the payment screen with optional cash-drawer kick, and Settings has per-printer config with a test button. Browser printing remains as a fallback
- Printable 80 mm thermal-style receipts with a business logo (PNG upload, printed as a native ESC/POS raster), sequential receipt serial numbers (e.g. INV-000123, assigned when the bill settles, configurable prefix, in the CSV export) and audience-matched languages: pick a primary and optional secondary from English / Bahasa Melayu / 中文 (e.g. a Chinese restaurant can run 中文 + English and skip Malay) — labels print bilingually on screen and paper, with GBK charset support for thermal printers with Chinese firmware

**Kitchen**
- Real-time Kitchen Display System with per-station routing (kitchen / bar)
- Ticket aging with color thresholds, per-line and whole-ticket bumping
  (`sent → preparing → ready → served`), and a recall list to un-bump recently served lines

**Cash control**
- Shift sessions with opening float, paid-in/paid-out movements
- Live X-report (sales by method, expected drawer) and end-of-shift
  reconciliation with variance tracking

**Back office**
- Sales reports: summary KPIs, hourly chart, top items, payment mix, order-type split, per-staff attribution (orders opened, collected, refunds given — also on the live shift X-report), and one-click CSV exports (orders / items / payments) for the accountant
- Menu management (categories, items, modifier groups) without restarts — changes push live to terminals
- Inventory: per-item stock tracking, automatic deduction on kitchen send, restock on void/cancel, adjustment audit trail, low-stock badges and sold-out lockout on the POS
- Recipe-level inventory: ingredients (g/ml/pcs) with recipes on menu items and add-ons; firing a line consumes its ingredients automatically (set-meal components included), cancels and voids return them, and the back office tracks receiving, stocktakes, movement history and per-item food cost. Ingredient stock can go negative to flag counting gaps without blocking the kitchen
- Customer loyalty: members join by phone number at payment, earn configurable points on net spend once the bill settles, and redeem points as tender against the balance (recorded as a "Points" payment — drawer math untouched). Receipts show points earned and balance; managers get a Members page with search, lifetime stats, manual adjustments and a full points ledger
- Users & roles (admin / manager / cashier / kitchen) with PIN sign-in
- Business settings: identity, receipt footer, tax, service charge (per-order-type — dine-in only by default per MY/SG convention, fully toggleable), cash rounding, and one-click country presets (🇲🇾 RM/SST 6%, 🇸🇬 S$/GST 9%) — every value stays individually editable for other markets
- Hardening & ops: PIN brute-force lockout (5 failures → 5-minute IP lock), manager-gated per-line price overrides, and automatic daily SQLite backups (14 kept) with a back-up-now button
- Demo mode: `npm run seed:demo` generates weeks of realistic sales history (shifts, refunds, members, platform orders, live kitchen tickets) for showrooms and training, with a DEMO DATA badge on every screen, a production-database guard, and one-command reset
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

Want the full showroom experience? Use `npm run seed:demo` instead of
`npm run seed`: it also generates ~3 weeks of realistic sales history —
shifts, orders across all channels and platforms, refunds, loyalty members
with points, plus live kitchen tickets — so Reports, Shift and Members look
alive immediately. A **DEMO DATA** badge shows on every screen while the flag
is set; it refuses to run on a database with real sales, and
`npm run seed:demo -- --reset` wipes and regenerates the history.

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

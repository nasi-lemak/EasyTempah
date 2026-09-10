import type { Database } from 'better-sqlite3';

// Versioned, idempotent migrations. Each entry runs once, tracked in schema_migrations.
const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','kitchen')),
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    sku TEXT,
    station TEXT NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen','bar')),
    active INTEGER NOT NULL DEFAULT 1,
    track_stock INTEGER NOT NULL DEFAULT 0,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE modifier_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    min_select INTEGER NOT NULL DEFAULT 0,
    max_select INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE modifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE item_modifier_groups (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, group_id)
  );

  CREATE TABLE dining_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zone TEXT NOT NULL DEFAULT 'Main',
    seats INTEGER NOT NULL DEFAULT 2,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    opened_by INTEGER NOT NULL REFERENCES users(id),
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    opening_float_cents INTEGER NOT NULL DEFAULT 0,
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT,
    expected_cash_cents INTEGER,
    counted_cash_cents INTEGER,
    variance_cents INTEGER,
    notes TEXT
  );

  CREATE TABLE cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
    table_id INTEGER REFERENCES dining_tables(id),
    covers INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    discount_type TEXT CHECK (discount_type IN ('percent','fixed')),
    discount_value INTEGER NOT NULL DEFAULT 0,
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    service_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    rounding_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    paid_cents INTEGER NOT NULL DEFAULT 0,
    shift_id INTEGER REFERENCES shifts(id),
    opened_by INTEGER NOT NULL REFERENCES users(id),
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    void_reason TEXT
  );
  CREATE INDEX idx_orders_status ON orders(status);
  CREATE INDEX idx_orders_table ON orders(table_id);
  CREATE INDEX idx_orders_opened_at ON orders(opened_at);

  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id),
    name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price_cents INTEGER NOT NULL,
    modifiers_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','sent','preparing','ready','served','cancelled')),
    station TEXT NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen','bar')),
    line_total_cents INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_order_items_order ON order_items(order_id);
  CREATE INDEX idx_order_items_status ON order_items(status);

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    method TEXT NOT NULL CHECK (method IN ('cash','card','ewallet','other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    tendered_cents INTEGER,
    change_cents INTEGER,
    reference TEXT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shift_id INTEGER REFERENCES shifts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_payments_order ON payments(order_id);
  CREATE INDEX idx_payments_shift ON payments(shift_id);

  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_stock_movements_item ON stock_movements(item_id);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v2 — spatial floor plan: percentage coordinates per table within its zone
  `
  ALTER TABLE dining_tables ADD COLUMN pos_x REAL;
  ALTER TABLE dining_tables ADD COLUMN pos_y REAL;
  ALTER TABLE dining_tables ADD COLUMN shape TEXT NOT NULL DEFAULT 'square'
    CHECK (shape IN ('square','round'));
  `,
  // v3 — refunds with manager approval
  `
  ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    method TEXT NOT NULL CHECK (method IN ('cash','card','ewallet','other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    approved_by INTEGER NOT NULL REFERENCES users(id),
    shift_id INTEGER REFERENCES shifts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_refunds_order ON refunds(order_id);
  CREATE INDEX idx_refunds_shift ON refunds(shift_id);
  `,
  // v4 — QR table ordering: per-table guest tokens, line provenance
  `
  ALTER TABLE dining_tables ADD COLUMN qr_token TEXT;
  CREATE UNIQUE INDEX idx_tables_qr ON dining_tables(qr_token);
  ALTER TABLE order_items ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'
    CHECK (source IN ('staff','guest'));
  `,
  // v5 — named payment channels + LHDN MyInvois e-invoices
  `
  ALTER TABLE payments ADD COLUMN channel TEXT;

  CREATE TABLE einvoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    type TEXT NOT NULL CHECK (type IN ('invoice','consolidated')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','submitted','valid','invalid','error')),
    buyer_json TEXT,
    document_json TEXT NOT NULL,
    internal_id TEXT NOT NULL,
    uuid TEXT,
    long_id TEXT,
    submission_uid TEXT,
    error TEXT,
    period TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_einvoices_order ON einvoices(order_id);
  CREATE INDEX idx_einvoices_status ON einvoices(status);

  ALTER TABLE orders ADD COLUMN einvoice_id INTEGER REFERENCES einvoices(id);
  `,
  // v6 — payment gateway: intents + webhook auto-confirmation
  `
  CREATE TABLE payment_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    channel_key TEXT NOT NULL,
    channel_label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cash','card','ewallet','other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','confirmed','cancelled','expired')),
    provider TEXT NOT NULL,
    provider_ref TEXT,
    qr_payload TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_intents_order ON payment_intents(order_id);
  CREATE INDEX idx_intents_status ON payment_intents(status);

  CREATE TABLE webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    payload TEXT NOT NULL,
    matched_intent_id INTEGER REFERENCES payment_intents(id),
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v7 — delivery platform orders (GrabFood etc.): identity + platform order ref
  `
  ALTER TABLE orders ADD COLUMN platform TEXT;
  ALTER TABLE orders ADD COLUMN platform_ref TEXT;
  CREATE INDEX idx_orders_platform ON orders(platform);
  `,
  // v8 — e-invoice credit notes: rebuild einvoices to widen the type CHECK and
  // add refund_id. orders.einvoice_id links are parked while the referenced
  // table is swapped, then restored (FKs are enforced during migrations).
  `
  CREATE TABLE _einv_links (order_id INTEGER PRIMARY KEY, einvoice_id INTEGER);
  INSERT INTO _einv_links SELECT id, einvoice_id FROM orders WHERE einvoice_id IS NOT NULL;
  UPDATE orders SET einvoice_id = NULL;

  CREATE TABLE einvoices_v8 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    type TEXT NOT NULL CHECK (type IN ('invoice','consolidated','credit_note')),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','submitted','valid','invalid','error')),
    buyer_json TEXT,
    document_json TEXT NOT NULL,
    internal_id TEXT NOT NULL,
    uuid TEXT,
    long_id TEXT,
    submission_uid TEXT,
    error TEXT,
    period TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    refund_id INTEGER REFERENCES refunds(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO einvoices_v8 (id, order_id, type, status, buyer_json, document_json, internal_id,
    uuid, long_id, submission_uid, error, period, total_cents, created_by, created_at, updated_at)
    SELECT id, order_id, type, status, buyer_json, document_json, internal_id,
      uuid, long_id, submission_uid, error, period, total_cents, created_by, created_at, updated_at
    FROM einvoices;
  DROP TABLE einvoices;
  ALTER TABLE einvoices_v8 RENAME TO einvoices;
  CREATE INDEX idx_einvoices_order ON einvoices(order_id);
  CREATE INDEX idx_einvoices_status ON einvoices(status);

  UPDATE orders SET einvoice_id = (SELECT einvoice_id FROM _einv_links WHERE _einv_links.order_id = orders.id)
    WHERE id IN (SELECT order_id FROM _einv_links);
  DROP TABLE _einv_links;
  `,
  // v9 — combos / set meals: choice groups on a combo item, and component
  // order lines linked to their set's parent line for KDS routing and stock
  `
  ALTER TABLE items ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE combo_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_combo_groups_item ON combo_groups(item_id);

  CREATE TABLE combo_group_items (
    group_id INTEGER NOT NULL REFERENCES combo_groups(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    surcharge_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, item_id)
  );

  ALTER TABLE order_items ADD COLUMN parent_line_id INTEGER REFERENCES order_items(id);
  CREATE INDEX idx_order_items_parent ON order_items(parent_line_id);
  `,
  // v10 — recipe-level inventory: ingredients consumed by item/modifier recipes
  `
  CREATE TABLE ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'g',
    stock_qty REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL NOT NULL DEFAULT 0,
    cost_per_unit_cents REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE recipe_lines (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty REAL NOT NULL CHECK (qty > 0),
    PRIMARY KEY (item_id, ingredient_id)
  );

  CREATE TABLE modifier_recipe_lines (
    modifier_id INTEGER NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty REAL NOT NULL CHECK (qty > 0),
    PRIMARY KEY (modifier_id, ingredient_id)
  );

  CREATE TABLE ingredient_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    delta REAL NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ingredient_movements_ing ON ingredient_movements(ingredient_id);
  `,
  // v11 — customer loyalty: phone-number members, points earn/redeem
  `
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    total_spent_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_visit_at TEXT
  );

  CREATE TABLE point_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    order_id INTEGER REFERENCES orders(id),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_point_movements_customer ON point_movements(customer_id);

  ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);
  ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0;
  `,
  // v12 — promotions: scheduled automatic discounts (happy hour etc.), applied
  // server-side during totals recompute and recorded on the order
  `
  CREATE TABLE promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL CHECK (type IN ('percent','amount')),
    value INTEGER NOT NULL CHECK (value > 0),
    scope TEXT NOT NULL DEFAULT 'order' CHECK (scope IN ('order','category','item')),
    category_id INTEGER REFERENCES categories(id),
    item_id INTEGER REFERENCES items(id),
    days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    start_time TEXT,
    end_time TEXT,
    starts_on TEXT,
    ends_on TEXT,
    order_types_json TEXT NOT NULL DEFAULT '["dine_in","takeaway","delivery"]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE orders ADD COLUMN promo_id INTEGER REFERENCES promotions(id);
  ALTER TABLE orders ADD COLUMN promo_name TEXT;
  ALTER TABLE orders ADD COLUMN promo_cents INTEGER NOT NULL DEFAULT 0;
  `,
  // v13 — sequential receipt/invoice serial, assigned when a bill settles
  `
  ALTER TABLE orders ADD COLUMN receipt_no TEXT;
  CREATE UNIQUE INDEX idx_orders_receipt_no ON orders(receipt_no) WHERE receipt_no IS NOT NULL;
  `,
  // v14 — menu item photos. A separate table so item queries (SELECT *) never
  // drag image blobs into JSON payloads; served via a public cached endpoint.
  `
  CREATE TABLE item_images (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v15 — guest call-waiter requests, and staff time clock
  `
  CREATE TABLE service_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES dining_tables(id),
    reason TEXT NOT NULL DEFAULT 'service' CHECK (reason IN ('service','bill')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    acked_at TEXT,
    acked_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX idx_service_calls_open ON service_calls(table_id) WHERE acked_at IS NULL;

  CREATE TABLE time_clock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    clock_in TEXT NOT NULL DEFAULT (datetime('now')),
    clock_out TEXT
  );
  CREATE INDEX idx_time_clock_user ON time_clock(user_id);
  `,
  // v16 — table reservations
  `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    party_size INTEGER NOT NULL CHECK (party_size >= 1 AND party_size <= 100),
    reserved_at TEXT NOT NULL,
    table_id INTEGER REFERENCES dining_tables(id),
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','seated','cancelled','no_show')),
    notes TEXT,
    customer_id INTEGER REFERENCES customers(id),
    seated_order_id INTEGER REFERENCES orders(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_reservations_when ON reservations(reserved_at);
  CREATE INDEX idx_reservations_table ON reservations(table_id) WHERE status = 'booked';
  `,
  // v17 — PDPA: when the member agreed to the loyalty privacy notice.
  // Anonymised (deleted) members are marked by phone = 'deleted-<id>'.
  `
  ALTER TABLE customers ADD COLUMN consent_at TEXT;
  `,
  // v18 — 'limit' call reason: the guest order guard pages staff when a table
  // hits the submission limit. SQLite can't alter a CHECK, so rebuild.
  `
  CREATE TABLE service_calls_v18 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES dining_tables(id),
    reason TEXT NOT NULL DEFAULT 'service' CHECK (reason IN ('service','bill','limit')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    acked_at TEXT,
    acked_by INTEGER REFERENCES users(id)
  );
  INSERT INTO service_calls_v18 (id, table_id, reason, created_at, acked_at, acked_by)
    SELECT id, table_id, reason, created_at, acked_at, acked_by FROM service_calls;
  DROP TABLE service_calls;
  ALTER TABLE service_calls_v18 RENAME TO service_calls;
  CREATE INDEX idx_service_calls_open ON service_calls(table_id) WHERE acked_at IS NULL;
  `,
  // v19 — collection pagers: the number keyed against a counter order so the
  // pass knows which physical pager to ring when the food is up.
  `
  ALTER TABLE orders ADD COLUMN pager_no INTEGER;
  `,
];

export function applySchema(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const run = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  });
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (!applied.has(version)) run(version, sql);
  });
}

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

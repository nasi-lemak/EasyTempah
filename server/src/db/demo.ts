/**
 * Demo-mode seeder: layers ~3 weeks of realistic sales history on top of the
 * base seed so Reports, Shift history, Members and the KDS look alive the
 * moment the app opens.
 *
 *   npm run seed:demo             # fresh or base-seeded DB with no sales yet
 *   npm run seed:demo -- --reset  # wipe sales history and regenerate (demo DBs only)
 *
 * Safety: it refuses to touch a database that already holds sales unless that
 * database was itself demo-seeded (settings.demo.enabled). The flag is shown
 * in the UI as a DEMO DATA badge so nobody mistakes generated numbers for
 * real takings.
 *
 * The history writes orders/payments/refunds/shifts/members directly (through
 * the same totals math the live code uses) and deliberately leaves item and
 * ingredient stock untouched — stock counts represent "now", not three weeks
 * of back-dated service.
 */
import { db } from './connection';
import { seedBaseData } from './seedData';
import { cashRoundingAdjustment, computeTotals, lineTotal } from '../services/orderMath';
import {
  getLoyaltySettings,
  getPlatformsSettings,
  getSetting,
  getTaxSettings,
  setSetting,
} from '../services/settings';
import type { OrderItemModifierSnapshot, OrderType } from '../types';

const DAYS_OF_HISTORY = 21;

// ---- deterministic RNG so every demo DB tells the same story ----
let rngState = 0x5eed1234;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number) => rand() < p;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
function weightedHour(weights: [number, number][]): number {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [hour, w] of weights) {
    roll -= w;
    if (roll <= 0) return hour;
  }
  return weights[weights.length - 1][0];
}

/** Local wall-clock date parts → the UTC string format datetime('now') uses. */
function toSql(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function localYmd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ---- guardrails ----
const wantReset = process.argv.includes('--reset');
seedBaseData();
const demoFlag = getSetting<{ enabled: boolean }>('demo', { enabled: false });
const orderCount = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;

if (orderCount > 0 && !demoFlag.enabled) {
  console.error(
    'Refusing to run: this database already contains sales that were not demo-generated.\n' +
      'seed:demo only runs on a fresh database or on top of a previous demo seed.',
  );
  process.exit(1);
}
if (orderCount > 0 && !wantReset) {
  console.log('Demo history already generated. Re-run with `-- --reset` to wipe and regenerate.');
  process.exit(0);
}

const wipeAndGenerate = db.transaction(() => {
  if (orderCount > 0) {
    // Wipe sales history only — menu, users, tables, recipes and stock stay.
    db.exec(`
      UPDATE orders SET einvoice_id = NULL, customer_id = NULL;
      DELETE FROM einvoices;
      DELETE FROM point_movements;
      DELETE FROM webhook_events;
      DELETE FROM payment_intents;
      DELETE FROM refunds;
      DELETE FROM payments;
      DELETE FROM order_items;
      DELETE FROM orders;
      DELETE FROM cash_movements;
      DELETE FROM shifts;
      DELETE FROM customers;
      DELETE FROM stock_movements;
      DELETE FROM ingredient_movements;
      DELETE FROM audit_log;
      DELETE FROM sessions;
    `);
  }

  // ---- source data ----
  const tax = getTaxSettings();
  const platformCfg = getPlatformsSettings().platforms.filter((p) => p.enabled);
  const users = db.prepare('SELECT id, role FROM users WHERE active = 1').all() as {
    id: number;
    role: string;
  }[];
  const cashier = users.find((u) => u.role === 'cashier') ?? users[0];
  const manager = users.find((u) => u.role === 'manager') ?? users[0];
  const tables = (db.prepare('SELECT id FROM dining_tables WHERE active = 1').all() as { id: number }[]).map(
    (t) => t.id,
  );
  const items = db
    .prepare('SELECT id, name, price_cents, station FROM items WHERE active = 1 AND is_combo = 0')
    .all() as { id: number; name: string; price_cents: number; station: 'kitchen' | 'bar' }[];
  const modRows = db
    .prepare(
      `SELECT img.item_id, m.id, m.name, m.price_delta_cents, g.name AS group_name
       FROM item_modifier_groups img
       JOIN modifier_groups g ON g.id = img.group_id
       JOIN modifiers m ON m.group_id = g.id AND m.active = 1`,
    )
    .all() as { item_id: number; id: number; name: string; price_delta_cents: number; group_name: string }[];
  const modsByItem = new Map<number, typeof modRows>();
  for (const row of modRows) {
    const list = modsByItem.get(row.item_id) ?? [];
    list.push(row);
    modsByItem.set(row.item_id, list);
  }

  // Loyalty is part of the demo story — switch it on so earned points show up.
  const loyalty = { ...getLoyaltySettings(), enabled: true };
  setSetting('loyalty', loyalty);

  // ---- members ----
  const memberNames = [
    'Farah', 'Wei Ling', 'Hafiz', 'Priya', 'Daniel', 'Aisyah',
    'Kok Meng', 'Siti', 'Ravi', 'Nurul', 'Jason', 'Zul',
  ];
  const insertCustomer = db.prepare(
    'INSERT INTO customers (phone, name, points, visits, total_spent_cents, created_at, last_visit_at) VALUES (?, ?, 0, 0, 0, ?, NULL)',
  );
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - DAYS_OF_HISTORY);
  const members = memberNames.map((name, i) => ({
    id: Number(
      insertCustomer.run(`01${randInt(2, 9)}-${String(2000000 + i * 61237 + randInt(0, 9999)).padStart(7, '0')}`, name, toSql(windowStart)).lastInsertRowid,
    ),
    points: 0,
    visits: 0,
    spent: 0,
    lastVisit: null as string | null,
  }));

  // ---- statements ----
  const insertShift = db.prepare(
    `INSERT INTO shifts (status, opened_by, opened_at, opening_float_cents, closed_by, closed_at,
       expected_cash_cents, counted_cash_cents, variance_cents, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMovement = db.prepare(
    'INSERT INTO cash_movements (shift_id, type, amount_cents, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertOrder = db.prepare(
    `INSERT INTO orders (order_no, type, status, table_id, covers, discount_type, discount_value,
       subtotal_cents, discount_cents, service_cents, tax_cents, rounding_cents, total_cents,
       paid_cents, refunded_cents, shift_id, opened_by, opened_at, closed_at,
       platform, platform_ref, customer_id, points_earned, points_redeemed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO order_items (order_id, item_id, name, qty, unit_price_cents, modifiers_json,
       status, station, line_total_cents, sent_at, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPayment = db.prepare(
    `INSERT INTO payments (order_id, method, amount_cents, tendered_cents, change_cents, reference,
       user_id, shift_id, created_at, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRefund = db.prepare(
    `INSERT INTO refunds (order_id, method, amount_cents, reason, user_id, approved_by, shift_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPoints = db.prepare(
    'INSERT INTO point_movements (customer_id, delta, reason, order_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const channels = [
    { key: 'cash', label: 'Cash', method: 'cash' as const, weight: 42 },
    { key: 'card', label: 'Card', method: 'card' as const, weight: 20 },
    { key: 'tng', label: "Touch 'n Go eWallet", method: 'ewallet' as const, weight: 14 },
    { key: 'grabpay', label: 'GrabPay', method: 'ewallet' as const, weight: 8 },
    { key: 'duitnow', label: 'DuitNow QR', method: 'ewallet' as const, weight: 16 },
  ];
  const pickChannel = () => {
    const total = channels.reduce((s, c) => s + c.weight, 0);
    let roll = rand() * total;
    for (const c of channels) {
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    return channels[0];
  };
  // Lunch and dinner peaks over a 10:00–21:00 service day.
  const hourWeights: [number, number][] = [
    [10, 3], [11, 5], [12, 9], [13, 8], [14, 4], [15, 3],
    [16, 3], [17, 4], [18, 7], [19, 9], [20, 6], [21, 3],
  ];
  const refundReasons = ['Wrong order served', 'Customer complaint — too salty', 'Long wait, item cancelled'];

  let totalOrders = 0;
  let totalRevenue = 0;
  let totalRefunds = 0;

  const now = new Date();
  for (let back = DAYS_OF_HISTORY; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const isToday = back === 0;
    const dow = day.getDay();
    const weekendBoost = dow === 0 || dow === 5 || dow === 6 ? 1.3 : 1;
    const ymd = localYmd(day);

    // Today's shift can't open in the future (e.g. seeding before 09:45).
    const usualOpen = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 45, randInt(0, 59));
    const openedAt = isToday && usualOpen.getTime() > now.getTime() - 30 * 60_000
      ? new Date(now.getTime() - 30 * 60_000)
      : usualOpen;
    const float = 30000;
    const shiftId = Number(
      insertShift.run('open', cashier.id, toSql(openedAt), float, null, null, null, null, null, null)
        .lastInsertRowid,
    );

    let cashInDrawer = 0;
    let paidOut = 0;
    if (!isToday && chance(0.3)) {
      const amount = randInt(30, 80) * 100;
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 15, randInt(0, 59), 0);
      insertMovement.run(shiftId, 'out', amount, pick(['Gas refill', 'Wet market top-up', 'Cleaning supplies']), manager.id, toSql(at));
      paidOut += amount;
    }

    const target = Math.round(randInt(26, 40) * weekendBoost);
    let counter = 0;
    const currentHour = now.getHours();
    for (let n = 0; n < target; n++) {
      const hour = weightedHour(hourWeights);
      // Today only has history up to "now"; the live part is added below.
      if (isToday && hour >= currentHour) continue;
      const openTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, randInt(0, 59), randInt(0, 59));
      const closeTime = new Date(openTime.getTime() + randInt(8, 50) * 60_000);

      const roll = rand();
      const orderType: OrderType = roll < 0.62 ? 'dine_in' : roll < 0.84 ? 'takeaway' : 'delivery';
      const platform =
        orderType === 'delivery' && platformCfg.length > 0 && chance(0.7) ? pick(platformCfg) : null;

      // 1–4 lines, mostly qty 1
      const lineCount = randInt(1, 4);
      const lines: { item: (typeof items)[0]; qty: number; mods: OrderItemModifierSnapshot[] }[] = [];
      for (let l = 0; l < lineCount; l++) {
        const item = pick(items);
        const available = modsByItem.get(item.id) ?? [];
        const mods: OrderItemModifierSnapshot[] = [];
        if (available.length > 0 && chance(0.45)) {
          const m = pick(available);
          mods.push({ modifier_id: m.id, group_name: m.group_name, name: m.name, price_delta_cents: m.price_delta_cents });
        }
        lines.push({ item, qty: chance(0.25) ? 2 : 1, mods });
      }

      const discountType = chance(0.07) ? (chance(0.5) ? ('percent' as const) : ('fixed' as const)) : null;
      const discountValue = discountType === 'percent' ? 10 : discountType === 'fixed' ? 300 : 0;

      const totals = computeTotals({
        lines: lines.map((l) => ({ qty: l.qty, unit_price_cents: l.item.price_cents, modifiers: l.mods })),
        discountType,
        discountValue,
        orderType,
        tax,
      });

      // Member attach: walk-in orders only; platforms never earn points.
      const member = !platform && chance(0.28) ? pick(members) : null;
      let redeemPoints = 0;
      let redeemValue = 0;
      if (member && member.points >= Math.max(loyalty.minRedeemPoints, 300) && chance(0.35)) {
        const maxByBalance = Math.floor((totals.total_cents * loyalty.redeemPointsPerRm) / 100);
        redeemPoints = Math.min(member.points, maxByBalance);
        redeemValue = Math.floor((redeemPoints * 100) / loyalty.redeemPointsPerRm);
      }

      const channel = platform
        ? { key: platform.key, label: platform.label, method: 'other' as const }
        : pickChannel();
      // Cash rounding applies when cash settles the remaining balance.
      const preRound = totals.total_cents;
      const rounding =
        channel.method === 'cash' ? cashRoundingAdjustment(preRound - redeemValue, tax.cashRoundingCents) : 0;
      const total = preRound + rounding;

      counter += 1;
      const orderNo = `${ymd}-${String(counter).padStart(4, '0')}`;
      const tableId = orderType === 'dine_in' ? pick(tables) : null;
      const platformRef = platform ? `${platform.key === 'foodpanda' ? 'FP' : 'GF'}-${randInt(10000, 99999)}` : null;
      const orderId = Number(
        insertOrder.run(
          orderNo, orderType, 'paid', tableId, orderType === 'dine_in' ? randInt(1, 5) : 1,
          discountType, discountValue,
          totals.subtotal_cents, totals.discount_cents, totals.service_cents, totals.tax_cents,
          rounding, total, total, 0, shiftId, cashier.id, toSql(openTime), toSql(closeTime),
          platform?.key ?? null, platformRef,
          member?.id ?? null, 0, redeemPoints,
        ).lastInsertRowid,
      );

      const sentAt = toSql(new Date(openTime.getTime() + randInt(1, 3) * 60_000));
      for (const l of lines) {
        const guest = orderType === 'dine_in' && chance(0.15);
        insertLine.run(
          orderId, l.item.id, l.item.name, l.qty, l.item.price_cents, JSON.stringify(l.mods),
          'served', l.item.station,
          lineTotal({ qty: l.qty, unit_price_cents: l.item.price_cents, modifiers: l.mods }),
          sentAt, toSql(openTime), guest ? 'guest' : 'staff',
        );
      }

      const paidAt = toSql(closeTime);
      if (redeemValue > 0 && member) {
        insertPayment.run(orderId, 'other', redeemValue, null, null, `points:${redeemPoints}`, cashier.id, shiftId, paidAt, 'Points');
        member.points -= redeemPoints;
        insertPoints.run(member.id, -redeemPoints, 'redeem', orderId, cashier.id, paidAt);
      }
      const due = total - redeemValue;
      if (due > 0) {
        if (channel.method === 'cash') {
          const tendered = Math.ceil(due / 1000) * 1000; // next RM10 note
          insertPayment.run(orderId, 'cash', due, tendered, tendered - due, null, cashier.id, shiftId, paidAt, 'Cash');
          cashInDrawer += due;
        } else {
          insertPayment.run(
            orderId, channel.method, due, null, null,
            platform ? platformRef : chance(0.5) ? `TXN${randInt(100000, 999999)}` : null,
            cashier.id, shiftId, paidAt, channel.label,
          );
        }
      }

      if (member) {
        const earnBase = Math.max(0, total - redeemValue);
        const earned = Math.floor((earnBase / 100) * loyalty.earnPointsPerRm);
        member.points += earned;
        member.visits += 1;
        member.spent += total;
        member.lastVisit = paidAt;
        db.prepare('UPDATE orders SET points_earned = ? WHERE id = ?').run(earned, orderId);
        if (earned > 0) insertPoints.run(member.id, earned, 'earn', orderId, cashier.id, paidAt);
      }

      // The occasional partial refund, cash back across the counter.
      if (!platform && chance(0.02) && lines.length > 1) {
        const refundLine = lines[0];
        const amount = Math.min(
          lineTotal({ qty: 1, unit_price_cents: refundLine.item.price_cents, modifiers: refundLine.mods }),
          total,
        );
        if (amount > 0) {
          const at = toSql(new Date(closeTime.getTime() + randInt(5, 40) * 60_000));
          insertRefund.run(orderId, 'cash', amount, pick(refundReasons), manager.id, manager.id, shiftId, at);
          db.prepare('UPDATE orders SET refunded_cents = ? WHERE id = ?').run(amount, orderId);
          cashInDrawer -= amount;
          totalRefunds += amount;
        }
      }

      totalOrders += 1;
      totalRevenue += total;
    }

    if (isToday) {
      // Leave the shift open and put a couple of live orders on the floor so
      // the POS, floor plan and KDS have something to show immediately.
      const liveTables = [tables[1] ?? tables[0], tables[5] ?? tables[0]];
      liveTables.forEach((tableId, idx) => {
        counter += 1;
        const openTime = new Date(now.getTime() - randInt(6, 18) * 60_000);
        const lineDefs = [...new Set([pick(items), pick(items), pick(items), pick(items)])].slice(0, 2 + idx);
        const lines = lineDefs.map((item) => ({ qty: 1, unit_price_cents: item.price_cents, modifiers: [] as OrderItemModifierSnapshot[], item }));
        const totals = computeTotals({ lines, discountType: null, discountValue: 0, orderType: 'dine_in', tax });
        const orderId = Number(
          insertOrder.run(
            `${ymd}-${String(counter).padStart(4, '0')}`, 'dine_in', 'open', tableId, randInt(2, 4),
            null, 0, totals.subtotal_cents, totals.discount_cents, totals.service_cents, totals.tax_cents,
            0, totals.total_cents, 0, 0, shiftId, cashier.id, toSql(openTime), null, null, null, null, 0, 0,
          ).lastInsertRowid,
        );
        const sentAt = toSql(new Date(openTime.getTime() + 60_000));
        lines.forEach((l, li) => {
          insertLine.run(
            orderId, l.item.id, l.item.name, l.qty, l.item.price_cents, '[]',
            li === 0 ? 'preparing' : 'sent', l.item.station, lineTotal(l), sentAt, toSql(openTime), 'staff',
          );
        });
      });
    } else {
      const closedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 22, randInt(5, 25), 0);
      const expected = float + cashInDrawer - paidOut;
      const variance = chance(0.7) ? 0 : randInt(-300, 300);
      db.prepare(
        `UPDATE shifts SET status = 'closed', closed_by = ?, closed_at = ?, expected_cash_cents = ?,
           counted_cash_cents = ?, variance_cents = ? WHERE id = ?`,
      ).run(manager.id, toSql(closedAt), expected, expected + variance, variance, shiftId);
    }
  }

  for (const m of members) {
    db.prepare(
      'UPDATE customers SET points = ?, visits = ?, total_spent_cents = ?, last_visit_at = ? WHERE id = ?',
    ).run(m.points, m.visits, m.spent, m.lastVisit, m.id);
  }

  setSetting('demo', { enabled: true, generatedAt: toSql(new Date()) });
  return { totalOrders, totalRevenue, totalRefunds };
});

const stats = wipeAndGenerate();
console.log(`Demo history generated: ${DAYS_OF_HISTORY + 1} days, ${stats.totalOrders} orders, ` +
  `RM ${(stats.totalRevenue / 100).toFixed(2)} gross, RM ${(stats.totalRefunds / 100).toFixed(2)} refunded.`);
console.log('Loyalty enabled; DEMO DATA badge on. PINs — admin: 9999, manager: 5555, cashier: 1234, kitchen: 2468');
console.log('Reset any time with: npm run seed:demo -- --reset');

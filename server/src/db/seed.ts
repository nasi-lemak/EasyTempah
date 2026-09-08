/**
 * Seeds the database with demo users, menu, modifiers and tables.
 * Safe to re-run: it is a no-op if any user already exists.
 *
 * Demo PINs — admin: 9999, manager: 5555, cashier: 1234, kitchen: 2468
 */
import { db } from './connection';
import { hashPin } from '../middleware/auth';

const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
if (existing.n > 0) {
  console.log('Database already seeded — nothing to do.');
  process.exit(0);
}

const seed = db.transaction(() => {
  // Users
  const insertUser = db.prepare('INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)');
  insertUser.run('Aina (Admin)', 'admin', hashPin('9999'));
  insertUser.run('Melur (Manager)', 'manager', hashPin('5555'));
  insertUser.run('Chandran (Cashier)', 'cashier', hashPin('1234'));
  insertUser.run('Kavi (Kitchen)', 'kitchen', hashPin('2468'));

  // Categories
  const insertCat = db.prepare('INSERT INTO categories (name, sort) VALUES (?, ?)');
  const catRice = Number(insertCat.run('Rice & Mains', 1).lastInsertRowid);
  const catNoodles = Number(insertCat.run('Noodles', 2).lastInsertRowid);
  const catSides = Number(insertCat.run('Sides & Snacks', 3).lastInsertRowid);
  const catDrinks = Number(insertCat.run('Drinks', 4).lastInsertRowid);
  const catDesserts = Number(insertCat.run('Desserts', 5).lastInsertRowid);

  // Modifier groups
  const insertGroup = db.prepare(
    'INSERT INTO modifier_groups (name, min_select, max_select) VALUES (?, ?, ?)',
  );
  const gProtein = Number(insertGroup.run('Add Protein', 0, 0).lastInsertRowid);
  const gSpice = Number(insertGroup.run('Spice Level', 1, 1).lastInsertRowid);
  const gSugar = Number(insertGroup.run('Sweetness', 1, 1).lastInsertRowid);
  const gTemp = Number(insertGroup.run('Hot / Iced', 1, 1).lastInsertRowid);

  const insertMod = db.prepare(
    'INSERT INTO modifiers (group_id, name, price_delta_cents, sort) VALUES (?, ?, ?, ?)',
  );
  insertMod.run(gProtein, 'Fried Egg', 150, 1);
  insertMod.run(gProtein, 'Ayam Goreng (Fried Chicken)', 450, 2);
  insertMod.run(gProtein, 'Sambal Sotong', 500, 3);
  insertMod.run(gProtein, 'Beef Rendang', 600, 4);
  insertMod.run(gSpice, 'Mild', 0, 1);
  insertMod.run(gSpice, 'Regular', 0, 2);
  insertMod.run(gSpice, 'Extra Pedas', 0, 3);
  insertMod.run(gSugar, 'Normal Sugar', 0, 1);
  insertMod.run(gSugar, 'Kurang Manis (Less Sweet)', 0, 2);
  insertMod.run(gSugar, 'No Sugar', 0, 3);
  insertMod.run(gTemp, 'Hot', 0, 1);
  insertMod.run(gTemp, 'Iced', 50, 2);

  // Items
  const insertItem = db.prepare(
    `INSERT INTO items (category_id, name, price_cents, station, track_stock, stock_qty, low_stock_threshold, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const link = db.prepare('INSERT INTO item_modifier_groups (item_id, group_id) VALUES (?, ?)');
  const addItem = (
    cat: number,
    name: string,
    price: number,
    station: 'kitchen' | 'bar',
    groups: number[],
    sort: number,
    stock?: number,
  ) => {
    const id = Number(
      insertItem.run(cat, name, price, station, stock !== undefined ? 1 : 0, stock ?? 0, 5, sort)
        .lastInsertRowid,
    );
    for (const g of groups) link.run(id, g);
    return id;
  };

  addItem(catRice, 'Nasi Lemak Biasa', 550, 'kitchen', [gProtein, gSpice], 1);
  addItem(catRice, 'Nasi Lemak Ayam Berempah', 1090, 'kitchen', [gSpice], 2);
  addItem(catRice, 'Nasi Goreng Kampung', 950, 'kitchen', [gProtein, gSpice], 3);
  addItem(catRice, 'Ayam Penyet + Rice', 1290, 'kitchen', [gSpice], 4);
  addItem(catRice, 'Nasi Kerabu', 1150, 'kitchen', [gProtein], 5);

  addItem(catNoodles, 'Mee Goreng Mamak', 850, 'kitchen', [gProtein, gSpice], 1);
  addItem(catNoodles, 'Char Kuey Teow', 990, 'kitchen', [gSpice], 2);
  addItem(catNoodles, 'Curry Laksa', 1090, 'kitchen', [gSpice], 3);
  addItem(catNoodles, 'Maggi Goreng', 750, 'kitchen', [gProtein, gSpice], 4);

  addItem(catSides, 'Roti Canai', 220, 'kitchen', [], 1);
  addItem(catSides, 'Roti Telur', 320, 'kitchen', [], 2);
  addItem(catSides, 'Satay Ayam (6 pcs)', 900, 'kitchen', [], 3, 40);
  addItem(catSides, 'Cucur Udang (4 pcs)', 600, 'kitchen', [], 4, 30);
  addItem(catSides, 'Keropok Lekor', 500, 'kitchen', [], 5, 25);

  addItem(catDrinks, 'Teh Tarik', 280, 'bar', [gSugar, gTemp], 1);
  addItem(catDrinks, 'Kopi O', 250, 'bar', [gSugar, gTemp], 2);
  addItem(catDrinks, 'Milo Dinosaur', 550, 'bar', [], 3);
  addItem(catDrinks, 'Sirap Bandung', 320, 'bar', [gSugar], 4);
  addItem(catDrinks, 'Limau Ais', 300, 'bar', [gSugar], 5);
  addItem(catDrinks, 'Mineral Water', 200, 'bar', [], 6, 100);

  addItem(catDesserts, 'Cendol', 480, 'bar', [], 1);
  addItem(catDesserts, 'ABC (Ais Kacang)', 550, 'bar', [], 2);
  addItem(catDesserts, 'Pisang Goreng (4 pcs)', 450, 'kitchen', [], 3, 30);

  // Tables, laid out on the floor plan (pos_x/pos_y are % of the zone canvas)
  const insertTable = db.prepare(
    'INSERT INTO dining_tables (name, zone, seats, pos_x, pos_y, shape) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const mainHall: [number, number][] = [
    [14, 26], [38, 26], [62, 26], [86, 26],
    [14, 72], [38, 72], [62, 72], [86, 72],
  ];
  mainHall.forEach(([x, y], i) =>
    insertTable.run(`T${i + 1}`, 'Main Hall', i < 4 ? 2 : 4, x, y, 'square'),
  );
  const outdoor: [number, number][] = [[15, 40], [38, 40], [62, 40], [85, 40]];
  outdoor.forEach(([x, y], i) => insertTable.run(`A${i + 1}`, 'Outdoor', 4, x, y, 'round'));
  insertTable.run('VIP 1', 'VIP Room', 8, 30, 50, 'round');
  insertTable.run('VIP 2', 'VIP Room', 10, 70, 50, 'round');
});

seed();
console.log('Seeded demo data.');
console.log('PINs — admin: 9999, manager: 5555, cashier: 1234, kitchen: 2468');

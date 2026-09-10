/**
 * Seeds the database with demo users, menu, modifiers and tables.
 * Safe to re-run: it is a no-op if any user already exists.
 *
 * Demo PINs — admin: 9999, manager: 5555, cashier: 1234, kitchen: 2468
 */
import { seedBaseData } from './seedData';

if (!seedBaseData()) {
  console.log('Database already seeded — nothing to do.');
  process.exit(0);
}

console.log('Seeded demo data.');
console.log('PINs — admin: 9999, manager: 5555, cashier: 1234, kitchen: 2468');

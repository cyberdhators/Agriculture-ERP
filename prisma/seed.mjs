// Seeds the staging database. Run with `pnpm db:seed`.
//
// Unit B1.3 inserts exactly one row into the throwaway _smoke table. When
// _smoke is dropped in migration 3 this file stays, emptied of that logic,
// ready for the B2 location tables.

import { PrismaClient } from '@prisma/client';

import { loadEnvLocal } from '../scripts/load-env.mjs';

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error('');
  console.error('DATABASE_URL is not set, so there is nothing to connect to.');
  console.error('Put it in .env.local. Nothing was seeded.');
  console.error('');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const existing = await prisma.smoke.count();

  if (existing > 0) {
    console.log(`_smoke already holds ${existing} row(s). Nothing inserted.`);
  } else {
    const row = await prisma.smoke.create({ data: { note: 'unit B1.3 smoke row' } });
    console.log(`Inserted one row into _smoke (id ${row.id}).`);
  }
} finally {
  await prisma.$disconnect();
}

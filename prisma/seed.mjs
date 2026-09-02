// Seeds the staging database. Run with `pnpm db:seed`.
//
// Empty on purpose. Unit B1.3 used this to insert one row into the throwaway
// _smoke table; that table was dropped in migration 3, so there is nothing to
// seed yet. The file stays, wired up and working, ready for the B2 location
// tables.
//
// Seed data is generated and fake. Real farmer data exists in production only,
// and never reaches staging or a local machine.

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
  await prisma.$connect();
  console.log('Nothing to seed yet. The schema has no models.');
} finally {
  await prisma.$disconnect();
}

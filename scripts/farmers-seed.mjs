import { PrismaClient } from '@prisma/client';
import { makePrisma } from './locations-lib.mjs';
import { seedFarmers } from './farmers-seed-lib.mjs';

/** Command-line wrapper. The logic, and its test, live in farmers-seed-lib.mjs. */
const prisma = makePrisma(PrismaClient);
const result = await seedFarmers(prisma);
if (result.refused) {
  console.error(result.reason);
  console.error('Create one with POST /api/officers as an administrator, then run this again.');
  await prisma.$disconnect();
  process.exit(1);
}
console.log(
  `*** PLACEHOLDER FARMERS: ${result.inserted} inserted, ${result.skipped} already present. Every row is invented. ***`,
);
await prisma.$disconnect();

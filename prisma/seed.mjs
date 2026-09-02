// Seeds the location hierarchy into staging. Run with `pnpm db:seed`.
//
// Unit B2, criteria C-2.1 and C-2.2. Idempotent: safe to run repeatedly.
//
// Seed data is generated or reference data and never real farmer data. Real
// farmer data exists in production only -- CLAUDE.md, "Personal data".

import { PrismaClient } from '@prisma/client';

import {
  PLACEHOLDER_BANNER,
  SOURCE_CSV,
  loadSource,
  makePrisma,
  toTree,
} from '../scripts/locations-lib.mjs';

const prisma = makePrisma(PrismaClient);

const { placeholder, rows } = loadSource();
const tree = toTree(rows);

if (placeholder) {
  console.log('');
  console.log(PLACEHOLDER_BANNER);
  console.log('');
  console.log('  These are best-knowledge names and INVENTED codes. They are not');
  console.log('  CORWADO source data and will not match the administrative boundary');
  console.log('  lists due under Inception Report input I-07.');
  console.log('');
  console.log(`  To replace them, put the real list at:`);
  console.log(`    ${SOURCE_CSV}`);
  console.log('  then run:  pnpm locations:reseed');
  console.log('');
}

// Upsert rather than insert, so seeding twice is not an error and so an
// existing row is never disturbed by a re-run.
for (const s of tree.states) {
  await prisma.state.upsert({ where: { id: s.id }, update: { name: s.name }, create: s });
}
for (const c of tree.counties) {
  await prisma.county.upsert({
    where: { id: c.id },
    update: { name: c.name, stateId: c.state_id },
    create: { id: c.id, name: c.name, stateId: c.state_id },
  });
}
for (const p of tree.payams) {
  await prisma.payam.upsert({
    where: { id: p.id },
    update: { name: p.name, countyId: p.county_id, stateId: p.state_id },
    create: { id: p.id, name: p.name, countyId: p.county_id, stateId: p.state_id },
  });
}

console.log(
  `Seeded ${tree.states.length} states, ${tree.counties.length} counties, ${tree.payams.length} payams` +
    (placeholder ? '  [PLACEHOLDER]' : ''),
);

await prisma.$disconnect();

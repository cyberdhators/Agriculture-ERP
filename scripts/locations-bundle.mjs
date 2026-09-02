// Builds the offline location bundle. Unit B2, C-2.4.
//
//   pnpm locations:bundle
//
// Produces one JSON file holding the whole hierarchy, with a version identifier
// that changes when, and only when, the content changes, and records that
// identifier in the database so a device can ask whether it has changed (C-2.5,
// whose route is B3's).
//
// Reads the ACTIVE views, so a soft-deleted location is in no bundle.

import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { makePrisma, readLiveTree, versionOf } from './locations-lib.mjs';

const OUT_DIR = process.argv[2] ?? '.local/bundle';
const prisma = makePrisma(PrismaClient);

const tree = await readLiveTree(prisma);
const version = versionOf(tree);
const builtAt = new Date();

const bundle = {
  version,
  built_at: builtAt.toISOString(),
  states: tree.states,
  counties: tree.counties,
  payams: tree.payams,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = `${OUT_DIR}/locations.json`;
writeFileSync(outPath, JSON.stringify(bundle, null, 2));

await prisma.locationBundle.upsert({
  where: { id: 1 },
  update: {
    version,
    builtAt,
    stateCount: tree.states.length,
    countyCount: tree.counties.length,
    payamCount: tree.payams.length,
  },
  create: {
    id: 1,
    version,
    builtAt,
    stateCount: tree.states.length,
    countyCount: tree.counties.length,
    payamCount: tree.payams.length,
  },
});

console.log(`Bundle written to ${outPath}`);
console.log(`  version  ${version}`);
console.log(
  `  contents ${tree.states.length} states, ${tree.counties.length} counties, ${tree.payams.length} payams`,
);

await prisma.$disconnect();

// Reseeds the location hierarchy from an updated source. Unit B2, C-2.6/C-2.7.
//
//   pnpm locations:reseed            report only, writes nothing
//   pnpm locations:reseed --apply    write the changes
//
// What it does:
//   - adds locations present in the source and absent from the database
//   - updates names that have changed
//   - leaves every unchanged row untouched (C-2.6)
//   - REFUSES to remove any location another record depends on, changes
//     nothing, and names what it refused and why (C-2.7)
//
// Removal is SOFT deletion, per the deletion law in CLAUDE.md and the note in
// scope-and-acceptance C-2. A location code is therefore never reused: the
// soft-deleted row still holds it.

import { writeFileSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import {
  PLACEHOLDER_BANNER,
  dependantsOf,
  loadSource,
  makePrisma,
  readLiveTree,
  toTree,
} from './locations-lib.mjs';

const APPLY = process.argv.includes('--apply');
const prisma = makePrisma(PrismaClient);

const { placeholder, rows } = loadSource();
const source = toTree(rows);
const live = await readLiveTree(prisma);

const LEVELS = [
  { name: 'state', model: 'state', src: source.states, cur: live.states },
  { name: 'county', model: 'county', src: source.counties, cur: live.counties },
  { name: 'payam', model: 'payam', src: source.payams, cur: live.payams },
];

const plan = { added: [], renamed: [], removable: [], refused: [] };

for (const level of LEVELS) {
  const srcById = new Map(level.src.map((r) => [r.id, r]));
  const curById = new Map(level.cur.map((r) => [r.id, r]));

  for (const [id, row] of srcById) {
    const current = curById.get(id);
    if (!current) plan.added.push({ level: level.name, id, name: row.name });
    else if (current.name !== row.name)
      plan.renamed.push({ level: level.name, id, from: current.name, to: row.name });
  }

  for (const [id, row] of curById) {
    if (srcById.has(id)) continue;
    const dependants = await dependantsOf(prisma, level.model, id);
    if (dependants.length > 0)
      plan.refused.push({ level: level.name, id, name: row.name, dependants });
    else plan.removable.push({ level: level.name, id, name: row.name });
  }
}

// ---- The summary is printed BEFORE anything is written. --------------------

console.log('');
if (placeholder) console.log(PLACEHOLDER_BANNER + '\n');
console.log(`RESEED PLAN${APPLY ? '' : '  (report only -- pass --apply to write)'}`);
console.log('  added       ', plan.added.length);
console.log('  renamed     ', plan.renamed.length);
console.log('  would remove', plan.removable.length);
console.log('  REFUSED     ', plan.refused.length);
console.log('');

for (const a of plan.added) console.log(`  + ${a.level} ${a.id}  ${a.name}`);
for (const r of plan.renamed) console.log(`  ~ ${r.level} ${r.id}  "${r.from}" -> "${r.to}"`);
for (const r of plan.removable) console.log(`  - ${r.level} ${r.id}  ${r.name}`);

if (plan.refused.length > 0) {
  console.log('');
  console.log('REFUSED TO REMOVE -- these locations have records attached:');
  for (const r of plan.refused) {
    const why = r.dependants.map((d) => `${d.count} row(s) in ${d.table}.${d.column}`).join(', ');
    console.log(`  ! ${r.level} ${r.id}  ${r.name}`);
    console.log(`      because ${why}`);
  }
  console.log('');
  console.log('Nothing has been changed. Remove or repoint those records first,');
  console.log('or restore these locations to the source and run again.');
}

// ---- Write, all or nothing. ------------------------------------------------

if (APPLY) {
  if (plan.refused.length > 0) {
    console.log('\nNOT APPLIED. The refusals above must be resolved first.');
  } else {
    await prisma.$transaction(
      async (tx) => {
        for (const s of source.states)
          await tx.state.upsert({ where: { id: s.id }, update: { name: s.name }, create: s });
        for (const c of source.counties)
          await tx.county.upsert({
            where: { id: c.id },
            update: { name: c.name, stateId: c.state_id },
            create: { id: c.id, name: c.name, stateId: c.state_id },
          });
        for (const p of source.payams)
          await tx.payam.upsert({
            where: { id: p.id },
            update: { name: p.name, countyId: p.county_id, stateId: p.state_id },
            create: { id: p.id, name: p.name, countyId: p.county_id, stateId: p.state_id },
          });
        const now = new Date();
        for (const r of plan.removable) {
          await tx[r.level].update({ where: { id: r.id }, data: { deletedAt: now } });
        }
      },
      // The default interactive-transaction budget is 5 seconds. A full reseed is
      // dozens of round trips, and this link averages seconds per round trip, so
      // the default closes the transaction mid-write and Prisma reports P2028.
      // The budget has to match the work and the latency, not the other way
      // round. See the known condition in docs/PROJECT-STATE.md.
      { maxWait: 30_000, timeout: 300_000 },
    );
    console.log('\nApplied.');
  }
}

// ---- A record of what happened, until B4 gives us audit_event. -------------
//
// The audit law requires every create, update and delete to append an
// audit_event row. That table does not exist until B4, so this file is the
// stopgap and B4 has an opening task to replace it. See docs/DECISIONS.md.

mkdirSync('.local/reseed', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = `.local/reseed/${stamp}${APPLY ? '-applied' : '-report'}.json`;
writeFileSync(
  logPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      applied: APPLY && plan.refused.length === 0,
      placeholder,
      plan,
    },
    null,
    2,
  ),
);
console.log(`\nSummary written to ${logPath}`);

await prisma.$disconnect();

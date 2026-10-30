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
    // SET-BASED, not row by row (2026-10-30). The national list is about 600
    // places; one upsert and one audit row per place was some 1,150 round
    // trips, and on this link the transaction ran past its 300-second budget
    // and rolled back (P2028, nothing written). Each level is now one
    // statement over arrays, so the whole reseed is a handful of round trips
    // and stays all or nothing. Unchanged rows are still left untouched
    // (C-2.6): the update fires only where a name or parent differs.
    const col = (rows, key) => rows.map((r) => r[key]);
    const now = new Date();
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.state (id, name)
           SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
           WHERE public.state.name IS DISTINCT FROM EXCLUDED.name`,
          col(source.states, 'id'),
          col(source.states, 'name'),
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.county (id, name, state_id)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, state_id = EXCLUDED.state_id
           WHERE (public.county.name, public.county.state_id)
                 IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.state_id)`,
          col(source.counties, 'id'),
          col(source.counties, 'name'),
          col(source.counties, 'state_id'),
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO public.payam (id, name, county_id, state_id)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name, county_id = EXCLUDED.county_id, state_id = EXCLUDED.state_id
           WHERE (public.payam.name, public.payam.county_id, public.payam.state_id)
                 IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.county_id, EXCLUDED.state_id)`,
          col(source.payams, 'id'),
          col(source.payams, 'name'),
          col(source.payams, 'county_id'),
          col(source.payams, 'state_id'),
        );
        for (const level of ['state', 'county', 'payam']) {
          const ids = plan.removable.filter((r) => r.level === level).map((r) => r.id);
          if (ids.length === 0) continue;
          await tx.$executeRawUnsafe(
            `UPDATE public.${level} SET deleted_at = $2::timestamptz WHERE id = ANY($1::text[])`,
            ids,
            now.toISOString(),
          );
        }

        // ---- AUDIT ROWS, inside this same transaction (C-4.4). ------------
        //
        // The reseed has no principal, so the actor is `system` (C-4.3). This
        // script cannot import writeAudit from apps/web -- the bare package
        // specifier does not resolve from scripts/ -- so it writes the same
        // INSERT under the same rules: inside the transaction, action keys from
        // the fixed set, changed fields only. The database's CHECK refuses any
        // key not in AUDIT_ACTIONS, so the two cannot drift silently. One
        // statement for all of them, for the reason above.
        //
        // Runs before B4 merged wrote no rows. That gap is recorded in
        // docs/DECISIONS.md and is not backfilled.
        const audits = [
          ...plan.added.map((a) => [a.level, a.id, 'location.created', null, { name: a.name }]),
          ...plan.renamed.map((r) => [
            r.level,
            r.id,
            'location.renamed',
            { name: r.from },
            { name: r.to },
          ]),
          ...plan.removable.map((r) => [
            r.level,
            r.id,
            'location.soft_deleted',
            { deleted_at: null },
            { deleted_at: now.toISOString() },
          ]),
        ];
        if (audits.length > 0) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.audit_event
               (entity_type, entity_id, actor_type, actor_id, action, before, after)
             SELECT t, i, 'system', NULL, a, b::jsonb, f::jsonb
               FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
                    WITH ORDINALITY AS u(t, i, a, b, f, n)
              ORDER BY n`,
            audits.map((x) => x[0]),
            audits.map((x) => x[1]),
            audits.map((x) => x[2]),
            audits.map((x) => (x[3] === null ? null : JSON.stringify(x[3]))),
            audits.map((x) => JSON.stringify(x[4])),
          );
        }
      },
      // The default interactive-transaction budget is 5 seconds; this link
      // averages seconds per round trip, so the budget stays generous.
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

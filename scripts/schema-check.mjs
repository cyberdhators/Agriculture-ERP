// pnpm schema:check -- does prisma/schema.prisma still describe the database?
//
// WHY THIS EXISTS. For eight days the schema file was silently wrong about
// three tables, three enums and three columns: B8, B10 and B11 each wrote a
// hand-written SQL migration and never added the model. Nothing noticed,
// because every one of those tables is read with raw SQL, so the generated
// client was never consulted. A schema file that does not describe the schema
// is a document that lies, and `prisma db push` reads it as intent.
//
// This is a GATE THAT COMPARES (docs/PROJECT-STATE.md): two sources that move
// independently -- the live database and the model file -- and it goes red by
// itself when either moves alone. It asserts nothing about what the schema
// contains; it asks Prisma for the difference and judges the difference.
//
// It is READ-ONLY. `migrate diff` opens a connection, reads the catalogue and
// prints SQL. It never executes anything.
//
// THE KNOWN RESIDUE. Prisma cannot express four kinds of object that this
// database legitimately has, so a clean run is not an empty diff -- it is a
// diff containing only these. They are listed by name rather than by pattern
// so that a NEW one is a failure and not a silently widened exception.

import { spawnSync } from 'node:child_process';

import { envLocalPath, loadEnvLocal, resolveLocalBin } from './load-env.mjs';

/** GiST indexes on `Unsupported` columns. Prisma has no syntax for either. */
const EXPECTED_DROPPED_INDEXES = [
  'directory_entry_location_gist_idx',
  'farm_boundary_boundary_gist_idx',
  'farm_boundary_centroid_gist_idx',
  'visit_position_gist_idx',
];

/**
 * Foreign keys Prisma cannot restate. Two shapes:
 *   - `*_deleted_by_fkey` on tables whose model carries the column without a
 *     relation field (it would add a back-relation to User for no reader).
 *   - the SECOND composite consistency key, and the simple `payam_id` key
 *     beside it: Prisma allows one relation per field set, so `farm`, `farmer`
 *     and `visit` each keep one and the migrations keep the rest.
 */
const EXPECTED_UNRESTORED_FKS = [
  'county_deleted_by_fkey',
  'farm_payam_county_consistent_fkey',
  'farm_payam_id_fkey',
  'farmer_deleted_by_fkey',
  'farmer_payam_county_consistent_fkey',
  'farmer_payam_id_fkey',
  'officer_deleted_by_fkey',
  'officer_payam_id_fkey',
  'payam_deleted_by_fkey',
  'state_deleted_by_fkey',
  'user_deleted_by_fkey',
  'visit_payam_county_consistent_fkey',
  'visit_payam_id_fkey',
];

/**
 * Statements that mean the model file and the database disagree about a table,
 * a column or an enum.
 *
 * MATCHED AGAINST THE SQL, NOT AGAINST PRISMA'S `-- Label` COMMENTS. The first
 * version of this script matched the labels, and reported "columns match" while
 * a column was genuinely unmodelled: Prisma labels a column change `AlterTable`
 * and puts the DROP COLUMN inside it. That is the third pattern (a check
 * pointed at the wrong thing, docs/PROJECT-STATE.md) in the gate written to
 * prevent the same family of fault, found by proving the gate fails rather
 * than by trusting that it passes.
 */
const STRUCTURAL_SQL = [
  [/\bCREATE TABLE\b/gi, 'create a table'],
  [/\bDROP TABLE\b/gi, 'drop a table'],
  [/\bCREATE TYPE\b/gi, 'create an enum'],
  [/\bDROP TYPE\b/gi, 'drop an enum'],
  [/\bADD COLUMN\b/gi, 'add a column'],
  [/\bDROP COLUMN\b/gi, 'drop a column'],
  [/\bALTER COLUMN\b/gi, 'alter a column'],
  [/\bCREATE (?:UNIQUE )?INDEX\b/gi, 'create an index'],
  [/\bADD VALUE\b/gi, 'add an enum value'],
  [/\bRENAME\b/gi, 'rename something'],
];

const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error(`\nschema:check needs .env.local (expected at ${envLocalPath}).\n`);
  process.exit(1);
}

const result = spawnSync(
  resolveLocalBin('prisma'),
  [
    'migrate',
    'diff',
    '--from-schema-datasource',
    'prisma/schema.prisma',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8', env: process.env },
);

if (result.status !== 0) {
  console.error('\nschema:check could not read the database. Nothing was changed.\n');
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const sql = result.stdout ?? '';
const named = (re) => [...sql.matchAll(re)].map((m) => m[1]);

/** [description, count] for every structural statement the diff would run. */
const structural = STRUCTURAL_SQL.map(([re, what]) => [what, (sql.match(re) ?? []).length]).filter(
  ([, n]) => n > 0,
);
const droppedIndexes = named(/DROP INDEX "([a-z_]+)"/g);
const droppedFks = named(/DROP CONSTRAINT "([a-z_]+)"/g);
const addedFks = named(/ADD CONSTRAINT "([a-z_]+)"/g);
const unrestored = droppedFks.filter((f) => !addedFks.includes(f));

const unexpectedIndexes = droppedIndexes.filter((i) => !EXPECTED_DROPPED_INDEXES.includes(i));
const unexpectedFks = unrestored.filter((f) => !EXPECTED_UNRESTORED_FKS.includes(f));
const vanishedIndexes = EXPECTED_DROPPED_INDEXES.filter((i) => !droppedIndexes.includes(i));

const problems = [];
if (structural.length > 0) {
  problems.push(
    `The model file does not describe the database. Prisma would ${structural
      .map(([what, n]) => `${what} x${n}`)
      .join(', ')}.`,
  );
}
for (const i of unexpectedIndexes) {
  problems.push(`Index "${i}" exists in the database and is not in the model file.`);
}
for (const f of unexpectedFks) {
  problems.push(`Foreign key "${f}" exists in the database and Prisma does not restate it.`);
}

console.log('');
console.log('schema:check -- prisma/schema.prisma against the live database');
console.log('');
console.log(
  `  tables, columns, enums, relations : ${structural.length === 0 ? 'match' : 'DIFFER'}`,
);
console.log(
  `  known residue                     : ${droppedIndexes.length} index(es), ${unrestored.length} foreign key(s) Prisma cannot express`,
);

if (vanishedIndexes.length > 0) {
  console.log('');
  console.log('  NOTE: these were expected in the residue and are not there. If an');
  console.log('  index was deliberately removed, drop it from this script too:');
  for (const i of vanishedIndexes) console.log(`    - ${i}`);
}

if (problems.length === 0) {
  console.log('');
  console.log('  PASS. Every table, column, enum and relation is modelled.');
  console.log('');
  process.exit(0);
}

console.error('');
console.error('  FAIL:');
for (const p of problems) console.error(`    - ${p}`);
console.error('');
console.error('  A model is missing, or a migration added something the model file');
console.error('  does not mention. Add the model -- do NOT run `prisma db push` to');
console.error('  make this pass: it would drop whatever is unmodelled. See the');
console.error('  header of prisma/schema.prisma.');
console.error('');
process.exit(1);

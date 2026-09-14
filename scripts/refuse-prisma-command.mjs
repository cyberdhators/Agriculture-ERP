// Refuses `pnpm db:push` and `pnpm db:migrate-dev`, with the reason.
//
// These two scripts exist ONLY to refuse. A reader looking for the command
// that syncs the schema finds one here and is told why not to want it, which
// is cheaper than finding out from the database. Neither is a security
// boundary: `npx prisma db push` still works and nothing can stop it. The
// guard is against not knowing, not against determination.

const WHAT = {
  'db-push': {
    command: 'prisma db push',
    why: [
      'It reads prisma/schema.prisma as the intended state and makes the',
      'database match. Anything in the database that the model file does not',
      'mention is DROPPED. On 2026-09-13 that was three tables, three enums,',
      'three columns, four spatial indexes and twenty-four foreign keys, and',
      'it would have failed part-way -- after the foreign keys were gone --',
      'because a view blocks the table drop.',
      '',
      'Prisma also cannot express partial indexes, GiST indexes, CHECK',
      'constraints, triggers or views, so it drops those every time even when',
      'every model is correct. This database has all five.',
    ],
    instead: [
      'Write a migration:  prisma/migrations/<timestamp>_<name>/migration.sql',
      'Apply it:           pnpm db:migrate   (prisma migrate deploy)',
      'Check the models still describe the database: pnpm schema:check',
    ],
  },
  'migrate-dev': {
    command: 'prisma migrate dev',
    why: [
      'It needs a shadow database, which it creates itself. The Supabase',
      '`postgres` role cannot create databases, so the command times out or',
      'fails outright. That failure is expected and is not worth chasing.',
      '',
      'It also offers to reset the database when it finds drift, and this',
      'database always has drift by design: the objects Prisma cannot express.',
    ],
    instead: [
      'Write the SQL by hand and apply it with pnpm db:migrate.',
      'See the header of prisma/schema.prisma.',
    ],
  },
};

const which = process.argv[2];
const entry = WHAT[which];
if (!entry) {
  console.error(`refuse-prisma-command: unknown command "${which}".`);
  process.exit(1);
}

const line = '='.repeat(70);
console.error('');
console.error(line);
console.error(`  REFUSING: ${entry.command} is not used on this project`);
console.error(line);
console.error('');
for (const l of entry.why) console.error(`  ${l}`);
console.error('');
console.error('  Instead:');
console.error('');
for (const l of entry.instead) console.error(`    ${l}`);
console.error('');
console.error('  Nothing was changed. No connection was opened.');
console.error('');
process.exit(1);

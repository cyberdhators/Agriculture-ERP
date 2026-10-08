// pnpm db:reset -- DESTRUCTIVE. NON-PRODUCTION PROJECTS ONLY.
//
// Drops every table, recreates the database, and re-applies all migrations.
// Everything in the target database is lost.
//
// It refuses to run unless BOTH connection strings positively identify a
// project on the closed allowlist in scripts/non-production-projects.mjs. It
// does not try to recognise production. It holds no project reference of its
// own and must never be given one. Anything it cannot positively match against
// the allowlist is refused. The allowlist is empty today, so it refuses every
// target, which is the safe state (docs/DECISIONS.md, "Staging is production").
//
// THE ALLOWLIST IS A COMMITTED LITERAL, ON PURPOSE. A guard that reads its
// expected value from the same .env.local it is checking is not a guard -- it
// would approve whatever it was pointed at. A project reference is not a secret;
// the connection strings that contain it are, and those stay in .env.local.
//
// No connection string, or any part of one, is ever printed by this script.

import { spawn } from 'node:child_process';

import { envLocalPath, loadEnvLocal, resolveLocalBin } from './load-env.mjs';
import { NON_PRODUCTION_PROJECT_REFS, namesNotAllowed } from './non-production-projects.mjs';

// ---------------------------------------------------------------------------
// The projects this script may touch come from the shared closed allowlist in
// scripts/non-production-projects.mjs: committed literals, never a runtime
// value. Anything absent from that list is refused, including a project nobody
// has classified yet. An empty list refuses everything, which is the safe state.
// ---------------------------------------------------------------------------

function refuse(headline, ...detail) {
  console.error('');
  console.error('==========================================================');
  console.error('  REFUSING TO RESET THE DATABASE');
  console.error('==========================================================');
  console.error('');
  console.error(`  ${headline}`);
  console.error('');
  for (const line of detail) console.error(`  ${line}`);
  console.error('');
  console.error('  Nothing was changed. No connection was opened.');
  console.error('');
  process.exit(1);
}

if (NON_PRODUCTION_PROJECT_REFS.length === 0) {
  refuse(
    'The allowlist of non-production projects is empty.',
    'Open scripts/non-production-projects.mjs and add the reference of a NEW',
    'disposable project known not to hold real farmer data — never the one',
    'production project. Until one is listed, this script refuses every target.',
    'That is deliberate: a reset guard that knows of no safe database must not',
    'run against any.',
  );
}

const loaded = loadEnvLocal();
if (!loaded.ok) {
  refuse(
    '.env.local does not exist, so there is nothing to check.',
    `Expected at: ${envLocalPath}`,
  );
}

const missing = ['DATABASE_URL', 'DIRECT_URL'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  refuse(
    `Not set in .env.local: ${missing.join(' and ')}.`,
    'Both connection strings must be present and both must point at a project',
    'on the non-production allowlist.',
  );
}

const mismatched = namesNotAllowed({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

if (mismatched.length > 0) {
  const verb = mismatched.length > 1 ? 'do not name' : 'does not name';
  refuse(
    `This database is not on the allowlist. ${mismatched.join(' and ')} ${verb} a project this script may reset.`,
    'Point .env.local at a project on the allowlist in',
    'scripts/non-production-projects.mjs, or do not use this script. A project',
    'absent from that list is refused whether or not it holds real data,',
    'because nobody has classified it.',
    '',
    '(The connection strings themselves are not shown here, by design.)',
  );
}

console.log('');
console.log('Target confirmed as a project on the non-production allowlist.');
console.log('This will DROP EVERYTHING in that database and re-apply migrations.');
console.log('Prisma will ask you to confirm before anything is destroyed.');
console.log('');

const child = spawn(resolveLocalBin('prisma'), ['migrate', 'reset'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error(`db:reset: could not start prisma: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});

// pnpm db:reset -- DESTRUCTIVE, STAGING ONLY.
//
// Drops every table, recreates the database, and re-applies all migrations.
// Everything in the target database is lost.
//
// It refuses to run unless BOTH connection strings positively identify the
// staging Supabase project. It does not try to recognise production. It does
// not hold the production reference and must never be given one. Anything it
// cannot positively identify as staging is refused.
//
// THE EXPECTED REFERENCE IS COMMITTED HERE ON PURPOSE. A guard that reads its
// expected value from the same .env.local it is checking is not a guard -- it
// would approve whatever it was pointed at. The project reference is not a
// secret; the connection strings that contain it are, and those stay in
// .env.local.
//
// No connection string, or any part of one, is ever printed by this script.

import { spawn } from 'node:child_process';

import { envLocalPath, loadEnvLocal, resolveLocalBin } from './load-env.mjs';

// ---------------------------------------------------------------------------
// The staging Supabase project reference. Replace the placeholder below with
// the real reference. Until that happens this script refuses everything,
// which is the safe state.
// ---------------------------------------------------------------------------
const STAGING_PROJECT_REF = 'xmmxbrxmfgodhpwolrvk';

const PLACEHOLDER = 'SET_STAGING_PROJECT_REF_HERE';

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

if (STAGING_PROJECT_REF === PLACEHOLDER) {
  refuse(
    'The staging project reference has not been set.',
    'Open scripts/db-reset.mjs and replace STAGING_PROJECT_REF with the',
    'staging Supabase project reference. Until you do, this script refuses',
    'every target, including staging. That is deliberate: a reset guard that',
    'does not know what staging looks like must not run at all.',
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
    'Both connection strings must be present and both must point at staging.',
  );
}

const mismatched = ['DATABASE_URL', 'DIRECT_URL'].filter(
  (name) => !String(process.env[name]).includes(STAGING_PROJECT_REF),
);

if (mismatched.length > 0) {
  const verb = mismatched.length > 1 ? 'do not name' : 'does not name';
  refuse(
    `This is not the staging database. ${mismatched.join(' and ')} ${verb} the staging project.`,
    `Expected the project reference "${STAGING_PROJECT_REF}" to appear in every`,
    'connection string. It does not.',
    '',
    'This script only ever runs against staging. If you meant to point at',
    'staging, fix .env.local. If you were pointing somewhere else on purpose,',
    'do not use this script.',
    '',
    '(The connection strings themselves are not shown here, by design.)',
  );
}

console.log('');
console.log(`Target confirmed as staging (project "${STAGING_PROJECT_REF}").`);
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

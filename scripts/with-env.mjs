// Runs a command with .env.local loaded into its environment.
//
// Prisma's CLI reads .env, not .env.local, and the real connection strings
// live only in .env.local. Usage:
//
//   node scripts/with-env.mjs prisma migrate deploy
//
// Values are passed through the environment and never printed.

import { spawn } from 'node:child_process';

import { envLocalPath, loadEnvLocal, resolveLocalBin } from './load-env.mjs';

const [command, ...args] = process.argv.slice(2);

if (command === undefined) {
  console.error('with-env: no command given.');
  process.exit(1);
}

const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error('');
  console.error('Cannot run this command: .env.local does not exist.');
  console.error('');
  console.error(`  Expected at: ${envLocalPath}`);
  console.error('');
  console.error('Copy .env.example to .env.local and fill in the staging');
  console.error('connection strings from the Supabase dashboard. .env.local is');
  console.error('git-ignored and its values never enter the repository.');
  console.error('');
  process.exit(1);
}

const child = spawn(resolveLocalBin(command), args, { stdio: 'inherit', env: process.env });
child.on('error', (error) => {
  console.error(`with-env: could not start "${command}": ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(signal !== null ? 1 : (code ?? 1));
});

// node --env-file=<env> scripts/weather-cron-install.mjs
//
// Installs (or replaces) the hourly weather job in the database's pg_cron
// (2026-10-08). The job calls POST <SITE_URL>/api/cron/weather through pg_net
// with "Authorization: Bearer <CRON_SECRET>". The secret is kept in Supabase
// Vault (encrypted at rest) and read by the job at run time, so it appears in
// no migration, no file in the repository and not in cron.job's command text.
//
// Needs: DATABASE_URL (or DIRECT_URL), CRON_SECRET (32+ characters), and
// optionally SITE_URL (default https://www.agrionesouthsudan.com).
// Idempotent: re-running replaces the secret and the job.

import console from 'node:console';
import process from 'node:process';

import { PrismaClient } from '@prisma/client';

import { loadEnvLocal } from './load-env.mjs';

loadEnvLocal();

const secret = process.env.CRON_SECRET ?? '';
const site = (process.env.SITE_URL ?? 'https://www.agrionesouthsudan.com').replace(/\/$/, '');
if (secret.length < 32) {
  console.error('CRON_SECRET must be set and at least 32 characters. Nothing was installed.');
  process.exit(1);
}

const JOB = 'weather-fetch-hourly';
const VAULT_NAME = 'weather_cron_secret';
const db = new PrismaClient();
try {
  await db.$transaction(async (tx) => {
    const [existing] = await tx.$queryRawUnsafe(
      'SELECT id FROM vault.secrets WHERE name = $1',
      VAULT_NAME,
    );
    if (existing) {
      await tx.$queryRawUnsafe('SELECT vault.update_secret($1::uuid, $2)', existing.id, secret);
    } else {
      await tx.$queryRawUnsafe('SELECT vault.create_secret($1, $2)', secret, VAULT_NAME);
    }

    await tx.$executeRawUnsafe(
      `SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1`,
      JOB,
    );
    const command = `
      SELECT net.http_post(
        url := '${site}/api/cron/weather',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${VAULT_NAME}')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );`;
    // Seven past every hour, like the GitHub backup; pg_cron runs on time.
    await tx.$queryRawUnsafe(`SELECT cron.schedule($1, '7 * * * *', $2)`, JOB, command);
  });
  const [job] = await db.$queryRawUnsafe(
    'SELECT jobid, schedule, active FROM cron.job WHERE jobname = $1',
    JOB,
  );
  console.log(
    `installed ${JOB}: schedule "${job.schedule}", active ${job.active}, calling ${site}/api/cron/weather`,
  );
} finally {
  await db.$disconnect();
}

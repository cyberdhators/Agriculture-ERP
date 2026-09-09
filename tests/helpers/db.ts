import { PrismaClient } from '@prisma/client';

/**
 * B5.5 — one place that decides how a test reaches staging.
 *
 * Two rules, both learned the hard way on 2026-09-05:
 *
 * 1. FAIL LOUDLY when the environment is missing. From B2 to B5 every
 *    database test file skipped itself when the variables were absent, and CI
 *    — which had no secrets — was green for eight files that never ran. A
 *    missing variable is a configuration fault, and a fault is red.
 *
 * 2. Test clients use the TRANSACTION pooler (DATABASE_URL), like the app.
 *    The session pooler (DIRECT_URL) has fifteen server slots and stopped
 *    granting connections for minutes after the concurrency tests in run 5.
 *    The session pooler is for migrations, and for the one advisory lock in
 *    vitest.global-setup.ts that must outlive a transaction.
 */
export const REQUIRED_TEST_ENV = [
  'DATABASE_URL',
  'DIRECT_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export function missingTestEnv(): string[] {
  return REQUIRED_TEST_ENV.filter((name) => (process.env[name] ?? '') === '');
}

/** Throws, naming every missing variable. Never skips. */
export function requireTestEnv(): void {
  const missing = missingTestEnv();
  if (missing.length > 0) {
    throw new Error(
      `Database tests refuse to run: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Locally: copy .env.example to .env.local and fill in the staging values. ' +
        'In CI: the STAGING_* repository secrets are mapped to these names by the workflow. ' +
        'A test that silently skips is a green result that proves nothing (B5.5).',
    );
  }
}

/** The transaction pooler URL, as normalised by vitest.config.mts. */
export function testDatabaseUrl(): string {
  requireTestEnv();
  return process.env.DATABASE_URL as string;
}

export function makeTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
}

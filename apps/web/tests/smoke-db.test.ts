import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// SKIPPED IN CI, DELIBERATELY -- read this before "fixing" it.
//
// This test talks to the staging Supabase database, so it needs DATABASE_URL.
// CI has no database credentials and must not be given any: the CI workflow
// references no repository secret at all.
//
// So the suite is skipped whenever DATABASE_URL is absent, which in CI is
// always. Locally it runs, because vitest.config.mts loads .env.local.
//
// If you are wondering why this test never appears in a pull request run:
// that is why. It is intended, not broken.
// ---------------------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('_smoke table via Prisma', () => {
  it('contains the seeded row', async () => {
    const prisma = new PrismaClient();

    try {
      const rows = await prisma.smoke.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.note).toBeTypeOf('string');
    } finally {
      await prisma.$disconnect();
    }
  });
});

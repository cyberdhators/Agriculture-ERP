import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The location hierarchy against a real database. Unit B2, C-2.1 to C-2.8.
 *
 * These skip themselves when DATABASE_URL is empty, which is the case in CI.
 * Local runs are therefore the only place these criteria are ever exercised --
 * recorded as a known gap in docs/PROJECT-STATE.md.
 *
 * The session pooler drops roughly one connection in three. There is no retry
 * logic in here on purpose: a test that retries hides the condition instead of
 * surviving it, and would hide a genuine fault behind the same silence. If one
 * of these fails on a connection error, run it again.
 */

// Every assertion here is a round trip to a remote database.
// The default 5s timeout is for pure functions, not for that. This raises the
// budget; it does NOT retry, and a genuine failure still fails.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const HAS_DB = (process.env.DATABASE_URL ?? '') !== '';
const run = HAS_DB ? describe : describe.skip;

// Session pooler, not the transaction pooler. See makePrisma in
// scripts/locations-lib.mjs for why, and docs/PROJECT-STATE.md for the
// reliability difference.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

/** Test rows use a code prefix no real location will ever have. */
const T = 'ZZTEST';

const cleanup = async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${T.toLowerCase()}_dependant"`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.payam  WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.county WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.state  WHERE id LIKE '${T}%'`);
};

beforeAll(async () => {
  if (!HAS_DB) return;
  await cleanup();
  await prisma.state.create({ data: { id: `${T}`, name: 'Test State' } });
  await prisma.state.create({ data: { id: `${T}2`, name: 'Other Test State' } });
  await prisma.county.create({ data: { id: `${T}-C1`, name: 'Test County', stateId: T } });
  await prisma.payam.create({
    data: { id: `${T}-C1-P1`, name: 'Test Payam', countyId: `${T}-C1`, stateId: T },
  });
});

afterAll(async () => {
  if (HAS_DB) await cleanup();
  await prisma.$disconnect();
});

run('the shape of the hierarchy', () => {
  it('C-2.1: has exactly three levels, each contained by the one above', async () => {
    const payam = await prisma.payam.findUniqueOrThrow({
      where: { id: `${T}-C1-P1` },
      include: { county: { include: { state: true } } },
    });

    expect(payam.county.id).toBe(`${T}-C1`);
    expect(payam.county.state.id).toBe(T);
    expect(payam.stateId).toBe(payam.county.stateId);
  });

  it('every payam resolves to a county and a state', async () => {
    const orphans = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n
       FROM public.payam_active p
       LEFT JOIN public.county_active c ON c.id = p.county_id
       LEFT JOIN public.state_active  s ON s.id = p.state_id
       WHERE c.id IS NULL OR s.id IS NULL`,
    );
    expect(orphans[0]?.n).toBe(0);
  });

  it('C-2.3: a payam whose state disagrees with its county cannot be inserted', async () => {
    // ZZTEST-C1 belongs to ZZTEST, so claiming ZZTEST2 is a contradiction.
    await expect(
      prisma.payam.create({
        data: { id: `${T}-C1-BAD`, name: 'Impossible', countyId: `${T}-C1`, stateId: `${T}2` },
      }),
    ).rejects.toThrow();
  });

  it('C-2.3: the rule is enforced on update as well as on insert', async () => {
    await expect(
      prisma.payam.update({ where: { id: `${T}-C1-P1` }, data: { stateId: `${T}2` } }),
    ).rejects.toThrow();
  });

  it('C-2.3 is enforced by the database, not remembered by the application', async () => {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_constraint
       WHERE conname = 'payam_county_state_consistent_fkey' AND contype = 'f'`,
    );
    expect(n).toBe(1);
  });
});

run('soft deletion and the active views', () => {
  it('a soft-deleted payam appears in no active view', async () => {
    const id = `${T}-C1-SD`;
    await prisma.payam.create({
      data: { id, name: 'Soon Deleted', countyId: `${T}-C1`, stateId: T },
    });

    const before = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.payam_active WHERE id = $1`,
      id,
    );
    expect(before[0]?.n).toBe(1);

    await prisma.payam.update({ where: { id }, data: { deletedAt: new Date() } });

    const after = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.payam_active WHERE id = $1`,
      id,
    );
    expect(after[0]?.n).toBe(0);

    // The row is still there. Soft delete only -- the code is never reused.
    const base = await prisma.payam.findUnique({ where: { id } });
    expect(base?.deletedAt).not.toBeNull();
  });

  it('every active view reads through security_invoker, so RLS still applies', async () => {
    const views = await prisma.$queryRawUnsafe<{ view_name: string; invoker_on: boolean }[]>(
      `SELECT c.relname AS view_name,
              'security_invoker=true' = ANY(COALESCE(c.reloptions,'{}')) AS invoker_on
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v' AND c.relname LIKE '%_active'`,
    );
    // Every _active view in the database, not only B2's: a later unit that
    // adds one without security_invoker fails here too (P1 added two).
    expect(views.map((v) => v.view_name)).toEqual(
      expect.arrayContaining(['state_active', 'county_active', 'payam_active']),
    );
    for (const v of views) expect(v.invoker_on, `${v.view_name} bypasses RLS`).toBe(true);
  });

  it('row-level security is enabled on every location table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND relname IN ('state','county','payam','location_bundle')`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} has RLS off`).toBe(true);
  });
});

run('names are kept exactly as supplied', () => {
  it('C-2.8: a name in non-Latin script survives a round trip unchanged', async () => {
    // Arabic for Juba and Munuki. Arabi Juba is a language CORWADO uses.
    const arabic = 'جوبا';
    const id = `${T}-C1-AR`;
    await prisma.payam.create({
      data: { id, name: arabic, countyId: `${T}-C1`, stateId: T },
    });

    const read = await prisma.payam.findUniqueOrThrow({ where: { id } });
    expect(read.name).toBe(arabic);
    expect([...read.name]).toEqual([...arabic]);

    const viaView = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM public.payam_active WHERE id = $1`,
      id,
    );
    expect(viaView[0]?.name).toBe(arabic);

    await prisma.payam.delete({ where: { id } });
  });

  it('a name with combining marks and mixed scripts is not normalised', async () => {
    const mixed = 'Yéi — منوكي';
    const id = `${T}-C1-MX`;
    await prisma.payam.create({ data: { id, name: mixed, countyId: `${T}-C1`, stateId: T } });
    const read = await prisma.payam.findUniqueOrThrow({ where: { id } });
    expect(read.name).toBe(mixed);
    expect(read.name.length).toBe(mixed.length);
    await prisma.payam.delete({ where: { id } });
  });
});

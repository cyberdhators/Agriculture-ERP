import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM script, typed loosely on purpose
import { PLACEHOLDER_FAMILY, seedFarmerId, seedFarmers } from '../scripts/farmers-seed-lib.mjs';
import { createPrincipal, deleteAccount, sweep } from './helpers/principals';
import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * The fabricated seed, both directions (C-5.14, C-5.1):
 *   - with only a test officer present it REFUSES and writes nothing;
 *   - with a real officer present it inserts, and a second run skips.
 * The "real" officer here is one this file creates and removes itself, named
 * so that it is not a `zztest` principal — the seed must not be able to tell
 * it from a real one.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const run = describe;
const prisma = makeTestPrisma();
const PAYAM = 'CE-JUB-KAT';
const REAL_NAME = 'Seed check officer (fabricated)';
let realOfficerId = '';
let realAuthUserId = '';

const removeSeedRows = async () => {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `DELETE FROM public.consent WHERE farmer_id IN (SELECT id FROM public.farmer WHERE family_name = $1)`,
      PLACEHOLDER_FAMILY,
    ),
    prisma.$executeRawUnsafe(
      `DELETE FROM public.farmer WHERE family_name = $1`,
      PLACEHOLDER_FAMILY,
    ),
  ]);
};
const removeRealOfficer = async () => {
  if (!realOfficerId) return;
  await prisma.$executeRawUnsafe(`DELETE FROM public.officer WHERE id = $1::uuid`, realOfficerId);
  await deleteAccount(realAuthUserId);
  realOfficerId = '';
};

beforeAll(async () => {
  await sweep(prisma);
  await removeSeedRows();
});
afterAll(async () => {
  {
    await removeSeedRows();
    await removeRealOfficer();
    await sweep(prisma);
  }
  await prisma.$disconnect();
});

run('the fabricated farmer seed', () => {
  it('refuses when the only active officer in a placeholder payam is a test officer, and writes nothing', async () => {
    await createPrincipal(prisma, 'officer', { payamId: PAYAM });
    const before = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE family_name = $1',
      PLACEHOLDER_FAMILY,
    );
    const result = (await seedFarmers(prisma, { payams: [PAYAM] })) as { refused: boolean };
    expect(result.refused).toBe(true);
    const after = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE family_name = $1',
      PLACEHOLDER_FAMILY,
    );
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
  });

  it('inserts twelve when a non-test officer exists, registered by that officer, and a second run skips them all', async () => {
    // A non-test officer, made the way createPrincipal makes one but with a
    // name the seed cannot distinguish from a real account.
    const test = await createPrincipal(prisma, 'officer', { payamId: PAYAM });
    realAuthUserId = test.authUserId;
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE public.officer SET name = $2 WHERE id = $1::uuid RETURNING id`,
      test.id,
      REAL_NAME,
    );
    realOfficerId = row!.id;

    const first = (await seedFarmers(prisma, { payams: [PAYAM] })) as {
      refused: boolean;
      inserted: number;
      skipped: number;
      officerId: string;
    };
    expect(first.refused).toBe(false);
    expect(first.inserted).toBe(12);
    expect(first.officerId).toBe(realOfficerId);
    const [check] = await prisma.$queryRawUnsafe<{ n: bigint; by: string }[]>(
      `SELECT count(*) AS n, min(registered_by::text) AS by FROM public.farmer WHERE id = $1::uuid OR family_name = $2`,
      seedFarmerId(1),
      PLACEHOLDER_FAMILY,
    );
    expect(Number(check?.n)).toBe(12);
    expect(check?.by).toBe(realOfficerId);

    const second = (await seedFarmers(prisma, { payams: [PAYAM] })) as {
      inserted: number;
      skipped: number;
    };
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(12);
    expect(randomUUID()).not.toBe(seedFarmerId(1));
  });
});

import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * A `SELECT *` view freezes its column list at creation (found 2026-09-05,
 * B6 run 1: farmer_active lacked pending_since and every farmer query
 * failed). Every _active view must carry exactly its table's columns, in
 * order; farmer_verified_v likewise. Both directions: a column missing from
 * the view and a column only in the view both fail here.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
requireTestEnv();
const prisma = makeTestPrisma();
afterAll(async () => prisma.$disconnect());

const columnsOf = async (relation: string): Promise<string[]> =>
  (
    await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      relation,
    )
  ).map((r) => r.column_name);

describe('every active view carries exactly its table’s columns', () => {
  it('lists the views and compares each to its table', async () => {
    const views = (
      await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.views
         WHERE table_schema = 'public' AND (table_name LIKE '%\\_active' OR table_name = 'farmer_verified_v')`,
      )
    ).map((r) => r.table_name);
    expect(views.length).toBeGreaterThanOrEqual(6);
    for (const view of views) {
      const table = view === 'farmer_verified_v' ? 'farmer' : view.replace(/_active$/, '');
      expect(await columnsOf(view), `${view} vs ${table}`).toEqual(await columnsOf(table));
    }
  });
});

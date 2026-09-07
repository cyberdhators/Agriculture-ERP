import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeTestPrisma, requireTestEnv } from './helpers/db';

/**
 * STANDING RULE (docs/DECISIONS.md, "A view is a filter of its table, and
 * carries every column of it"): a `SELECT *` view freezes its column list
 * when it is created, so a column added to the table later is invisible
 * through the view until the view is recreated. B6 lost a full run to that.
 *
 * This test discovers every view in the public schema whose name begins with
 * the name of a table — `farmer_active`, `farmer_verified_v`, and whatever
 * B7, B8 and B10 add — and requires its columns to equal the table's, in
 * order, both directions. A view that deliberately projects a subset must
 * not be named after its table; an aggregate belongs under another name.
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

describe('every view named after a table carries exactly that table’s columns', () => {
  it('discovers the views, pairs each with its table by longest name prefix, and compares', async () => {
    const tables = (
      await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
      )
    ).map((r) => r.table_name);
    const views = (
      await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
      )
    ).map((r) => r.table_name);
    expect(views.length).toBeGreaterThanOrEqual(9);
    const paired: [string, string][] = [];
    for (const view of views) {
      const table = tables
        .filter((t) => view === t || view.startsWith(`${t}_`))
        .sort((a, b) => b.length - a.length)[0];
      if (table) paired.push([view, table]);
    }
    // A view named after a table is a whole-table filter and must pair. A view
    // NOT named after any table is an aggregate or a subset by convention
    // (B7: area_totals_v) and is exempt — the rule is about the name.
    const unpaired = views.filter((v) => !paired.some(([pv]) => pv === v));
    for (const v of unpaired) {
      expect(
        tables.some((t) => v.startsWith(t)),
        `${v} looks table-named but paired with nothing`,
      ).toBe(false);
    }
    for (const [view, table] of paired) {
      expect(
        await columnsOf(view),
        `${view} must carry every column of ${table}, in order`,
      ).toEqual(await columnsOf(table));
    }
  });
});

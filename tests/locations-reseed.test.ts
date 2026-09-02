import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The reseed procedure. Unit B2, C-2.6 and C-2.7.
 *
 * The reseed works on the WHOLE hierarchy, so every source file here is built
 * from the live tree and then modified. Handing it a source containing only
 * test rows would ask it to remove every real location.
 *
 * Skips itself when DATABASE_URL is empty (CI). No retry logic: see the note in
 * tests/locations.test.ts.
 */

// Each reseed spawns a subprocess that opens its own connection.
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
const exec = promisify(execFile);
const T = 'ZZRESEED';
const DEP_TABLE = 'zzreseed_dependant';

interface Row {
  id: string;
  name: string;
  county_id?: string;
  state_id?: string;
}

/** The live hierarchy as a source CSV, so a reseed of it is a no-op. */
async function liveAsCsv(): Promise<string[]> {
  const states = await prisma.$queryRawUnsafe<Row[]>(
    'SELECT id, name FROM public.state_active ORDER BY id',
  );
  const counties = await prisma.$queryRawUnsafe<Row[]>(
    'SELECT id, name, state_id FROM public.county_active ORDER BY id',
  );
  const payams = await prisma.$queryRawUnsafe<Row[]>(
    'SELECT id, name, county_id, state_id FROM public.payam_active ORDER BY id',
  );
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    'level,id,name,county_id,state_id',
    ...states.map((s) => `state,${s.id},${q(s.name)},,`),
    ...counties.map((c) => `county,${c.id},${q(c.name)},,${c.state_id}`),
    ...payams.map((p) => `payam,${p.id},${q(p.name)},${p.county_id},${p.state_id}`),
  ];
}

/** Runs the reseed against a given source. Returns its output. */
async function reseed(lines: string[], apply: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'b2-reseed-'));
  const csv = join(dir, 'locations.csv');
  writeFileSync(csv, lines.join('\n') + '\n');
  const args = ['scripts/locations-reseed.mjs', ...(apply ? ['--apply'] : [])];
  const { stdout } = await exec('node', args, {
    env: { ...process.env, LOCATIONS_CSV: csv },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

const activeCount = async (id: string): Promise<number> => {
  const r = await prisma.$queryRawUnsafe<{ n: number }[]>(
    'SELECT count(*)::int AS n FROM public.payam_active WHERE id = $1',
    id,
  );
  return r[0]?.n ?? 0;
};

const cleanup = async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS public."${DEP_TABLE}"`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.payam  WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.county WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.state  WHERE id LIKE '${T}%'`);
};

beforeAll(async () => {
  if (!HAS_DB) return;
  await cleanup();
  await prisma.state.create({ data: { id: T, name: 'Reseed State' } });
  await prisma.county.create({ data: { id: `${T}-C`, name: 'Reseed County', stateId: T } });
  await prisma.payam.create({
    data: { id: `${T}-C-KEEP`, name: 'Keep Me', countyId: `${T}-C`, stateId: T },
  });
});

afterAll(async () => {
  if (HAS_DB) await cleanup();
  await prisma.$disconnect();
});

run('reseeding from an updated source', () => {
  it('C-2.6: adding one payam leaves every existing row untouched', async () => {
    const before = await prisma.payam.findMany({ orderBy: { id: 'asc' } });
    const lines = await liveAsCsv();
    lines.push(`payam,${T}-C-NEW,"Newly Added",${T}-C,${T}`);

    const out = await reseed(lines, true);
    expect(out).toMatch(/added\s+1/);
    expect(out).toContain(`+ payam ${T}-C-NEW`);

    const added = await prisma.payam.findUnique({ where: { id: `${T}-C-NEW` } });
    expect(added?.name).toBe('Newly Added');

    // Every row that existed before is byte-for-byte as it was.
    const after = await prisma.payam.findMany({ orderBy: { id: 'asc' } });
    const afterById = new Map(after.map((r) => [r.id, r]));
    for (const row of before) {
      expect(afterById.get(row.id)).toEqual(row);
    }

    await prisma.payam.delete({ where: { id: `${T}-C-NEW` } });
  });

  it('C-2.6: a changed name is updated and nothing else moves', async () => {
    const lines = (await liveAsCsv()).map((l) =>
      l.startsWith(`payam,${T}-C-KEEP,`) ? `payam,${T}-C-KEEP,"Renamed Payam",${T}-C,${T}` : l,
    );

    const out = await reseed(lines, true);
    expect(out).toMatch(/renamed\s+1/);
    expect(out).toContain(`~ payam ${T}-C-KEEP  "Keep Me" -> "Renamed Payam"`);

    const row = await prisma.payam.findUniqueOrThrow({ where: { id: `${T}-C-KEEP` } });
    expect(row.name).toBe('Renamed Payam');

    // put it back
    await reseed(
      await liveAsCsv().then((l) =>
        l.map((x) =>
          x.startsWith(`payam,${T}-C-KEEP,`) ? `payam,${T}-C-KEEP,"Keep Me",${T}-C,${T}` : x,
        ),
      ),
      true,
    );
    const restored = await prisma.payam.findUniqueOrThrow({ where: { id: `${T}-C-KEEP` } });
    expect(restored.name).toBe('Keep Me');
  });

  it('a source that changes nothing reports nothing and writes nothing', async () => {
    const before = await prisma.payam.findMany({ orderBy: { id: 'asc' } });
    const out = await reseed(await liveAsCsv(), true);

    expect(out).toMatch(/added\s+0/);
    expect(out).toMatch(/renamed\s+0/);
    expect(out).toMatch(/would remove\s+0/);
    expect(out).toMatch(/REFUSED\s+0/);
    expect(await prisma.payam.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
});

run('what the reseed refuses to remove', () => {
  it('removes a payam that nothing depends on, by soft deletion', async () => {
    const id = `${T}-C-GONE`;
    await prisma.payam.create({
      data: { id, name: 'To Be Removed', countyId: `${T}-C`, stateId: T },
    });
    expect(await activeCount(id)).toBe(1);

    const lines = (await liveAsCsv()).filter((l) => !l.startsWith(`payam,${id},`));
    const out = await reseed(lines, true);

    expect(out).toMatch(/would remove\s+1/);
    expect(out).toContain(`- payam ${id}`);
    expect(await activeCount(id)).toBe(0);

    // Soft, not hard. The row survives and the code is never reused.
    const base = await prisma.payam.findUnique({ where: { id } });
    expect(base).not.toBeNull();
    expect(base?.deletedAt).not.toBeNull();

    await prisma.payam.delete({ where: { id } });
  });

  it('C-2.7: refuses to remove a payam something depends on, and names what and why', async () => {
    const id = `${T}-C-BUSY`;
    await prisma.payam.create({
      data: { id, name: 'Has Dependants', countyId: `${T}-C`, stateId: T },
    });

    // A throwaway table with a REAL foreign key. farmer, officer and
    // cooperative do not exist yet, and inventing them would be worse than
    // useless -- the guard is driven by pg_constraint, so it is proved here
    // against genuine foreign-key metadata rather than a mock.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE public."${DEP_TABLE}" (
         id       serial PRIMARY KEY,
         payam_id text NOT NULL REFERENCES public.payam(id)
       )`,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO public."${DEP_TABLE}" (payam_id) VALUES ($1)`, id);

    const snapshot = await prisma.payam.findMany({ orderBy: { id: 'asc' } });
    const lines = (await liveAsCsv()).filter((l) => !l.startsWith(`payam,${id},`));
    const out = await reseed(lines, true);

    // It refused...
    expect(out).toMatch(/REFUSED\s+1/);
    // ...named what...
    expect(out).toContain(`! payam ${id}`);
    // ...and why, naming the actual dependant.
    expect(out).toContain(DEP_TABLE);
    expect(out).toContain('1 row(s)');
    expect(out).toContain('NOT APPLIED');

    // ...and changed nothing at all.
    expect(await activeCount(id)).toBe(1);
    expect(await prisma.payam.findMany({ orderBy: { id: 'asc' } })).toEqual(snapshot);

    await prisma.$executeRawUnsafe(`DROP TABLE public."${DEP_TABLE}"`);
    await prisma.payam.delete({ where: { id } });
  });

  it('accepts the same removal once the dependant is gone', async () => {
    // The other direction. A guard that refuses everything passes every
    // refusal test perfectly -- docs/DECISIONS.md, B1.3.
    const id = `${T}-C-BUSY2`;
    await prisma.payam.create({
      data: { id, name: 'Briefly Busy', countyId: `${T}-C`, stateId: T },
    });
    await prisma.$executeRawUnsafe(
      `CREATE TABLE public."${DEP_TABLE}" (
         id serial PRIMARY KEY, payam_id text NOT NULL REFERENCES public.payam(id))`,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO public."${DEP_TABLE}" (payam_id) VALUES ($1)`, id);

    const lines = (await liveAsCsv()).filter((l) => !l.startsWith(`payam,${id},`));
    expect(await reseed(lines, true)).toMatch(/REFUSED\s+1/);
    expect(await activeCount(id)).toBe(1);

    // Remove the dependant; the same source now goes through.
    await prisma.$executeRawUnsafe(`DELETE FROM public."${DEP_TABLE}" WHERE payam_id = $1`, id);
    const out = await reseed(lines, true);
    expect(out).toMatch(/REFUSED\s+0/);
    expect(out).toMatch(/would remove\s+1/);
    expect(await activeCount(id)).toBe(0);

    await prisma.$executeRawUnsafe(`DROP TABLE public."${DEP_TABLE}"`);
    await prisma.payam.delete({ where: { id } });
  });

  it('reports without writing unless --apply is given', async () => {
    const id = `${T}-C-DRY`;
    await prisma.payam.create({ data: { id, name: 'Dry Run', countyId: `${T}-C`, stateId: T } });

    const lines = (await liveAsCsv()).filter((l) => !l.startsWith(`payam,${id},`));
    const out = await reseed(lines, false);

    expect(out).toContain('report only');
    expect(out).toMatch(/would remove\s+1/);
    expect(await activeCount(id)).toBe(1);

    await prisma.payam.delete({ where: { id } });
  });
});

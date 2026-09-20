import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The directories and the learning library against a real database. Unit P1,
 * C-13.1 to C-13.9.
 *
 * Same conditions as tests/locations.test.ts: skipped when DATABASE_URL is
 * empty (CI), session pooler, no retries, generous timeout.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

requireTestEnv();
const run = describe;

const prisma = makeTestPrisma();

/** Test locations use a code prefix no real location will ever have. */
const T = 'ZZP1';
const PATH = 'zz-test/p1';

const cleanup = async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.directory_entry   WHERE state_id LIKE '${T}%'`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.learning_resource WHERE storage_path LIKE '${PATH}/%'`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM public.payam  WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.county WHERE id LIKE '${T}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM public.state  WHERE id LIKE '${T}%'`);
};

const dealer = {
  entryType: 'agro_dealer' as const,
  name: 'Test Seed Store',
  phone: '+211912345678',
  payamId: `${T}-C1-P1`,
  stateId: T,
  lastVerifiedAt: new Date('2026-09-01'),
};

beforeAll(async () => {
  await cleanup();
  await prisma.state.create({ data: { id: T, name: 'P1 Test State' } });
  await prisma.state.create({ data: { id: `${T}2`, name: 'P1 Other State' } });
  await prisma.county.create({ data: { id: `${T}-C1`, name: 'P1 Test County', stateId: T } });
  await prisma.payam.create({
    data: { id: `${T}-C1-P1`, name: 'P1 Test Payam', countyId: `${T}-C1`, stateId: T },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

run('C-13.2: an entry is located, and its state cannot disagree with its payam', () => {
  it('accepts an entry whose state matches its payam', async () => {
    const row = await prisma.directoryEntry.create({ data: dealer });
    expect(row.stateId).toBe(T);
  });

  it('refuses an entry whose state_id is another real state', async () => {
    await expect(
      prisma.directoryEntry.create({ data: { ...dealer, stateId: `${T}2` } }),
    ).rejects.toThrow(/directory_entry_payam_state_consistent_fkey|foreign key/i);
  });
});

run('C-13.3: the database backs the validation rules, both directions', () => {
  it('refuses a phone that is not E.164 +211, and accepts one that is', async () => {
    await expect(
      prisma.directoryEntry.create({ data: { ...dealer, phone: '0912345678' } }),
    ).rejects.toThrow(/directory_entry_phone_e164|check constraint/i);
    const ok = await prisma.directoryEntry.create({ data: { ...dealer, phone: '+211920000000' } });
    expect(ok.phone).toBe('+211920000000');
  });

  it('requires a provider class on a financial service', async () => {
    await expect(
      prisma.directoryEntry.create({ data: { ...dealer, entryType: 'financial_service' } }),
    ).rejects.toThrow(/provider_class_matches_type|check constraint/i);
    const ok = await prisma.directoryEntry.create({
      data: { ...dealer, entryType: 'financial_service', providerClass: 'bank' },
    });
    expect(ok.providerClass).toBe('bank');
  });

  it('forbids a provider class on an agro-dealer', async () => {
    await expect(
      prisma.directoryEntry.create({ data: { ...dealer, providerClass: 'bank' } }),
    ).rejects.toThrow(/provider_class_matches_type|check constraint/i);
  });

  it('refuses a blank name', async () => {
    await expect(prisma.directoryEntry.create({ data: { ...dealer, name: '  ' } })).rejects.toThrow(
      /name_not_blank|check constraint/i,
    );
  });
});

run('C-13.4: a removed entry leaves every list', () => {
  it('a soft-deleted entry is absent from the active view and present in the table', async () => {
    const row = await prisma.directoryEntry.create({ data: { ...dealer, name: 'Closed Shop' } });
    await prisma.directoryEntry.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    const inView = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public.directory_entry_active WHERE id = '${row.id}'::uuid`,
    );
    expect(inView).toHaveLength(0);
    const inTable = await prisma.directoryEntry.findUnique({ where: { id: row.id } });
    expect(inTable?.deletedAt).not.toBeNull();
  });
});

run('C-13.7: one live catalogue card per stored file', () => {
  const card = {
    title: 'Test guide',
    topic: 'crop_production' as const,
    language: 'en' as const,
    format: 'pdf' as const,
    storagePath: `${PATH}/guide.pdf`,
    byteSize: 1000,
  };

  it('refuses a second card for the same path while the first is live', async () => {
    const first = await prisma.learningResource.create({ data: card });
    await expect(prisma.learningResource.create({ data: card })).rejects.toThrow(
      /storage_path_active_key|unique/i,
    );
    // Soft-deleting the first releases the path.
    await prisma.learningResource.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });
    const second = await prisma.learningResource.create({ data: card });
    expect(second.id).not.toBe(first.id);
  });

  it('refuses an empty file and starts a new card unpublished', async () => {
    await expect(
      prisma.learningResource.create({
        data: { ...card, storagePath: `${PATH}/empty.pdf`, byteSize: 0 },
      }),
    ).rejects.toThrow(/byte_size_positive|check constraint/i);
    const row = await prisma.learningResource.create({
      data: { ...card, storagePath: `${PATH}/draft.pdf` },
    });
    expect(row.published).toBe(false);
  });

  it('stores the Arabic language value exactly', async () => {
    const row = await prisma.learningResource.create({
      data: { ...card, storagePath: `${PATH}/arabi.pdf`, language: 'ar' },
    });
    const raw = await prisma.$queryRawUnsafe<{ language: string }[]>(
      `SELECT language::text FROM public.learning_resource WHERE id = '${row.id}'::uuid`,
    );
    expect(raw[0]?.language).toBe('ar');
  });
});

run('the backstop and the shared types', () => {
  it('row-level security is enabled on both tables', async () => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT relname, relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND relname IN ('directory_entry','learning_resource')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} has RLS off`).toBe(true);
  });

  it('both active views read through security_invoker', async () => {
    const views = await prisma.$queryRawUnsafe<{ view_name: string; invoker_on: boolean }[]>(
      `SELECT c.relname AS view_name,
              'security_invoker=true' = ANY(COALESCE(c.reloptions,'{}')) AS invoker_on
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v'
         AND c.relname IN ('directory_entry_active','learning_resource_active')`,
    );
    expect(views).toHaveLength(2);
    for (const v of views) expect(v.invoker_on, `${v.view_name} bypasses RLS`).toBe(true);
  });

  it('the crop and language enum types exist once, for later units to reuse', async () => {
    const types = await prisma.$queryRawUnsafe<{ typname: string; labels: string[] }[]>(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname='public' AND t.typname IN ('crop','language')
       GROUP BY t.typname`,
    );
    const byName = Object.fromEntries(types.map((t) => [t.typname, t.labels]));
    // Containment, not equality: a later unit may add a crop or a language,
    // and staging holds it before that unit merges (DECISIONS, "a test that
    // reads the schema tolerates objects it does not know"). What must hold
    // is that every value the code knows exists in the database.
    expect(byName['crop']).toEqual(
      expect.arrayContaining(['sorghum', 'groundnut', 'sesame', 'maize', 'cowpea']),
    );
    expect(byName['language']).toEqual(expect.arrayContaining(['en', 'ar-juba']));
  });

  it('payam carries the composite target every scoped table needs', async () => {
    const rows = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE conname = 'payam_id_state_id_key'`,
    );
    expect(rows).toHaveLength(1);
  });
});

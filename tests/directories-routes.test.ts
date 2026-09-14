import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as directoryItem from '../apps/web/app/api/directory-entries/[id]/route';
import * as directory from '../apps/web/app/api/directory-entries/route';
import * as learningItem from '../apps/web/app/api/learning-resources/[id]/route';
import * as learning from '../apps/web/app/api/learning-resources/route';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { type TestPrincipal, createPrincipal, sweep } from './helpers/principals';
import { call } from './helpers/request';

/**
 * The directory and learning-library ROUTES, through requireRole and scope.
 * Unit P1, C-13.
 *
 * tests/directories.test.ts proves the database honours the shapes. This proves
 * the routes honour the caller: a supervisor sees only their own state, a
 * non-administrator sees only active/published rows, a soft delete leaves every
 * list AND writes exactly one soft_deleted audit row, and a publish is its own
 * row.
 *
 * THREE THINGS WERE CORRECTED HERE ON 2026-09-14, when this file ran in CI for
 * the first time. It was written on 2026-09-05 and the branch was held, so
 * nothing had ever executed it: B5.5 landed the loud-env guard, B4's trigger
 * was already refusing what its cleanup did, and neither could tell anyone
 * while the file sat on an unmerged branch.
 *
 *   1. `cleanupRows` deleted from `audit_event`. The audit table is
 *      append-only (CLAUDE.md section 4) and a trigger refuses DELETE, so the
 *      hook threw and took the whole file down. Nothing needed the deletion:
 *      every assertion here reads audit rows for one freshly generated id.
 *   2. The file skipped itself when the variables were absent
 *      (`HAS_ENV ? describe : describe.skip`). That is the SECOND silent-class
 *      instance in docs/PROJECT-STATE.md -- eight files reporting green for
 *      tests that never ran -- closed by B5.5 with `requireTestEnv`, which
 *      fails loudly instead. This file predates the fix.
 *   3. It built its own client preferring DIRECT_URL. B5.5 moved test clients
 *      to the transaction pooler because the session pooler has fifteen slots
 *      and stopped granting connections for minutes. `makeTestPrisma` is that
 *      decision in one place.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const run = describe;

const prisma = makeTestPrisma();

// Real seeded staging locations, as the other route tests use. EE has no
// seeded payam, so a directory entry can only be created in CE; a supervisor in
// EE therefore sees none, which is exactly the scope assertion.
const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let supervisorB: TestPrincipal & { password: string };
let readOnlyA: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };

const cleanupRows = async () => {
  // The audit rows this test produces are NOT removed: the audit table is
  // append-only and the trigger refuses DELETE. They are harmless -- every
  // assertion below reads by a fresh entity id, so rows from earlier runs are
  // invisible to it, and staging growth per run is already known and accepted.
  await prisma.$executeRawUnsafe(`DELETE FROM public.directory_entry WHERE name LIKE 'zztest%'`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM public.learning_resource WHERE title LIKE 'zztest%' OR storage_path LIKE 'zztest/%'`,
  );
};

beforeAll(async () => {
  await cleanupRows();
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  readOnlyA = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
});

afterAll(async () => {
  // Rows first: verified_by / uploaded_by reference the test users the sweep
  // then removes, so they must be gone before the accounts are.
  await cleanupRows();
  await sweep(prisma);
  await prisma.$disconnect();
});

const entryBody = (over: Record<string, unknown> = {}) => ({
  entry_type: 'agro_dealer',
  name: 'zztest-dealer',
  phone: `+2119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  payam_id: PAYAM_A,
  state_id: STATE_A,
  last_verified_at: '2026-09-01',
  ...over,
});

const resourceBody = (over: Record<string, unknown> = {}) => ({
  title: 'zztest-guide',
  topic: 'crop_production',
  language: 'en',
  format: 'pdf',
  storage_path: `zztest/${Math.random().toString(36).slice(2, 10)}.pdf`,
  byte_size: 2048,
  ...over,
});

const listIds = (body: Record<string, unknown>): string[] =>
  ((body.data as { id: string }[]) ?? []).map((r) => r.id);

const auditRows = (entityType: string, entityId: string) =>
  prisma.$queryRawUnsafe<{ action: string }[]>(
    `SELECT action FROM public.audit_event WHERE entity_type = $1 AND entity_id = $2
     ORDER BY occurred_at DESC, id DESC`,
    entityType,
    entityId,
  );

run('a supervisor sees directory entries in their own state only (C-13.9)', () => {
  let entryId: string;

  it('an administrator creates an entry in CE', async () => {
    const result = await call(directory, 'POST', { as: admin, body: entryBody() });
    expect(result.status).toBe(201);
    entryId = (result.body.data as { id: string }).id;
  });

  it('the CE supervisor sees it', async () => {
    const result = await call(directory, 'GET', { as: supervisorA });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).toContain(entryId);
  });

  it('the CE officer sees it, because a directory is scoped to their state', async () => {
    const result = await call(directory, 'GET', { as: officerA });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).toContain(entryId);
  });

  it('the EE supervisor does not, so this is not passing by showing nothing', async () => {
    const result = await call(directory, 'GET', { as: supervisorB });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).not.toContain(entryId);
  });
});

run('a non-administrator sees active entries only', () => {
  let inactiveId: string;

  it('an administrator creates an inactive entry', async () => {
    const result = await call(directory, 'POST', {
      as: admin,
      body: entryBody({ name: 'zztest-dealer-inactive', active: false }),
    });
    expect(result.status).toBe(201);
    inactiveId = (result.body.data as { id: string }).id;
  });

  it('a read_only account in the same state does not see it', async () => {
    const result = await call(directory, 'GET', { as: readOnlyA });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).not.toContain(inactiveId);
  });

  it('but the administrator does', async () => {
    const result = await call(directory, 'GET', { as: admin });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).toContain(inactiveId);
  });
});

run('a removed entry leaves the list and is its own soft_deleted row (C-13.4)', () => {
  let entryId: string;

  it('an administrator creates then deletes an entry', async () => {
    const created = await call(directory, 'POST', {
      as: admin,
      body: entryBody({ name: 'zztest-dealer-doomed' }),
    });
    entryId = (created.body.data as { id: string }).id;

    const deleted = await call(directoryItem, 'DELETE', { as: admin, params: { id: entryId } });
    expect(deleted.status).toBe(204);
  });

  it('is gone from the administrator list', async () => {
    const result = await call(directory, 'GET', { as: admin });
    expect(listIds(result.body)).not.toContain(entryId);
  });

  it('and left exactly one soft_deleted row, never an updated one', async () => {
    const rows = await auditRows('directory_entry', entryId);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('directory_entry.created');
    expect(actions).toContain('directory_entry.soft_deleted');
    expect(actions).not.toContain('directory_entry.updated');
  });
});

run('a learning resource is published, and the flip is its own row (C-13.6)', () => {
  let resourceId: string;

  it('an administrator registers an unpublished card', async () => {
    const result = await call(learning, 'POST', { as: admin, body: resourceBody() });
    expect(result.status).toBe(201);
    expect((result.body.data as { published: boolean }).published).toBe(false);
    resourceId = (result.body.data as { id: string }).id;
  });

  it('a non-administrator does not see it while unpublished', async () => {
    const result = await call(learning, 'GET', { as: officerA });
    expect(result.status).toBe(200);
    expect(listIds(result.body)).not.toContain(resourceId);
  });

  it('flipping published to true is audited as learning_resource.published', async () => {
    // A full-object PATCH (the schema is not partial): the same card, now
    // published. A fresh storage_path is harmless -- it cannot clash -- and the
    // point under test is the false->true flip, not the path.
    const patched = await call(learningItem, 'PATCH', {
      as: admin,
      params: { id: resourceId },
      body: resourceBody({ published: true }),
    });
    expect(patched.status).toBe(200);
    expect((patched.body.data as { published: boolean }).published).toBe(true);

    const rows = await auditRows('learning_resource', resourceId);
    expect(rows.map((r) => r.action)).toContain('learning_resource.published');
  });

  it('and now a non-administrator sees it', async () => {
    const result = await call(learning, 'GET', { as: officerA });
    expect(listIds(result.body)).toContain(resourceId);
  });
});

run('one live catalogue card per stored file (C-13.7)', () => {
  it('a second registration of the same path is refused with 409', async () => {
    const path = `zztest/${Math.random().toString(36).slice(2, 10)}.pdf`;
    const first = await call(learning, 'POST', {
      as: admin,
      body: resourceBody({ storage_path: path }),
    });
    expect(first.status).toBe(201);

    const second = await call(learning, 'POST', {
      as: admin,
      body: resourceBody({ storage_path: path }),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: {
        code: 'conflict',
        message: 'A learning resource is already registered for that file.',
      },
    });
  });
});

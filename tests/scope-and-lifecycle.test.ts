import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as locations from '../apps/web/app/api/locations/route';
import * as me from '../apps/web/app/api/me/route';
import * as officerItem from '../apps/web/app/api/officers/[id]/route';
import * as officers from '../apps/web/app/api/officers/route';
import * as userItem from '../apps/web/app/api/users/[id]/route';
import * as users from '../apps/web/app/api/users/route';
import {
  type TestPrincipal,
  createPrincipal,
  refresh,
  signInAs,
  sweep,
} from './helpers/principals';
import { call } from './helpers/request';

/**
 * Scope, and what happens when an account is deactivated.
 *
 * The forbidden matrix proves who may call what. This proves what they SEE once
 * inside -- the failure that returns 200 with well-formed JSON and is invisible
 * to every behaviour test.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const HAS_ENV =
  (process.env.DATABASE_URL ?? '') !== '' && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '') !== '';
const run = HAS_ENV ? describe : describe.skip;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let supervisorB: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerA2: TestPrincipal & { password: string };
let staffInA: TestPrincipal & { password: string };

beforeAll(async () => {
  if (!HAS_ENV) return;
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  staffInA = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerA2 = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
});

afterAll(async () => {
  if (HAS_ENV) await sweep(prisma);
  await prisma.$disconnect();
});

run('a supervisor sees only their own state (C-3.4)', () => {
  it('cannot read a staff account in another state', async () => {
    const result = await call(userItem, 'GET', { as: supervisorB, params: { id: staffInA.id } });
    expect(result.status).toBe(404);
  });

  it('cannot patch a staff account in another state', async () => {
    const result = await call(userItem, 'PATCH', {
      as: supervisorB,
      params: { id: staffInA.id },
      body: { name: 'zztest-should-not-happen' },
    });
    // 403 because PATCH is admin-only; the point is that it is never 200.
    expect(result.status).not.toBe(200);
  });

  it('sees no out-of-state accounts in the list', async () => {
    const result = await call(users, 'GET', { as: supervisorB });
    expect(result.status).toBe(200);
    const rows = (result.body.data as { id: string }[]) ?? [];
    expect(rows.map((r) => r.id)).not.toContain(staffInA.id);
  });

  it('and DOES see accounts in its own state, so this is not passing by refusing everything', async () => {
    const result = await call(users, 'GET', { as: supervisorA });
    expect(result.status).toBe(200);
    const rows = (result.body.data as { id: string }[]) ?? [];
    expect(rows.map((r) => r.id)).toContain(staffInA.id);
  });

  it('cannot see an admin at all, because an admin has no state', async () => {
    const result = await call(userItem, 'GET', { as: supervisorA, params: { id: admin.id } });
    expect(result.status).toBe(404);
  });
});

run('C-3.5: out of scope is indistinguishable from not found', () => {
  it('returns a byte-identical response for a real out-of-scope id and an invented one', async () => {
    const outOfScope = await call(userItem, 'GET', {
      as: supervisorB,
      params: { id: staffInA.id },
    });
    const neverExisted = await call(userItem, 'GET', {
      as: supervisorB,
      params: { id: '00000000-0000-4000-8000-000000000000' },
    });

    expect(outOfScope.status).toBe(neverExisted.status);
    // Byte for byte. Anything that differs -- a message, a field, a length --
    // tells the caller the first record exists.
    expect(outOfScope.text).toBe(neverExisted.text);
  });
});

run('an officer sees only their own caseload, not their payam (C-3.4)', () => {
  it('cannot see another officer in the same payam', async () => {
    const result = await call(officerItem, 'GET', { as: officerA, params: { id: officerA2.id } });
    expect(result.status, 'an officer read another officer in their payam').toBe(404);
  });

  it('can see themselves, so this is not passing by refusing everything', async () => {
    const result = await call(officerItem, 'GET', { as: officerA, params: { id: officerA.id } });
    expect(result.status).toBe(200);
  });

  it('sees only themselves in the officer list', async () => {
    const result = await call(officers, 'GET', { as: officerA });
    expect(result.status).toBe(200);
    const rows = (result.body.data as { id: string }[]) ?? [];
    expect(rows.map((r) => r.id)).toEqual([officerA.id]);
  });
});

run('deactivation ends access immediately (C-3.6)', () => {
  it('a soft-deleted staff account gets 401 on its very next request', async () => {
    const victim = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });

    const before = await call(me, 'GET', { as: victim });
    expect(before.status, 'the account should work before it is deleted').toBe(200);

    const deleted = await call(userItem, 'DELETE', { as: admin, params: { id: victim.id } });
    expect(deleted.status).toBe(204);

    const after = await call(me, 'GET', { as: victim });
    expect(after.status, 'a deleted account was still accepted').toBe(401);
  });

  it('a deleted officer cannot use their existing bearer token, nor refresh it', async () => {
    const victim = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    expect((await call(me, 'GET', { as: victim })).status).toBe(200);

    await call(officerItem, 'DELETE', { as: admin, params: { id: victim.id } });

    expect((await call(me, 'GET', { as: victim })).status).toBe(401);
    // The refresh token is what an offline officer returns with. If banning did
    // not revoke it, the device would silently re-authenticate for ever.
    const refreshed = await refresh(victim.refreshToken);
    expect(refreshed.status, 'a deleted officer could still refresh').not.toBe(200);
  });

  it('setting an officer inactive ends access, and re-activating restores it', async () => {
    const victim = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    expect((await call(me, 'GET', { as: victim })).status).toBe(200);

    await call(officerItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { status: 'inactive' },
    });
    expect(
      (await signInAs(victim, victim.password)).status,
      'inactive still let them sign in',
    ).not.toBe(200);

    await call(officerItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { status: 'active' },
    });
    const back = await signInAs(victim, victim.password);
    expect(back.status, 're-activating did not restore access, so inactive is one-way').toBe(200);
  });
});

run('the last administrator cannot be removed or demoted', () => {
  it('refuses to demote the only remaining admin', async () => {
    // Every other admin in the database is soft-deleted first, so `admin` is
    // genuinely the last one. Test accounts are swept afterwards.
    const others = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."user" WHERE role='admin' AND deleted_at IS NULL AND id <> $1::uuid`,
      admin.id,
    );
    for (const other of others) {
      await prisma.$executeRawUnsafe(
        `UPDATE public."user" SET deleted_at = now() WHERE id = $1::uuid`,
        other.id,
      );
    }

    const demote = await call(userItem, 'PATCH', {
      as: admin,
      params: { id: admin.id },
      body: { role: 'supervisor', state_id: STATE_A },
    });
    expect(demote.status, 'the last admin was demoted').not.toBe(200);

    const remove = await call(userItem, 'DELETE', { as: admin, params: { id: admin.id } });
    expect(remove.status, 'the last admin was removed').not.toBe(204);

    for (const other of others) {
      await prisma.$executeRawUnsafe(
        `UPDATE public."user" SET deleted_at = NULL WHERE id = $1::uuid`,
        other.id,
      );
    }
  });

  it('an admin cannot remove their own account', async () => {
    const second = await createPrincipal(prisma, 'admin');
    const result = await call(userItem, 'DELETE', { as: admin, params: { id: admin.id } });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'unprocessable' } });
    await call(userItem, 'DELETE', { as: admin, params: { id: second.id } });
  });
});

run('C-2.4 and C-2.5: the location bundle and its version', () => {
  it('serves the hierarchy with a version identifier', async () => {
    const result = await call(locations, 'GET', { as: officerA });
    expect(result.status).toBe(200);
    expect(typeof (result.body.data as { version: string }).version).toBe('string');
    expect(result.headers.get('etag')).toBeTruthy();
  });

  it('C-2.5: a device holding the current version gets 304 and no body', async () => {
    const first = await call(locations, 'GET', { as: officerA });
    const etag = first.headers.get('etag') as string;

    const second = await call(locations, 'GET', {
      as: officerA,
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
    expect(second.text, '304 must carry no body').toBe('');
  });

  it('a stale version still gets the full hierarchy', async () => {
    const result = await call(locations, 'GET', {
      as: officerA,
      headers: { 'if-none-match': '"an-old-version"' },
    });
    expect(result.status).toBe(200);
    expect((result.body.data as { payams: unknown[] }).payams.length).toBeGreaterThan(0);
  });
});

run('lists follow CONVENTIONS section 6', () => {
  it('pages with a cursor, and the cursor is opaque', async () => {
    const first = await call(users, 'GET', { as: admin, query: { limit: '1' } });
    expect(first.status).toBe(200);
    expect((first.body.data as unknown[]).length).toBe(1);
    const page = first.body.page as { cursor: string | null; hasMore: boolean };
    expect(page.hasMore).toBe(true);
    expect(typeof page.cursor).toBe('string');

    const second = await call(users, 'GET', {
      as: admin,
      query: { limit: '1', cursor: page.cursor as string },
    });
    expect(second.status).toBe(200);
    expect((second.body.data as { id: string }[])[0]?.id).not.toBe(
      (first.body.data as { id: string }[])[0]?.id,
    );
  });

  it('an unreadable cursor is refused, not treated as page one', async () => {
    const result = await call(users, 'GET', { as: admin, query: { cursor: 'not-a-cursor' } });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: 'invalid_cursor' } });
  });

  it('page is always present, with cursor null on the last page', async () => {
    const result = await call(users, 'GET', { as: admin, query: { limit: '100' } });
    const page = result.body.page as { cursor: string | null; hasMore: boolean };
    expect(page).toBeDefined();
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeNull();
  });

  it('every row carries a timestamp in the documented form (section 7)', async () => {
    const result = await call(users, 'GET', { as: admin, query: { limit: '5' } });
    for (const row of result.body.data as { created_at: string }[]) {
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});

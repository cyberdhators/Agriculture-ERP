import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as audit from '../apps/web/app/api/audit/route';
import * as officerItem from '../apps/web/app/api/officers/[id]/route';
import * as officers from '../apps/web/app/api/officers/route';
import * as userItem from '../apps/web/app/api/users/[id]/route';
import * as users from '../apps/web/app/api/users/route';
import {
  type AuditTx,
  IDLE_IN_TRANSACTION_TIMEOUT,
  audited,
  writeAudit,
} from '../apps/web/lib/api/audit';
import { officerAuthIdentifier } from '../packages/shared/src/identity';
import { type TestPrincipal, createPrincipal, sweep } from './helpers/principals';
import { call } from './helpers/request';

/**
 * The append-only audit log. Unit B4, criteria C-4.1 to C-4.9.
 *
 * Every guard in both directions, per the standing rule. Skips itself when the
 * environment is absent (CI). No retry logic -- see tests/locations.test.ts.
 *
 * Every phone number, name and identifier here is FABRICATED.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const HAS_ENV =
  (process.env.DATABASE_URL ?? '') !== '' && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '') !== '';
const run = HAS_ENV ? describe : describe.skip;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const PAYAM_A = 'CE-JUB-MUN';
const STATE_A = 'CE';

let admin: TestPrincipal & { password: string };
let supervisor: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officer: TestPrincipal & { password: string };

/** Rows for one entity, newest first. */
const rowsFor = (entityType: string, entityId: string) =>
  prisma.$queryRawUnsafe<
    {
      action: string;
      actor_type: string;
      actor_id: string | null;
      before: unknown;
      after: unknown;
    }[]
  >(
    `SELECT action, actor_type::text AS actor_type, actor_id, before, after
     FROM public.audit_event WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at DESC, id DESC`,
    entityType,
    entityId,
  );

const countFor = async (entityType: string, entityId: string) =>
  (await rowsFor(entityType, entityId)).length;

beforeAll(async () => {
  if (!HAS_ENV) return;
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisor = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officer = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
});

afterAll(async () => {
  if (HAS_ENV) await sweep(prisma);
  await prisma.$disconnect();
});

run('C-4.2: the database refuses to alter history', () => {
  const insert = (tx: { $queryRawUnsafe: <T>(q: string) => Promise<T> }) =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action)
       VALUES ('zztest', 'zztest-refusal', 'system', NULL, 'location.renamed') RETURNING id`,
    );

  it('an UPDATE through Prisma is refused', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const id = (await insert(tx))[0]!.id;
        await tx.$executeRawUnsafe(
          `UPDATE public.audit_event SET action = 'location.created' WHERE id = $1::uuid`,
          id,
        );
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('a DELETE through Prisma is refused', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const id = (await insert(tx))[0]!.id;
        await tx.$executeRawUnsafe(`DELETE FROM public.audit_event WHERE id = $1::uuid`, id);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('an INSERT is accepted, so the trigger is not refusing everything', async () => {
    // Inside a transaction that is rolled back, so no probe row survives.
    await expect(
      prisma.$transaction(async (tx) => {
        const id = (await insert(tx))[0]!.id;
        expect(id).toBeTruthy();
        throw new Error('rollback-on-purpose');
      }),
    ).rejects.toThrow('rollback-on-purpose');
    expect(await countFor('zztest', 'zztest-refusal')).toBe(0);
  });

  it('an action that is not a fixed key is refused by the database (C-4.7)', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action)
         VALUES ('zztest', 'x', 'system', NULL, 'could not register Achol Deng')`,
      ),
    ).rejects.toThrow();
  });
});

run('writeAudit cannot be called outside a transaction (C-4.4)', () => {
  it('refuses the top-level client at runtime, even past the type', async () => {
    await expect(
      writeAudit(prisma as unknown as AuditTx, {
        entityType: 'zztest',
        entityId: 'x',
        actorType: 'system',
        actorId: null,
        action: 'location.renamed',
      }),
    ).rejects.toThrow(/audited\(\)/);
  });

  it('refuses a plain Prisma transaction client that audited() did not stamp', async () => {
    await expect(
      prisma.$transaction(async (tx) =>
        writeAudit(tx as unknown as AuditTx, {
          entityType: 'zztest',
          entityId: 'x',
          actorType: 'system',
          actorId: null,
          action: 'location.renamed',
        }),
      ),
    ).rejects.toThrow(/audited\(\)/);
  });

  it('the type refuses the top-level client at compile time', () => {
    // PrismaClient carries no AuditTx brand. The line below failing to typecheck
    // IS the assertion; the root tsconfig covers tests/, so if it ever compiles
    // the guarantee is gone and `pnpm typecheck` goes red.
    const attempt = () =>
      // @ts-expect-error -- deliberately passing the un-branded top-level client
      writeAudit(prisma, {
        entityType: 'zztest',
        entityId: 'x',
        actorType: 'system',
        actorId: null,
        action: 'location.renamed',
      });
    expect(typeof attempt).toBe('function');
  });

  it('a change that fails leaves no audit row at all', async () => {
    await expect(
      audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: 'zztest',
          entityId: 'zztest-failed',
          actorType: 'system',
          actorId: null,
          action: 'location.created',
          after: { name: 'never' },
        });
        // the "change" fails after the row was written inside the same transaction
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await countFor('zztest', 'zztest-failed')).toBe(0);
  });
});

run('C-4.6: what an entry never contains', () => {
  const stored = async (entityId: string) => JSON.stringify(await rowsFor('zztest', entityId));

  it('a password passed to writeAudit does not appear in the stored row', async () => {
    await audited(prisma, (tx) =>
      writeAudit(tx, {
        entityType: 'zztest',
        entityId: 'zztest-pw',
        actorType: 'admin',
        actorId: admin.id,
        action: 'user.password_set',
        before: { password: 'old-secret-value' },
        after: { password: 'new-secret-value', name: 'kept' },
      }),
    );
    const text = await stored('zztest-pw');
    expect(text).not.toContain('secret-value');
    expect(text).toContain('kept');
  });

  it('a derived authentication identifier does not appear, under any key', async () => {
    const derived = officerAuthIdentifier('+211912345678');
    await audited(prisma, (tx) =>
      writeAudit(tx, {
        entityType: 'zztest',
        entityId: 'zztest-derived',
        actorType: 'admin',
        actorId: admin.id,
        action: 'officer.updated',
        after: {
          login: derived,
          contact: derived,
          auth_user_id: 'aaaaaaaa-0000-4000-8000-000000000000',
          name: 'kept',
        },
      }),
    );
    const text = await stored('zztest-derived');
    expect(text).not.toContain('officers.invalid');
    expect(text).not.toContain('aaaaaaaa-0000');
    expect(text).toContain('kept');
  });

  it('a token does not appear', async () => {
    await audited(prisma, (tx) =>
      writeAudit(tx, {
        entityType: 'zztest',
        entityId: 'zztest-token',
        actorType: 'admin',
        actorId: admin.id,
        action: 'user.updated',
        after: {
          token: 'tok-secret',
          refresh_token: 'rt-secret',
          access_token: 'at-secret',
          name: 'kept',
        },
      }),
    );
    const text = await stored('zztest-token');
    expect(text).not.toMatch(/tok-secret|rt-secret|at-secret/);
  });

  it('an entry carries the correct actor id and actor type (C-4.3)', async () => {
    const [row] = await rowsFor('zztest', 'zztest-pw');
    expect(row?.actor_type).toBe('admin');
    expect(row?.actor_id).toBe(admin.id);
  });

  it('a system actor has no id, and the database enforces the pairing', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action)
         VALUES ('zztest', 'x', 'system', $1::uuid, 'location.renamed')`,
        admin.id,
      ),
    ).rejects.toThrow();
  });
});

run('the twelve retro-fitted writes (C-4.1)', () => {
  it('creating a staff account leaves exactly one row', async () => {
    const res = await call(users, 'POST', {
      as: admin,
      body: {
        name: 'zztest-audited',
        email: `zztest-${Date.now()}@example.invalid`,
        password: 'a-long-enough-password',
        role: 'read_only',
        state_id: STATE_A,
      },
    });
    expect(res.status).toBe(201);
    const id = (res.body.data as { id: string }).id;
    const rows = await rowsFor('user', id);
    expect(rows.map((r) => r.action)).toEqual(['user.created']);
    expect(JSON.stringify(rows[0]?.after)).not.toContain('password');
  });

  it('patching a staff account: one row, changed fields only, and one for a password', async () => {
    const victim = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
    await call(userItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { name: 'zztest-renamed' },
    });
    let rows = await rowsFor('user', victim.id);
    expect(rows.map((r) => r.action)).toEqual(['user.updated']);
    expect(rows[0]?.before).toEqual({
      name: victim.role === 'read_only' ? 'zztest-read_only' : '',
    });
    expect(rows[0]?.after).toEqual({ name: 'zztest-renamed' });

    await call(userItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { password: 'another-long-password' },
    });
    rows = await rowsFor('user', victim.id);
    expect(rows.map((r) => r.action)).toEqual(['user.password_set', 'user.updated']);
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.after).toBeNull();
  });

  it('deleting a staff account leaves two rows: the soft delete and the auth outcome', async () => {
    const victim = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
    const res = await call(userItem, 'DELETE', { as: admin, params: { id: victim.id } });
    expect(res.status).toBe(204);
    const rows = await rowsFor('user', victim.id);
    expect(rows.map((r) => r.action).sort()).toEqual(['auth.disabled', 'user.soft_deleted']);
  });

  it('C-4.5: history is still readable after the record has left every list', async () => {
    const victim = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
    await call(userItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { name: 'zztest-history' },
    });
    await call(userItem, 'DELETE', { as: admin, params: { id: victim.id } });

    const gone = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.user_active WHERE id = $1::uuid`,
      victim.id,
    );
    expect(gone[0]?.n, 'the record should have left the active view').toBe(0);

    const res = await call(audit, 'GET', {
      as: admin,
      query: { entity_type: 'user', entity_id: victim.id },
    });
    expect(res.status).toBe(200);
    const actions = (res.body.data as { action: string }[]).map((r) => r.action).sort();
    expect(actions).toEqual(['auth.disabled', 'user.soft_deleted', 'user.updated']);
  });

  it('creating an officer leaves one row, with no phone in it', async () => {
    const phone = `+2119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const res = await call(officers, 'POST', {
      as: admin,
      body: {
        name: 'zztest-officer-audited',
        phone,
        password: 'a-long-enough-password',
        payam_id: PAYAM_A,
      },
    });
    expect(res.status).toBe(201);
    const id = (res.body.data as { id: string }).id;
    const rows = await rowsFor('officer', id);
    expect(rows.map((r) => r.action)).toEqual(['officer.created']);
    expect(JSON.stringify(rows[0]?.after)).not.toContain(phone.slice(1));
  });

  it('a status change is its own row, not an edit; inactive adds the auth outcome', async () => {
    const victim = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    await call(officerItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { status: 'inactive' },
    });
    let rows = await rowsFor('officer', victim.id);
    expect(rows.map((r) => r.action).sort()).toEqual(['auth.disabled', 'officer.status_changed']);
    expect(rows.find((r) => r.action === 'officer.status_changed')?.after).toEqual({
      status: 'inactive',
    });

    await call(officerItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { name: 'zztest-o-renamed' },
    });
    rows = await rowsFor('officer', victim.id);
    expect(rows[0]?.action).toBe('officer.updated');
    expect(rows[0]?.after).toEqual({ name: 'zztest-o-renamed' });

    await call(officerItem, 'PATCH', {
      as: admin,
      params: { id: victim.id },
      body: { password: 'another-long-password' },
    });
    rows = await rowsFor('officer', victim.id);
    expect(rows[0]?.action).toBe('officer.password_set');
    expect(rows[0]?.after).toBeNull();
  });

  it('deleting an officer leaves two rows', async () => {
    const victim = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
    await call(officerItem, 'DELETE', { as: admin, params: { id: victim.id } });
    const rows = await rowsFor('officer', victim.id);
    expect(rows.map((r) => r.action).sort()).toEqual(['auth.disabled', 'officer.soft_deleted']);
  });
});

run('GET /api/audit: the forbidden matrix and the filters (C-4.8, C-4.9)', () => {
  it.each([
    ['supervisor', () => supervisor],
    ['read_only', () => readOnly],
    ['officer', () => officer],
  ])('%s gets 403', async (_r, who) => {
    const res = await call(audit, 'GET', { as: who() });
    expect(res.status).toBe(403);
  });

  it('no session gets 401', async () => {
    expect((await call(audit, 'GET', { as: null })).status).toBe(401);
  });

  it('an admin reads it, so this is not passing by refusing everyone', async () => {
    const res = await call(audit, 'GET', { as: admin, query: { limit: '5' } });
    expect(res.status).toBe(200);
    expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
    expect(res.body.page).toBeDefined();
  });

  it('filters by actor and by date range', async () => {
    const byActor = await call(audit, 'GET', {
      as: admin,
      query: { actor_id: admin.id, limit: '100' },
    });
    expect(byActor.status).toBe(200);
    for (const row of byActor.body.data as { actor_id: string }[])
      expect(row.actor_id).toBe(admin.id);

    const future = await call(audit, 'GET', { as: admin, query: { from: '2099-01-01T00:00:00Z' } });
    expect((future.body.data as unknown[]).length).toBe(0);
  });

  it('pages with a cursor and refuses an unreadable one', async () => {
    const first = await call(audit, 'GET', { as: admin, query: { limit: '1' } });
    const page = first.body.page as { cursor: string | null; hasMore: boolean };
    expect(page.hasMore).toBe(true);
    const second = await call(audit, 'GET', {
      as: admin,
      query: { limit: '1', cursor: page.cursor as string },
    });
    expect((second.body.data as { id: string }[])[0]?.id).not.toBe(
      (first.body.data as { id: string }[])[0]?.id,
    );
    expect((await call(audit, 'GET', { as: admin, query: { cursor: 'garbage' } })).status).toBe(
      400,
    );
  });
});

run('an audited transaction cannot sit idle holding locks (found 2026-09-05)', () => {
  it('sets the idle-in-transaction timeout inside the transaction, and leaves the session untouched outside it', async () => {
    const inside = await audited(prisma, async (tx) => {
      const [row] = await tx.$queryRawUnsafe<{ v: string }[]>(
        'SHOW idle_in_transaction_session_timeout',
      );
      return row?.v;
    });
    expect(inside).toBe(IDLE_IN_TRANSACTION_TIMEOUT);
    const [outside] = await prisma.$queryRawUnsafe<{ v: string }[]>(
      'SHOW idle_in_transaction_session_timeout',
    );
    expect(outside?.v).toBe('0');
  });
});

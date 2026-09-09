import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as merge from '../apps/web/app/api/farmers/[id]/merge/route';
import * as reject from '../apps/web/app/api/farmers/[id]/reject/route';
import * as resubmit from '../apps/web/app/api/farmers/[id]/resubmit/route';
import * as verify from '../apps/web/app/api/farmers/[id]/verify/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as queue from '../apps/web/app/api/verification/queue/route';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';
import { VERIFICATION_STATES } from '../packages/shared/src/verification';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { NOTE, checked, data, errorOf, seenStatuses } from './helpers/scan';

/**
 * B6 — verification (C-6). Every response passes the C-5.13 scan, extended
 * with the rejection note (C-6.10). The state machine is proved from outside:
 * every transition not in the table is attempted through a route and refused.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const run = describe;
const prisma = makeTestPrisma();

const STATE_A = 'CE';
const STATE_B = 'EE';
const PAYAM_A = 'CE-JUB-MUN';
const PAYAM_B = 'CE-JUB-KAT';
const COUNTY_EE = TEST_LOCATION_PREFIX;
const PAYAM_EE = `${TEST_LOCATION_PREFIX}-TST`;

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let supervisorB: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerA2: TestPrincipal & { password: string };
let officerEE: TestPrincipal & { password: string };

let phoneSeq = 5_000_000;
const body = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzverify',
  family_name: FARMER_TEST_FAMILY,
  sex: 'm',
  year_of_birth: 1988,
  phone: `+21191${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});
const register = async (as: TestPrincipal, payload: Record<string, unknown>) => {
  const r = await checked(farmers, 'POST', { as, body: payload });
  expect(r.status, 'setup registration').toBe(201);
  return data(r).id as string;
};
const setStatus = (id: string, status: string) =>
  prisma.$executeRawUnsafe(
    `UPDATE public.farmer SET verification_status = $2::public.verification_status WHERE id = $1::uuid`,
    id,
    status,
  );
const statusOf = async (id: string) => {
  const [row] = await prisma.$queryRawUnsafe<{ s: string; m: string | null }[]>(
    'SELECT verification_status::text AS s, merged_into::text AS m FROM public.farmer WHERE id = $1::uuid',
    id,
  );
  return row!;
};
const eventsOf = (id: string) =>
  prisma.$queryRawUnsafe<
    { decision: string; reason_code: string | null; note: string | null; days_waiting: number }[]
  >(
    `SELECT decision::text AS decision, reason_code, note, days_waiting FROM public.verification_event WHERE farmer_id = $1::uuid ORDER BY decided_at`,
    id,
  );
const auditOf = (id: string) =>
  prisma.$queryRawUnsafe<{ action: string; after: Record<string, unknown> | null }[]>(
    `SELECT action, after FROM public.audit_event WHERE entity_type = 'farmer' AND entity_id = $1 ORDER BY occurred_at`,
    id,
  );

beforeAll(async () => {
  await sweep(prisma);
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.county (id, name, state_id) VALUES ($1, 'zztest county', $2) ON CONFLICT (id) DO NOTHING`,
    COUNTY_EE,
    STATE_B,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.payam (id, name, county_id, state_id) VALUES ($1, 'zztest payam', $2, $3) ON CONFLICT (id) DO NOTHING`,
    PAYAM_EE,
    COUNTY_EE,
    STATE_B,
  );
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerA2 = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
  officerEE = await createPrincipal(prisma, 'officer', { payamId: PAYAM_EE });
});
afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
run('the state machine cannot be bypassed by any route (C-6.1)', () => {
  const ROUTES = {
    verify: { mod: verify, to: 'verified', as: () => admin, body: undefined as unknown },
    reject: { mod: reject, to: 'rejected', as: () => admin, body: { reason_code: 'incomplete' } },
    merge: { mod: merge, to: 'merged', as: () => admin, body: undefined as unknown },
    resubmit: { mod: resubmit, to: 'pending', as: () => officerA, body: undefined as unknown },
  } as const;
  const allowed = new Set([
    'pending->verified',
    'pending->rejected',
    'pending->merged',
    'rejected->pending',
    'rejected->merged',
    'verified->merged',
  ]);
  for (const from of VERIFICATION_STATES) {
    for (const [name, r] of Object.entries(ROUTES)) {
      const key = `${from}->${r.to}`;
      if (allowed.has(key)) continue;
      it(`${from} → ${name} is refused with 409 transition_not_allowed`, async () => {
        const id = await register(officerA, body());
        const target = await register(officerA, body());
        if (from !== 'pending') await setStatus(id, from);
        const res = await checked(r.mod, 'POST', {
          as: r.as(),
          params: { id },
          body: name === 'merge' ? { target_id: target } : r.body,
        });
        expect(res.status, key).toBe(409);
        expect(errorOf(res).message).toBe(RULE_MESSAGES.transition_not_allowed);
        expect((await statusOf(id)).s).toBe(from);
      });
    }
  }
  it('every allowed transition works, and each writes a verification event and an audit event together', async () => {
    const id = await register(officerA, body());
    let r = await checked(reject, 'POST', {
      as: supervisorA,
      params: { id },
      body: { reason_code: 'incomplete', note: NOTE },
    });
    expect(r.status).toBe(200);
    expect((data(r).rejection as { note: string }).note).toBe(NOTE);
    r = await checked(resubmit, 'POST', { as: officerA, params: { id } });
    expect(r.status).toBe(200);
    expect(data(r).verification_status).toBe('pending');
    expect(data(r)).not.toHaveProperty('rejection');
    r = await checked(verify, 'POST', { as: supervisorA, params: { id } });
    expect(r.status).toBe(200);
    expect(data(r).verification_status).toBe('verified');
    const target = await register(officerA, body());
    await checked(verify, 'POST', { as: admin, params: { id: target } });
    r = await checked(merge, 'POST', { as: admin, params: { id }, body: { target_id: target } });
    expect(r.status).toBe(200);
    expect(data(r).merged_into).toBe(target);
    const events = await eventsOf(id);
    expect(events.map((e) => e.decision)).toEqual([
      'rejected',
      'resubmitted',
      'verified',
      'merged',
    ]);
    expect(events[0]?.reason_code).toBe('incomplete');
    expect(events[0]?.note).toBe(NOTE);
    const audit = await auditOf(id);
    expect(audit.map((a) => a.action)).toEqual([
      'farmer.created',
      'farmer.rejected',
      'farmer.resubmitted',
      'farmer.verified',
      'farmer.merged',
    ]);
    for (const a of audit) expect(JSON.stringify(a.after ?? {})).not.toContain(NOTE);
  });
});

// ---------------------------------------------------------------------------
run('who may decide (C-6.2, C-6.5)', () => {
  it('a supervisor in state A cannot verify a farmer in state B: 404', async () => {
    const id = await register(officerEE, body({ payam_id: PAYAM_EE }));
    const r = await checked(verify, 'POST', { as: supervisorA, params: { id } });
    expect(r.status).toBe(404);
    expect((await statusOf(id)).s).toBe('pending');
    expect((await checked(verify, 'POST', { as: supervisorB, params: { id } })).status).toBe(200);
  });
  it('an officer cannot verify their own registration — the route is not theirs at all', async () => {
    const id = await register(officerA, body());
    expect((await checked(verify, 'POST', { as: officerA, params: { id } })).status).toBe(403);
  });
  it('read_only reads the queue and can do nothing else', async () => {
    const id = await register(officerA, body());
    for (const mod of [verify, reject, merge]) {
      expect(
        (
          await checked(mod, 'POST', {
            as: readOnly,
            params: { id },
            body: { reason_code: 'other', target_id: id },
          })
        ).status,
      ).toBe(403);
    }
    expect((await checked(queue, 'GET', { as: readOnly })).status).toBe(200);
  });
  it("resubmission is the registering officer's alone, and only from rejected", async () => {
    const id = await register(officerA, body());
    await checked(reject, 'POST', {
      as: admin,
      params: { id },
      body: { reason_code: 'wrong_location' },
    });
    expect((await checked(resubmit, 'POST', { as: officerA2, params: { id } })).status).toBe(404);
    expect((await checked(resubmit, 'POST', { as: admin, params: { id } })).status).toBe(403);
    expect((await checked(resubmit, 'POST', { as: officerA, params: { id } })).status).toBe(200);
    expect((await checked(resubmit, 'POST', { as: officerA, params: { id } })).status).toBe(409);
  });
  it('an officer can correct a rejected record (C-5.9 as amended) and not a verified one', async () => {
    const id = await register(officerA, body());
    await checked(reject, 'POST', {
      as: admin,
      params: { id },
      body: { reason_code: 'incomplete' },
    });
    expect(
      (
        await checked(farmerItem, 'PATCH', {
          as: officerA,
          params: { id },
          body: { year_of_birth: 1989 },
        })
      ).status,
    ).toBe(200);
    await checked(resubmit, 'POST', { as: officerA, params: { id } });
    await checked(verify, 'POST', { as: admin, params: { id } });
    expect(
      (
        await checked(farmerItem, 'PATCH', {
          as: officerA,
          params: { id },
          body: { year_of_birth: 1990 },
        })
      ).status,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
run('rejection and the note (C-6.3)', () => {
  it('reject without a reason is 422', async () => {
    const id = await register(officerA, body());
    const r = await checked(reject, 'POST', { as: supervisorA, params: { id }, body: {} });
    expect(r.status).toBe(422);
    expect(errorOf(r).message).toBe(RULE_MESSAGES.reason_required);
  });
  it('the note comes back inside the record to the officer and the supervisor, and appears nowhere else', async () => {
    const id = await register(officerA, body());
    await checked(reject, 'POST', {
      as: supervisorA,
      params: { id },
      body: { reason_code: 'other', note: NOTE },
    });
    for (const who of [officerA, supervisorA, admin]) {
      const r = await checked(farmerItem, 'GET', { as: who, params: { id } });
      expect((data(r).rejection as { note: string }).note).toBe(NOTE);
    }
    const audit = await auditOf(id);
    expect(JSON.stringify(audit)).not.toContain(NOTE);
    expect(JSON.stringify(audit)).toContain('"reason_code":"other"');
  });
});

// ---------------------------------------------------------------------------
run('merging (C-6.4, C-6.9)', () => {
  it('merge into a target that is already merged is 409; into a soft-deleted, rejected or self target is refused', async () => {
    const a = await register(officerA, body());
    const b = await register(officerA, body());
    const c = await register(officerA, body());
    await checked(verify, 'POST', { as: admin, params: { id: c } });
    expect(
      (await checked(merge, 'POST', { as: admin, params: { id: a }, body: { target_id: c } }))
        .status,
    ).toBe(200);
    const r = await checked(merge, 'POST', {
      as: admin,
      params: { id: b },
      body: { target_id: a },
    });
    expect(r.status).toBe(409);
    expect(errorOf(r).message).toBe(RULE_MESSAGES.merge_target_not_eligible);
    const d = await register(officerA, body());
    expect((await checked(farmerItem, 'DELETE', { as: admin, params: { id: d } })).status).toBe(
      204,
    );
    expect(
      (await checked(merge, 'POST', { as: admin, params: { id: b }, body: { target_id: d } }))
        .status,
    ).toBe(409);
    expect(
      (await checked(merge, 'POST', { as: admin, params: { id: b }, body: { target_id: b } }))
        .status,
    ).toBe(409);
    const e = await register(officerA, body());
    await checked(reject, 'POST', { as: admin, params: { id: e }, body: { reason_code: 'other' } });
    expect(
      (await checked(merge, 'POST', { as: admin, params: { id: b }, body: { target_id: e } }))
        .status,
    ).toBe(409);
  });
  it('a merge across states is refused for an administrator too', async () => {
    const a = await register(officerA, body());
    const ee = await register(officerEE, body({ payam_id: PAYAM_EE }));
    const r = await checked(merge, 'POST', {
      as: admin,
      params: { id: a },
      body: { target_id: ee },
    });
    expect(r.status).toBe(409);
    expect(errorOf(r).message).toBe(RULE_MESSAGES.merge_across_states);
  });
  it('a supervisor cannot name a target outside their state: 422 not found', async () => {
    const a = await register(officerA, body());
    const ee = await register(officerEE, body({ payam_id: PAYAM_EE }));
    const r = await checked(merge, 'POST', {
      as: supervisorA,
      params: { id: a },
      body: { target_id: ee },
    });
    expect(r.status).toBe(422);
    expect(errorOf(r).message).toBe(RULE_MESSAGES.merge_target_not_found);
  });
  it('a merged source appears in no queue, no count and no reach figure, but is readable by id with its pointer', async () => {
    const a = await register(officerA, body());
    const t = await register(officerA, body());
    await checked(verify, 'POST', { as: admin, params: { id: t } });
    await checked(merge, 'POST', { as: admin, params: { id: a }, body: { target_id: t } });
    const q = await checked(queue, 'GET', { as: admin, query: { limit: '100' } });
    expect((q.body.data as { id: string }[]).some((x) => x.id === a)).toBe(false);
    const [v] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer_verified_v WHERE id = $1::uuid',
      a,
    );
    expect(Number(v?.n)).toBe(0);
    const [active] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer_active WHERE id = $1::uuid',
      a,
    );
    expect(Number(active?.n)).toBe(1);
    const r = await checked(farmerItem, 'GET', { as: admin, params: { id: a } });
    expect(r.status).toBe(200);
    expect(data(r).verification_status).toBe('merged');
    expect(data(r).merged_into).toBe(t);
    expect((await statusOf(t)).s).toBe('verified');
  });
});

// ---------------------------------------------------------------------------
run('the clock and the queue (C-6.7) and the view (C-6.8)', () => {
  it('days_waiting is correct across a rejection and resubmission — the clock restarts', async () => {
    const id = await register(officerA, body());
    await prisma
      .$executeRawUnsafe(
        `UPDATE public.farmer SET pending_since = now() - interval '10 days' WHERE id = $1::uuid`,
        id,
      )
      .catch(() => undefined);
    // The trigger refuses that: pending_since changes only on resubmission.
    const q1 = await checked(queue, 'GET', { as: admin, query: { limit: '100' } });
    const row1 = (q1.body.data as { id: string; days_waiting: number; escalated: boolean }[]).find(
      (x) => x.id === id,
    );
    expect(row1?.days_waiting).toBe(0);
    // Back-date through a rejection→resubmission, the one path the trigger allows, then age it.
    await checked(reject, 'POST', { as: admin, params: { id }, body: { reason_code: 'other' } });
    await prisma.$executeRawUnsafe(
      `UPDATE public.farmer SET verification_status = 'pending', pending_since = now() - interval '9 days' WHERE id = $1::uuid`,
      id,
    );
    const q2 = await checked(queue, 'GET', {
      as: admin,
      query: { escalated: 'true', limit: '100' },
    });
    const row2 = (q2.body.data as { id: string; days_waiting: number; escalated: boolean }[]).find(
      (x) => x.id === id,
    );
    expect(row2?.days_waiting).toBe(9);
    expect(row2?.escalated).toBe(true);
    await setStatus(id, 'rejected');
    const r = await checked(resubmit, 'POST', { as: officerA, params: { id } });
    expect(r.status).toBe(200);
    expect(data(r).days_waiting).toBe(0);
    const events = await eventsOf(id);
    expect(events[events.length - 1]?.days_waiting).toBe(9);
  });
  it('the clock cannot be edited through any route', async () => {
    const id = await register(officerA, body());
    const r = await checked(farmerItem, 'PATCH', {
      as: admin,
      params: { id },
      body: { pending_since: '2020-01-01T00:00:00.000Z' },
    });
    expect(r.status).toBe(400);
    expect(errorOf(r).fields?.pending_since).toBe('This field is not recognised.');
  });
  it('the queue shows duplicate matches side by side, oldest first, and read_only in state A sees no EE farmer', async () => {
    const first = body();
    const a = await register(officerA, first);
    const b = await register(officerA, body({ given_name: 'Zzother', phone: first.phone }));
    const q = await checked(queue, 'GET', { as: supervisorA, query: { limit: '100' } });
    const rows = q.body.data as {
      id: string;
      duplicates: { id: string }[];
      pending_since: string;
    }[];
    const rb = rows.find((x) => x.id === b);
    expect(rb?.duplicates.map((d) => d.id)).toContain(a);
    for (let i = 1; i < rows.length; i += 1)
      expect(rows[i - 1]!.pending_since <= rows[i]!.pending_since).toBe(true);
    const ro = await checked(queue, 'GET', { as: readOnly, query: { limit: '100' } });
    expect((ro.body.data as { state_id: string }[]).every((x) => x.state_id === STATE_A)).toBe(
      true,
    );
  });
  it('farmer_verified_v excludes pending, rejected, merged and soft-deleted', async () => {
    const ids = {
      pending: await register(officerA, body()),
      rejected: await register(officerA, body()),
      merged: await register(officerA, body()),
      deleted: await register(officerA, body()),
      verified: await register(officerA, body()),
    };
    await checked(reject, 'POST', {
      as: admin,
      params: { id: ids.rejected },
      body: { reason_code: 'other' },
    });
    await checked(verify, 'POST', { as: admin, params: { id: ids.verified } });
    await checked(merge, 'POST', {
      as: admin,
      params: { id: ids.merged },
      body: { target_id: ids.verified },
    });
    await checked(verify, 'POST', { as: admin, params: { id: ids.deleted } });
    await checked(farmerItem, 'DELETE', { as: admin, params: { id: ids.deleted } });
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      'SELECT id FROM public.farmer_verified_v WHERE id = ANY($1::uuid[])',
      Object.values(ids),
    );
    expect(rows.map((r) => r.id)).toEqual([ids.verified]);
  });
  it('a decision and its audit row succeed or fail together', async () => {
    const id = await register(officerA, body());
    // NOT VALID: earlier tests in this run already wrote farmer.verified rows, and
    // a validated CHECK would refuse to be added. Only new rows are checked,
    // which is exactly the write this test wants to fail.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public.audit_event ADD CONSTRAINT zztest_block CHECK (action <> 'farmer.verified') NOT VALID`,
    );
    try {
      const r = await checked(verify, 'POST', { as: admin, params: { id } });
      expect(r.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE public.audit_event DROP CONSTRAINT zztest_block`);
    }
    expect((await statusOf(id)).s).toBe('pending');
    expect((await eventsOf(id)).length).toBe(0);
  });
  it('every error status this unit produces was scanned, and none carried a name, phone, id or note', () => {
    for (const status of [400, 403, 404, 409, 422, 500])
      expect(seenStatuses.has(status), `no ${status} scanned`).toBe(true);
  });
});

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerItem from '../apps/web/app/api/farmers/[id]/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import { prisma as appPrisma } from '../apps/web/lib/db';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';
import { FARMER_MESSAGES } from '../packages/shared/src/farmer';
import { PHONE_MESSAGES } from '../packages/shared/src/phone';
import {
  FARMER_TEST_FAMILY,
  TEST_LOCATION_PREFIX,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { type CallOptions, type CallResult, type RouteModule, call } from './helpers/request';

/**
 * B5 — the farmer record (C-5). Every test here runs against staging with
 * fabricated people only: the family name is literally Zztestfamily.
 *
 * Two things this file does that the other route tests do not:
 *
 * 1. Every response passes through `scan()` (C-5.13). An error response may
 *    not contain a farmer's name, phone or national ID anywhere; a success
 *    response may carry them only inside `data`. The last test asserts that
 *    every error status the unit can produce was actually scanned.
 * 2. Farmer-number uniqueness is proved at the lock (1,000 concurrent
 *    allocations on one county's counter row) and end to end through the
 *    route (100 concurrent registrations). See the two tests for what each
 *    does and does not prove.
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
const PAYAM_B = 'CE-JUB-KAT';
const COUNTY_A = 'CE-JUB';
const COUNTY_EE = `${TEST_LOCATION_PREFIX}`;
const PAYAM_EE = `${TEST_LOCATION_PREFIX}-TST`;

const GIVEN = 'Zzachol';
const NATIONAL_ID = 'ZZ123456';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let supervisorB: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerA2: TestPrincipal & { password: string };
let officerB: TestPrincipal & { password: string };
let officerEE: TestPrincipal & { password: string };

// ---------------------------------------------------------------------------
// C-5.13: the scan. Every phone this file invents is remembered, so the scan
// can look for it in both written forms.
// ---------------------------------------------------------------------------
const phonesUsed = new Set<string>();
let phoneSeq = 0;
const freshPhone = (): string => {
  phoneSeq += 1;
  const phone = `+21191${String(1_000_000 + phoneSeq).padStart(7, '0')}`;
  phonesUsed.add(phone);
  return phone;
};
const piiStrings = (): string[] => [
  GIVEN,
  FARMER_TEST_FAMILY,
  NATIONAL_ID,
  ...[...phonesUsed].flatMap((p) => [p, p.slice(1), `0${p.slice(4)}`]),
];
const seenStatuses = new Set<number>();
function scan(result: CallResult, label: string): void {
  seenStatuses.add(result.status);
  const pii = piiStrings();
  if (result.status >= 400) {
    for (const needle of pii) {
      expect(result.text, `${label}: ${result.status} response leaks personal data`).not.toContain(
        needle,
      );
    }
    expect(result.body, `${label}: an error carried warnings`).not.toHaveProperty('warnings');
    return;
  }
  const outsideData = JSON.stringify({ ...result.body, data: undefined });
  for (const needle of pii) {
    expect(outsideData, `${label}: personal data outside data on a ${result.status}`).not.toContain(
      needle,
    );
  }
}
const checked = async (
  mod: RouteModule,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  options: CallOptions = {},
): Promise<CallResult> => {
  const result = await call(mod, method, options);
  scan(result, `${method} ${options.params?.id ? '/:id' : ''}`);
  return result;
};

const body = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: GIVEN,
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1990,
  phone: freshPhone(),
  national_id: NATIONAL_ID,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});
const data = (r: CallResult) => r.body.data as Record<string, unknown>;
/** A registration that later steps depend on: asserted, so a failed setup fails here and not three tests later. */
const register = async (as: TestPrincipal, payload: Record<string, unknown>) => {
  const r = await checked(farmers, 'POST', { as, body: payload });
  expect(r.status, 'setup registration').toBe(201);
  return r;
};
const warnings = (r: CallResult) => r.body.warnings as { duplicates?: string[] } | undefined;
const errorOf = (r: CallResult) =>
  r.body.error as { code: string; message: string; fields?: Record<string, string> };

beforeAll(async () => {
  if (!HAS_ENV) return;
  await sweep(prisma);
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.county (id, name, state_id) VALUES ($1, 'zztest county', $2)
     ON CONFLICT (id) DO NOTHING`,
    COUNTY_EE,
    STATE_B,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.payam (id, name, county_id, state_id) VALUES ($1, 'zztest payam', $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    PAYAM_EE,
    COUNTY_EE,
    STATE_B,
  );
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: STATE_A });
  supervisorB = await createPrincipal(prisma, 'supervisor', { stateId: STATE_B });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE_A });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerA2 = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerB = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
  officerEE = await createPrincipal(prisma, 'officer', { payamId: PAYAM_EE });
});

afterAll(async () => {
  if (HAS_ENV) await sweep(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
run('registration (C-5.1, C-5.3, C-5.4, C-5.12)', () => {
  it('an officer registers a farmer in their own payam, as themselves, and gets a farmer number', async () => {
    const r = await checked(farmers, 'POST', { as: officerA, body: body() });
    expect(r.status).toBe(201);
    const d = data(r);
    expect(d.farmer_number).toMatch(/^CE-JUB-\d{6}$/);
    expect(d.registered_by).toBe(officerA.id);
    expect(d.registration_source).toBe('officer');
    expect(d.verification_status).toBe('pending');
    expect(d.county_id).toBe(COUNTY_A);
    expect(d.state_id).toBe(STATE_A);
    expect(d.national_id).toBe(NATIONAL_ID);
    expect((d.consent as { text_version: string }).text_version).toBe('v1.0-en');
    expect(r.body).not.toHaveProperty('warnings');
  });

  it('an officer in payam A cannot create a farmer in payam B', async () => {
    const r = await checked(farmers, 'POST', { as: officerA, body: body({ payam_id: PAYAM_B }) });
    expect(r.status).toBe(403);
    expect(errorOf(r).code).toBe('forbidden');
  });

  it('an officer cannot register a farmer as another officer', async () => {
    const r = await checked(farmers, 'POST', {
      as: officerA,
      body: body({ registered_by: officerA2.id }),
    });
    expect(r.status).toBe(403);
  });

  it('an administrator must name the registering officer, and that officer must be active in the payam', async () => {
    const missing = await checked(farmers, 'POST', { as: admin, body: body() });
    expect(missing.status).toBe(422);
    expect(errorOf(missing).message).toBe(RULE_MESSAGES.registering_officer_required);

    const wrongPayam = await checked(farmers, 'POST', {
      as: admin,
      body: body({ payam_id: PAYAM_B, registered_by: officerA.id }),
    });
    expect(wrongPayam.status).toBe(422);
    expect(errorOf(wrongPayam).message).toBe(RULE_MESSAGES.registering_officer_not_found);

    const ok = await checked(farmers, 'POST', {
      as: admin,
      body: body({ payam_id: PAYAM_B, registered_by: officerB.id }),
    });
    expect(ok.status).toBe(201);
    expect(data(ok).registered_by).toBe(officerB.id);
    expect(data(ok).farmer_number).toMatch(/^CE-JUB-\d{6}$/);
  });

  it('creating without consent is 422, not 400 — and so is consent that was not granted', async () => {
    const none = body();
    delete (none as Record<string, unknown>).consent;
    const r1 = await checked(farmers, 'POST', { as: officerA, body: none });
    expect(r1.status).toBe(422);
    expect(errorOf(r1).code).toBe('unprocessable');
    expect(errorOf(r1).message).toBe(RULE_MESSAGES.consent_required);

    const r2 = await checked(farmers, 'POST', {
      as: officerA,
      body: body({ consent: { text_version: 'v1.0-en', language: 'en', granted: false } }),
    });
    expect(r2.status).toBe(422);
    expect(errorOf(r2).message).toBe(RULE_MESSAGES.consent_required);

    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE id = $1::uuid',
      none.id,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('a repeat of the same client id creates no second row and is a 409', async () => {
    const first = body();
    const r1 = await checked(farmers, 'POST', { as: officerA, body: first });
    expect(r1.status).toBe(201);
    const r2 = await checked(farmers, 'POST', {
      as: officerA,
      body: { ...first, phone: freshPhone() },
    });
    expect(r2.status).toBe(409);
    expect(errorOf(r2).message).toBe(RULE_MESSAGES.farmer_already_exists);
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE id = $1::uuid',
      first.id,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('an unknown payam is 422', async () => {
    const r = await checked(farmers, 'POST', {
      as: admin,
      body: body({ payam_id: 'ZZ-NOP-NOP', registered_by: officerA.id }),
    });
    expect(r.status).toBe(422);
    expect(errorOf(r).message).toBe(RULE_MESSAGES.payam_not_found);
  });

  it('the farmer and its consent commit together: the database refuses a farmer whose consent row is missing', async () => {
    const id = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.farmer
             (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
              payam_id, county_id, state_id, registered_by, registration_source, consent_id)
           VALUES ($1::uuid, $2, 'Zzorphan', $3, 'f', 1990, $4, NULL, $5, $6, $7, $8::uuid, 'officer', $9::uuid)`,
          id,
          `ZZ-ZZZ-${String(phoneSeq).padStart(6, '0')}`,
          FARMER_TEST_FAMILY,
          freshPhone(),
          PAYAM_A,
          COUNTY_A,
          STATE_A,
          officerA.id,
          randomUUID(),
        );
      }),
    ).rejects.toThrow();
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE id = $1::uuid',
      id,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
run('validation names the field and says nothing else (C-5.2, C-5.13)', () => {
  const expect400 = async (overrides: Record<string, unknown>, field: string, reason: string) => {
    const r = await checked(farmers, 'POST', { as: officerA, body: body(overrides) });
    expect(r.status, field).toBe(400);
    expect(errorOf(r).code).toBe('invalid_input');
    expect(errorOf(r).fields?.[field]).toBe(reason);
  };
  it('a 500-character name', () =>
    expect400({ given_name: 'a'.repeat(500) }, 'given_name', FARMER_MESSAGES.nameTooLong));
  it('an emoji name', () =>
    expect400({ family_name: 'Zz 🌾' }, 'family_name', FARMER_MESSAGES.nameNotLetters));
  it('a future year of birth', () =>
    expect400(
      { year_of_birth: new Date().getUTCFullYear() + 1 },
      'year_of_birth',
      FARMER_MESSAGES.yearInFuture,
    ));
  it('letters in the phone', () =>
    expect400({ phone: '+2119123456ab' }, 'phone', PHONE_MESSAGES.letters));
  it('a national id in the wrong shape', () =>
    expect400({ national_id: 'abc' }, 'national_id', FARMER_MESSAGES.nationalIdShape));
  it('a bad list filter is a 400 naming the filter', async () => {
    const r = await checked(farmers, 'GET', {
      as: admin,
      query: { verification_status: 'maybe' },
    });
    expect(r.status).toBe(400);
    expect(errorOf(r).fields?.verification_status).toBe(FARMER_MESSAGES.filterStatusInvalid);
  });
  it('an unreadable cursor is a 400 invalid_cursor', async () => {
    const r = await checked(farmers, 'GET', { as: admin, query: { cursor: '!!not-a-cursor!!' } });
    expect(r.status).toBe(400);
    expect(errorOf(r).code).toBe('invalid_cursor');
  });
});

// ---------------------------------------------------------------------------
run('duplicate detection warns and never blocks (C-5.6)', () => {
  it('creating with a phone that already exists SUCCEEDS and returns the duplicate warning, ids only', async () => {
    const first = body();
    await register(officerA, first);
    const r2 = await checked(farmers, 'POST', {
      as: officerA,
      body: body({ given_name: 'Zzother', phone: first.phone }),
    });
    expect(r2.status).toBe(201);
    expect(warnings(r2)?.duplicates).toEqual([first.id]);
    expect(data(r2).duplicate_flag).toBe(true);
    expect(data(r2).duplicate_matches).toEqual([first.id]);
    expect(JSON.stringify(warnings(r2))).not.toContain(GIVEN);
  });

  it('the same name in the same payam matches ignoring case, surrounding space and Unicode form; the stored value is untouched', async () => {
    const first = body({ given_name: 'Zzachôl' });
    const r1 = await checked(farmers, 'POST', { as: officerA, body: first });
    expect(r1.status).toBe(201);
    const decomposed = 'Zzachôl'.normalize('NFD');
    const r2 = await checked(farmers, 'POST', {
      as: officerA,
      body: body({ given_name: `  ${decomposed.toUpperCase()} ` }),
    });
    expect(r2.status).toBe(201);
    expect(warnings(r2)?.duplicates).toContain(first.id);
    expect(data(r2).given_name).toBe(decomposed.toUpperCase());
  });

  it('the same name in a different payam is not a match', async () => {
    const first = body({ given_name: 'Zzunique' });
    await register(officerA, first);
    const r = await checked(farmers, 'POST', {
      as: officerB,
      body: body({ given_name: 'Zzunique', payam_id: PAYAM_B }),
    });
    expect(r.status).toBe(201);
    expect(r.body).not.toHaveProperty('warnings');
    expect(data(r).duplicate_flag).toBe(false);
  });

  it('a change of phone re-runs detection and warns', async () => {
    // Distinct names, so the only match the change can produce is the phone.
    const a = body({ given_name: 'Zzphonea' });
    const b = body({ given_name: 'Zzphoneb' });
    await register(officerA, a);
    const created = await register(officerA, b);
    expect(created.body).not.toHaveProperty('warnings');
    const r = await checked(farmerItem, 'PATCH', {
      as: officerA,
      params: { id: b.id },
      body: { phone: a.phone },
    });
    expect(r.status).toBe(200);
    expect(warnings(r)?.duplicates).toEqual([a.id]);
    expect(data(r).duplicate_flag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
run('scope and the national id (C-5.7, C-5.8)', () => {
  let ownId = '';
  let eeId = '';
  beforeAll(async () => {
    ownId = data(await register(officerA, body())).id as string;
    eeId = data(await register(officerEE, body({ payam_id: PAYAM_EE }))).id as string;
  });

  it('an officer cannot read a farmer registered by another officer, even in the same payam: 404', async () => {
    const r = await checked(farmerItem, 'GET', { as: officerA2, params: { id: ownId } });
    expect(r.status).toBe(404);
    expect(errorOf(r).code).toBe('not_found');
    const missing = await checked(farmerItem, 'GET', {
      as: officerA2,
      params: { id: randomUUID() },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(r.body);
  });

  it('a supervisor in state A gets 404 for a farmer in state B, identical to not-found', async () => {
    const r = await checked(farmerItem, 'GET', { as: supervisorA, params: { id: eeId } });
    expect(r.status).toBe(404);
    const other = await checked(farmerItem, 'GET', { as: supervisorB, params: { id: ownId } });
    expect(other.status).toBe(404);
    const inScope = await checked(farmerItem, 'GET', { as: supervisorB, params: { id: eeId } });
    expect(inScope.status).toBe(200);
  });

  it('the national id is returned to the administrator and the registering officer, and is ABSENT for supervisor and read_only', async () => {
    const asAdmin = await checked(farmerItem, 'GET', { as: admin, params: { id: ownId } });
    expect(data(asAdmin).national_id).toBe(NATIONAL_ID);
    const asOfficer = await checked(farmerItem, 'GET', { as: officerA, params: { id: ownId } });
    expect(data(asOfficer).national_id).toBe(NATIONAL_ID);
    for (const who of [supervisorA, readOnly]) {
      const r = await checked(farmerItem, 'GET', { as: who, params: { id: ownId } });
      expect(r.status).toBe(200);
      expect('national_id' in data(r), `${who.role} received the national_id key`).toBe(false);
      expect(r.text).not.toContain(NATIONAL_ID);
    }
    const list = await checked(farmers, 'GET', { as: supervisorA, query: { payam: PAYAM_A } });
    for (const row of list.body.data as Record<string, unknown>[]) {
      expect('national_id' in row).toBe(false);
    }
  });

  it('lists are scoped: an officer sees only their own registrations, a supervisor only their state', async () => {
    const mine = await checked(farmers, 'GET', { as: officerA, query: { limit: '100' } });
    expect(mine.status).toBe(200);
    const rows = mine.body.data as { id: string; registered_by: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.registered_by === officerA.id)).toBe(true);

    const theirs = await checked(farmers, 'GET', { as: officerA2, query: { limit: '100' } });
    expect((theirs.body.data as { id: string }[]).some((r) => r.id === ownId)).toBe(false);

    const state = await checked(farmers, 'GET', { as: supervisorA, query: { limit: '100' } });
    const stateRows = state.body.data as { id: string; state_id: string }[];
    expect(stateRows.every((r) => r.state_id === STATE_A)).toBe(true);
    expect(stateRows.some((r) => r.id === eeId)).toBe(false);

    const ro = await checked(farmers, 'GET', { as: readOnly });
    expect(ro.status).toBe(200);
  });

  it('filters and cursor paging are deterministic', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(
        data(
          await checked(farmers, 'POST', {
            as: officerB,
            body: body({ payam_id: PAYAM_B, sex: 'm' }),
          }),
        ).id as string,
      );
    }
    const page1 = await checked(farmers, 'GET', {
      as: officerB,
      query: { limit: '2', sex: 'm', payam: PAYAM_B, verification_status: 'pending' },
    });
    expect(page1.status).toBe(200);
    const p1 = page1.body.page as { cursor: string | null; hasMore: boolean };
    expect(p1.hasMore).toBe(true);
    expect(typeof p1.cursor).toBe('string');
    const page2 = await checked(farmers, 'GET', {
      as: officerB,
      query: {
        limit: '2',
        sex: 'm',
        payam: PAYAM_B,
        verification_status: 'pending',
        cursor: p1.cursor as string,
      },
    });
    const seen = [
      ...(page1.body.data as { id: string }[]),
      ...(page2.body.data as { id: string }[]),
    ].map((r) => r.id);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) expect(seen).toContain(id);

    const none = await checked(farmers, 'GET', {
      as: officerB,
      query: { sex: 'f', payam: PAYAM_B },
    });
    expect((none.body.data as unknown[]).every((r) => (r as { sex: string }).sex === 'f')).toBe(
      true,
    );
    const flagged = await checked(farmers, 'GET', { as: admin, query: { duplicate_flag: 'true' } });
    expect(
      (flagged.body.data as { duplicate_flag: boolean }[]).every((r) => r.duplicate_flag),
    ).toBe(true);
    const dated = await checked(farmers, 'GET', {
      as: admin,
      query: {
        registered_from: '2000-01-01T00:00:00.000Z',
        registered_to: '2000-01-02T00:00:00.000Z',
      },
    });
    expect(dated.body.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
run('changing and removing (C-5.9, C-5.10, C-5.11)', () => {
  it('PATCH by an officer on a farmer they did not register is 404 — the scope answer, so nothing is learned; on their own farmer once no longer pending it is 403', async () => {
    const own = body();
    await register(officerA, own);
    const notMine = await checked(farmerItem, 'PATCH', {
      as: officerA2,
      params: { id: own.id },
      body: { given_name: 'Zzrenamed' },
    });
    expect(notMine.status).toBe(404);

    const mine = await checked(farmerItem, 'PATCH', {
      as: officerA,
      params: { id: own.id },
      body: { given_name: 'Zzrenamed' },
    });
    expect(mine.status).toBe(200);
    expect(data(mine).given_name).toBe('Zzrenamed');

    const toOtherPayam = await checked(farmerItem, 'PATCH', {
      as: officerA,
      params: { id: own.id },
      body: { payam_id: PAYAM_B },
    });
    expect(toOtherPayam.status).toBe(403);

    await prisma.$executeRawUnsafe(
      `UPDATE public.farmer SET verification_status = 'verified' WHERE id = $1::uuid`,
      own.id,
    );
    const afterVerify = await checked(farmerItem, 'PATCH', {
      as: officerA,
      params: { id: own.id },
      body: { given_name: 'Zzagain' },
    });
    expect(afterVerify.status).toBe(403);
    const asAdmin = await checked(farmerItem, 'PATCH', {
      as: admin,
      params: { id: own.id },
      body: { given_name: 'Zzagain', payam_id: PAYAM_B },
    });
    expect(asAdmin.status).toBe(200);
    expect(data(asAdmin).payam_id).toBe(PAYAM_B);
    expect(data(asAdmin).farmer_number).toBe(data(mine).farmer_number);
  });

  it('the farmer number and the registering officer cannot be changed by anyone, and the database says so', async () => {
    const own = body();
    await register(officerA, own);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.farmer SET farmer_number = 'CE-JUB-999999' WHERE id = $1::uuid`,
        own.id,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.farmer SET registered_by = $2::uuid WHERE id = $1::uuid`,
        own.id,
        officerA2.id,
      ),
    ).rejects.toThrow(/immutable/);
    // The same trigger lets an ordinary change through: a guard that refuses everything is no guard.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.farmer SET year_of_birth = 1991 WHERE id = $1::uuid`,
        own.id,
      ),
    ).resolves.toBe(1);
  });

  it('a soft-deleted farmer is absent from every list and count, but present in audit', async () => {
    const own = body();
    await register(officerA, own);
    const bySupervisor = await checked(farmerItem, 'DELETE', {
      as: supervisorA,
      params: { id: own.id },
    });
    expect(bySupervisor.status).toBe(403);
    const r = await checked(farmerItem, 'DELETE', { as: admin, params: { id: own.id } });
    expect(r.status).toBe(204);

    const item = await checked(farmerItem, 'GET', { as: admin, params: { id: own.id } });
    expect(item.status).toBe(404);
    const list = await checked(farmers, 'GET', {
      as: admin,
      query: { payam: PAYAM_A, limit: '100' },
    });
    expect((list.body.data as { id: string }[]).some((x) => x.id === own.id)).toBe(false);
    const [active] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer_active WHERE id = $1::uuid',
      own.id,
    );
    const [base] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM public.farmer WHERE id = $1::uuid',
      own.id,
    );
    expect(Number(active?.n)).toBe(0);
    expect(Number(base?.n)).toBe(1);

    const events = await prisma.$queryRawUnsafe<
      { action: string; after: Record<string, unknown> | null }[]
    >(
      `SELECT action, after FROM public.audit_event WHERE entity_type = 'farmer' AND entity_id = $1 ORDER BY occurred_at`,
      own.id,
    );
    expect(events.map((e) => e.action)).toEqual(['farmer.created', 'farmer.soft_deleted']);
    const consentEvents = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM public.audit_event WHERE entity_type = 'consent' AND action = 'consent.recorded'
         AND after->>'farmer_id' = $1`,
      own.id,
    );
    expect(Number(consentEvents[0]?.n)).toBe(1);
    // C-4.7 / C-5.11: no name, phone or national id in any audit row for this farmer.
    for (const e of events) {
      const text = JSON.stringify(e.after ?? {});
      for (const needle of [GIVEN, FARMER_TEST_FAMILY, NATIONAL_ID, own.phone]) {
        expect(text).not.toContain(needle);
      }
      expect(e.after ?? {}).not.toHaveProperty('given_name');
      expect(e.after ?? {}).not.toHaveProperty('phone');
    }
  });
});

// ---------------------------------------------------------------------------
run('the farmer number is unique under concurrency (C-5.4)', () => {
  it('1,000 concurrent allocations on one county counter row yield 1,000 distinct, contiguous numbers — proves the row lock; a pooler failure here is the environment, not a collision', async () => {
    // On the TRANSACTION pooler (6543), not the session pooler: session mode
    // caps server connections per user (15), and ten more from this test on
    // top of the suite's own clients hit that cap mid-run and surface as
    // "Can't reach database server". Transaction mode multiplexes. The lock
    // being proved is a row lock inside a transaction, identical on either.
    // Ten real connections; the other 990 transactions queue for one, so
    // pool_timeout (Prisma's wait-for-a-connection limit, separate from the
    // transaction's own maxWait) is raised well past the queue.
    const base = (process.env.DATABASE_URL ?? '').replace(/\?.*$/, '');
    const url = `${base}?pgbouncer=true&connection_limit=10&pool_timeout=300&connect_timeout=30`;
    const pool = new PrismaClient({ datasources: { db: { url } } });
    try {
      // Concurrency bounded to the pool: ten workers, each running a hundred
      // short transactions back to back. Ten transactions are always in flight
      // and contending for the one row, which is what the lock must survive.
      // Launching all 1,000 at once was tried on 2026-09-05 and is what leaves
      // abandoned "idle in transaction" sessions holding the row lock: Prisma
      // gives up starting a transaction after maxWait, but the pooler keeps
      // the server session, and nothing on the server times it out.
      const allocate = () =>
        pool.$transaction(
          async (tx) => {
            const [row] = await tx.$queryRawUnsafe<{ n: number }[]>(
              `INSERT INTO public.farmer_number_counter (county_id, next_value) VALUES ($1, 2)
               ON CONFLICT (county_id) DO UPDATE SET next_value = public.farmer_number_counter.next_value + 1
               RETURNING next_value - 1 AS n`,
              COUNTY_EE,
            );
            return row!.n;
          },
          { maxWait: 30_000, timeout: 30_000 },
        );
      const worker = async (): Promise<number[]> => {
        const out: number[] = [];
        for (let i = 0; i < 100; i += 1) out.push(await allocate());
        return out;
      };
      const results = (await Promise.all(Array.from({ length: 10 }, worker))).flat();
      const distinct = new Set(results);
      expect(distinct.size).toBe(1000);
      expect(Math.max(...results) - Math.min(...results)).toBe(999);
    } finally {
      await pool.$disconnect();
    }
  });

  it('100 concurrent registrations through the route all succeed with distinct farmer numbers — proves it end to end, including the audit rows; the app pool serialises them, so this is not the lock test', async () => {
    // Waves of ten: the app's pool has one connection, so a hundred at once
    // would queue past the transaction's start timeout and fail as 500s that
    // say nothing about uniqueness. Ten overlapping registrations per wave is
    // real overlap at the counter row; ten waves is a hundred numbers.
    const results: CallResult[] = [];
    for (let wave = 0; wave < 10; wave += 1) {
      results.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, () =>
            checked(farmers, 'POST', { as: officerB, body: body({ payam_id: PAYAM_B }) }),
          ),
        )),
      );
    }
    const statuses = results.reduce<Record<number, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(statuses, 'every registration must be 201').toEqual({ 201: 100 });
    const numbers = results.map((r) => data(r).farmer_number as string);
    expect(new Set(numbers).size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
run('no error path in this unit emits a farmer’s name, phone or national ID (C-5.13)', () => {
  it('a 500 whose underlying error carries personal data still sends the fixed sentence', async () => {
    const own = body();
    await register(officerA, own);
    const spy = vi
      .spyOn(appPrisma, '$queryRawUnsafe')
      .mockRejectedValueOnce(new Error(`zztest boom ${GIVEN} ${own.phone} ${NATIONAL_ID}`));
    try {
      const r = await checked(farmerItem, 'GET', { as: admin, params: { id: own.id } });
      expect(r.status).toBe(500);
      expect(errorOf(r).message).toBe('Something went wrong. Please try again.');
    } finally {
      spy.mockRestore();
    }
  });

  it('every error status this unit can produce was produced above and scanned', () => {
    for (const status of [400, 403, 404, 409, 422, 500]) {
      expect(seenStatuses.has(status), `no ${status} response was ever scanned`).toBe(true);
    }
  });
});

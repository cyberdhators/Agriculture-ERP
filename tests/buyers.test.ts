import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as adminBuyer from '../apps/web/app/api/admin/buyers/[id]/route';
import * as adminBuyers from '../apps/web/app/api/admin/buyers/route';
import * as adminOrder from '../apps/web/app/api/admin/orders/[id]/route';
import * as adminOrders from '../apps/web/app/api/admin/orders/route';
import * as adminRequest from '../apps/web/app/api/admin/purchase-requests/[id]/route';
import * as adminRequests from '../apps/web/app/api/admin/purchase-requests/route';
import * as deliveries from '../apps/web/app/api/buyer/deliveries/route';
import * as marketItem from '../apps/web/app/api/buyer/marketplace/[id]/route';
import * as market from '../apps/web/app/api/buyer/marketplace/route';
import * as notifications from '../apps/web/app/api/buyer/notifications/route';
import * as order from '../apps/web/app/api/buyer/orders/[id]/route';
import * as orders from '../apps/web/app/api/buyer/orders/route';
import * as profile from '../apps/web/app/api/buyer/profile/route';
import * as request_ from '../apps/web/app/api/buyer/purchase-requests/[id]/route';
import * as requests from '../apps/web/app/api/buyer/purchase-requests/route';
import * as register from '../apps/web/app/api/buyer/register/route';
import * as summary from '../apps/web/app/api/buyer/summary/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as me from '../apps/web/app/api/me/route';
import * as users from '../apps/web/app/api/users/route';
import {
  FARMER_TEST_FAMILY,
  TEST_PREFIX,
  type TestPrincipal,
  createPrincipal,
  signInWith,
  sweep,
} from './helpers/principals';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { call } from './helpers/request';

/**
 * ============================================================================
 * B13 -- BUYER ACCOUNTS AND PROCUREMENT, AGAINST THE REAL DATABASE.
 * ============================================================================
 *
 * The brief's minimum, each item proved in both directions where it has two:
 * a buyer registers and signs in; a buyer reaches their own records and not
 * another organisation's, not the register, not the administrator's routes;
 * a purchase request is accepted when valid and refused when not; the
 * marketplace searches, filters and pages, and returns no farmer identity.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const prisma = makeTestPrisma();

const PAYAM = 'CE-JUB-MUN';
const STATE = 'CE';
const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

type P = TestPrincipal & { password: string };
let admin: P;
let officer: P;
let verified: P;
let colleague: P; // same organisation as `verified`
let pending: P;
let other: P; // a second, verified organisation
let suspended: P;

let farmerId = '';
let maizeListing = '';
let sorghumListing = '';

const LISTING_FIELDS_NEVER_SEEN = [
  'farmer_id',
  'contact_phone',
  'pickup_notes',
  'photo_storage_paths',
  'given_name',
  'family_name',
  'national_id',
];

const allKeys = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
};

async function insertListing(
  product: string,
  grade: 'a' | 'b' | null,
  quantity: number,
): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.produce_listing
       (farmer_id, trading_name, title, category, product_name, status, payam_id, state_id,
        quantity, price_ssp, quality_grade, contact_phone, pickup_notes)
     VALUES ($1::uuid, 'Zztest stall', $2, 'crop'::public.listing_category, $3, 'listed', $4, $5,
             $6, 900, $7::public.listing_grade, '+211912000111', 'Ask for the farmer by name')
     RETURNING id`,
    farmerId,
    `Zztest ${product}`,
    product,
    PAYAM,
    STATE,
    quantity,
    grade,
  );
  return row!.id;
}

const validRequest = () => ({
  category: 'crop',
  product_name: 'Maize',
  quantity: 5000,
  unit: 'kg',
  delivery_location: 'Juba',
  required_by: '2099-12-20',
  notes: 'Grade A preferred',
});

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  officer = await createPrincipal(prisma, 'officer', { payamId: PAYAM });
  verified = await createPrincipal(prisma, 'buyer', { verification: 'verified' });
  colleague = await createPrincipal(prisma, 'buyer', { organizationId: verified.organizationId });
  pending = await createPrincipal(prisma, 'buyer', { verification: 'pending' });
  other = await createPrincipal(prisma, 'buyer', { verification: 'verified' });
  suspended = await createPrincipal(prisma, 'buyer', { verification: 'suspended' });

  const registered = await call(farmers, 'POST', {
    as: officer,
    body: {
      id: randomUUID(),
      given_name: 'Zzbuyer',
      family_name: FARMER_TEST_FAMILY,
      sex: 'f',
      year_of_birth: 1985,
      phone: `+21191${String(7_100_000 + Math.floor(Math.random() * 899_999)).padStart(7, '0')}`,
      payam_id: PAYAM,
      consent: { text_version: 'v1.0-en', language: 'en', granted: true },
    },
  });
  if (registered.status !== 201) throw new Error(`setup: farmer (${registered.status})`);
  farmerId = (registered.body.data as { id: string }).id;
  maizeListing = await insertListing('Maize', 'a', 2000);
  sorghumListing = await insertListing('Sorghum', 'b', 800);
});

afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// AUTHENTICATION
// ---------------------------------------------------------------------------

describe('a buyer registers, and the account works', () => {
  const email = `${TEST_PREFIX}-reg-${Math.random().toString(36).slice(2, 10)}@example.invalid`;
  const passphrase = ['zztest', 'register', Math.random().toString(36).slice(2, 10)].join('-');

  it('registers as pending, and the body cannot choose otherwise', async () => {
    const refused = await call(register, 'POST', {
      as: null,
      body: {
        given_name: 'Zztest',
        family_name: 'Applicant',
        email,
        phone: '+254712000000',
        password: passphrase,
        confirm_password: passphrase,
        organization_name: `${TEST_PREFIX}-org-applicant`,
        organization_type: 'processor',
        country_code: 'SS',
        verification_status: 'verified',
      },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      error: { fields: { verification_status: expect.any(String) } },
    });

    const result = await call(register, 'POST', {
      as: null,
      body: {
        given_name: 'Zztest',
        family_name: 'Applicant',
        email,
        phone: '+254712000000',
        password: passphrase,
        confirm_password: passphrase,
        organization_name: `${TEST_PREFIX}-org-applicant`,
        organization_type: 'processor',
        country_code: 'SS',
        state_id: STATE,
        interested_categories: ['crop'],
      },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ data: { verification_status: 'pending' } });
  });

  it('can sign in, and is told it is a buyer', async () => {
    const tokens = await signInWith(email, passphrase);
    const who = await call(me, 'GET', {
      as: { accessToken: tokens.access } as TestPrincipal,
    });
    expect(who.status).toBe(200);
    expect(who.body).toMatchObject({ data: { role: 'buyer', kind: 'buyer' } });
  });

  it('the same address cannot register twice', async () => {
    const again = await call(register, 'POST', {
      as: null,
      body: {
        given_name: 'Zztest',
        family_name: 'Again',
        email,
        phone: '+254712000001',
        password: passphrase,
        confirm_password: passphrase,
        organization_name: `${TEST_PREFIX}-org-again`,
        organization_type: 'trader',
        country_code: 'SS',
      },
    });
    expect(again.status).toBe(409);
  });

  it('an INDIVIDUAL registers with no review and can send a request at once', async () => {
    const individualEmail = `${TEST_PREFIX}-ind-${Math.random().toString(36).slice(2, 10)}@example.invalid`;
    const result = await call(register, 'POST', {
      as: null,
      body: {
        account_type: 'individual',
        given_name: 'Zztest',
        family_name: 'Individual',
        email: individualEmail,
        phone: '+211912000222',
        password: passphrase,
        confirm_password: passphrase,
        // Named with the prefix so the sweep finds the account it creates.
        organization_name: `${TEST_PREFIX}-org-individual`,
        country_code: 'SS',
      },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      data: { account_type: 'individual', verification_status: 'not_required' },
    });
    const tokens = await signInWith(individualEmail, passphrase);
    const sent = await call(requests, 'POST', {
      as: { accessToken: tokens.access } as TestPrincipal,
      body: { ...validRequest(), submit: true },
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ data: { status: 'submitted' } });
  });

  it('the database refuses an individual marked verified, or a business exempted', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.buyer_organization (name, organization_type, account_type, verification_status)
         VALUES ('${TEST_PREFIX}-org-bad', 'other', 'individual', 'verified')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO public.buyer_organization (name, organization_type, account_type, verification_status)
         VALUES ('${TEST_PREFIX}-org-bad', 'trader', 'business', 'not_required')`,
      ),
    ).rejects.toThrow();
  });

  it('nobody unauthenticated reaches the dashboard or any buyer record', async () => {
    for (const [mod, params] of [
      [summary, undefined],
      [profile, undefined],
      [market, undefined],
      [requests, undefined],
      [orders, undefined],
      [deliveries, undefined],
      [notifications, undefined],
      [request_, { id: DUMMY_ID }],
      [order, { id: DUMMY_ID }],
    ] as const) {
      const result = await call(mod, 'GET', { as: null, params });
      expect(result.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// AUTHORIZATION
// ---------------------------------------------------------------------------

describe('a buyer reaches their own organisation and nothing else', () => {
  let ownRequest = '';

  beforeAll(async () => {
    const created = await call(requests, 'POST', {
      as: verified,
      body: { ...validRequest(), submit: true },
    });
    ownRequest = (created.body.data as { id: string }).id;
  });

  it('reads their own request, and a colleague at the same organisation reads it too', async () => {
    expect((await call(request_, 'GET', { as: verified, params: { id: ownRequest } })).status).toBe(
      200,
    );
    expect(
      (await call(request_, 'GET', { as: colleague, params: { id: ownRequest } })).status,
    ).toBe(200);
  });

  it('ANOTHER ORGANISATION GETS 404 -- byte-identical to an id that does not exist', async () => {
    const theirs = await call(request_, 'GET', { as: other, params: { id: ownRequest } });
    const nothing = await call(request_, 'GET', { as: other, params: { id: DUMMY_ID } });
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(nothing.body);
  });

  it('another organisation cannot cancel or edit it, and it is unchanged after trying', async () => {
    const cancel = await call(request_, 'PATCH', {
      as: other,
      params: { id: ownRequest },
      body: { action: 'cancel' },
    });
    expect(cancel.status).toBe(404);
    const [row] = await prisma.$queryRawUnsafe<{ status: string }[]>(
      'SELECT status::text AS status FROM public.purchase_request WHERE id = $1::uuid',
      ownRequest,
    );
    expect(row!.status).toBe('submitted');
  });

  it('another organisation’s list does not contain it', async () => {
    const list = await call(requests, 'GET', { as: other });
    expect((list.body.data as { id: string }[]).map((r) => r.id)).not.toContain(ownRequest);
  });

  it('a buyer is refused every administrator route, and cannot verify themselves', async () => {
    expect((await call(adminBuyers, 'GET', { as: pending })).status).toBe(403);
    expect((await call(adminRequests, 'GET', { as: verified })).status).toBe(403);
    expect((await call(adminOrders, 'GET', { as: verified })).status).toBe(403);
    expect((await call(users, 'GET', { as: verified })).status).toBe(403);
    const selfApprove = await call(adminBuyer, 'PATCH', {
      as: pending,
      params: { id: pending.organizationId! },
      body: { status: 'verified' },
    });
    expect(selfApprove.status).toBe(403);
    const [org] = await prisma.$queryRawUnsafe<{ s: string }[]>(
      'SELECT verification_status::text AS s FROM public.buyer_organization WHERE id = $1::uuid',
      pending.organizationId,
    );
    expect(org!.s).toBe('pending');
  });

  it('a buyer is refused the farmer register, read and write', async () => {
    expect((await call(farmers, 'GET', { as: verified })).status).toBe(403);
    const write = await call(farmers, 'POST', {
      as: verified,
      body: { id: randomUUID(), given_name: 'X', family_name: 'Y' },
    });
    expect(write.status).toBe(403);
  });

  it('staff are refused the buyer routes -- a buyer route admits buyers only', async () => {
    expect((await call(summary, 'GET', { as: admin })).status).toBe(403);
    expect((await call(market, 'GET', { as: officer })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PURCHASE REQUESTS
// ---------------------------------------------------------------------------

describe('purchase requests', () => {
  it('a verified buyer’s valid request is submitted', async () => {
    const result = await call(requests, 'POST', {
      as: verified,
      body: { ...validRequest(), listing_id: maizeListing, submit: true },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      data: { status: 'submitted', product_name: 'Maize', quantity: 5000 },
    });
  });

  it('an invalid quantity is refused with the pinned sentence', async () => {
    const result = await call(requests, 'POST', {
      as: verified,
      body: { ...validRequest(), quantity: -1 },
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: { fields: { quantity: 'Give the quantity as a number greater than zero.' } },
    });
  });

  it('an unverified buyer may save a draft but not submit', async () => {
    const draft = await call(requests, 'POST', { as: pending, body: validRequest() });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ data: { status: 'draft' } });
    const submit = await call(requests, 'POST', {
      as: pending,
      body: { ...validRequest(), submit: true },
    });
    expect(submit.status).toBe(422);
  });

  it('a suspended buyer can create nothing', async () => {
    expect((await call(requests, 'POST', { as: suspended, body: validRequest() })).status).toBe(
      403,
    );
  });

  it('no session, no request', async () => {
    expect((await call(requests, 'POST', { as: null, body: validRequest() })).status).toBe(401);
  });

  it('a request against a listing that is not on the market is refused', async () => {
    const result = await call(requests, 'POST', {
      as: verified,
      body: { ...validRequest(), listing_id: DUMMY_ID, submit: true },
    });
    expect(result.status).toBe(422);
  });

  it('every creation is audited as the buyer who made it', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.audit_event
        WHERE action = 'purchase_request.created' AND actor_type = 'buyer' AND actor_id = $1::uuid`,
      verified.id,
    );
    expect(row!.n).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MARKETPLACE
// ---------------------------------------------------------------------------

describe('the buyer marketplace', () => {
  it('search finds a listing by product', async () => {
    const result = await call(market, 'GET', { as: verified, query: { q: 'Zztest Sorghum' } });
    expect(result.status).toBe(200);
    expect((result.body.data as { id: string }[]).map((r) => r.id)).toContain(sorghumListing);
  });

  it('filters narrow: grade a keeps the maize and drops the sorghum', async () => {
    const result = await call(market, 'GET', {
      as: verified,
      query: { q: 'Zztest', grade: 'a', state_id: STATE, min_quantity: '1000' },
    });
    const ids = (result.body.data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(maizeListing);
    expect(ids).not.toContain(sorghumListing);
  });

  it('an unknown filter is refused, not ignored', async () => {
    const result = await call(market, 'GET', { as: verified, query: { farmer_id: farmerId } });
    expect(result.status).toBe(400);
  });

  it('pages on the server: one at a time, with a cursor to the next', async () => {
    const first = await call(market, 'GET', { as: verified, query: { q: 'Zztest', limit: '1' } });
    const page = first.body.page as { cursor: string | null; hasMore: boolean };
    expect((first.body.data as unknown[]).length).toBe(1);
    expect(page.hasMore).toBe(true);
    const second = await call(market, 'GET', {
      as: verified,
      query: { q: 'Zztest', limit: '1', cursor: page.cursor! },
    });
    expect((second.body.data as { id: string }[])[0]!.id).not.toBe(
      (first.body.data as { id: string }[])[0]!.id,
    );
  });

  it('RETURNS NO FARMER IDENTITY, list or detail, though the listing row carries a phone', async () => {
    const list = await call(market, 'GET', { as: verified, query: { q: 'Zztest' } });
    const detail = await call(marketItem, 'GET', { as: verified, params: { id: maizeListing } });
    for (const result of [list, detail]) {
      const keys = allKeys(result.body);
      for (const k of LISTING_FIELDS_NEVER_SEEN) expect(keys, `leaked ${k}`).not.toContain(k);
      expect(result.text).not.toContain('+211912000111');
      expect(result.text).not.toContain('Ask for the farmer by name');
      expect(result.text).not.toContain(farmerId);
    }
  });

  it('a suspended buyer is refused the marketplace', async () => {
    expect((await call(market, 'GET', { as: suspended })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// THE FULL LOOP: review, order, delivery, notification
// ---------------------------------------------------------------------------

describe('a request becomes an order the buyer can follow', () => {
  let requestId = '';
  let orderId = '';

  it('an administrator accepts the request, and the buyer is notified', async () => {
    const created = await call(requests, 'POST', {
      as: verified,
      body: { ...validRequest(), listing_id: maizeListing, quantity: 500, submit: true },
    });
    requestId = (created.body.data as { id: string }).id;
    const decided = await call(adminRequest, 'PATCH', {
      as: admin,
      params: { id: requestId },
      body: { status: 'accepted', note: 'Supplier found' },
    });
    expect(decided.status).toBe(200);
    const notes = await call(notifications, 'GET', { as: verified });
    expect((notes.body.page as { unread: number }).unread).toBeGreaterThan(0);
  });

  it('an order larger than the listing is refused', async () => {
    const result = await call(adminOrders, 'POST', {
      as: admin,
      body: {
        organization_id: verified.organizationId,
        listing_id: maizeListing,
        purchase_request_id: requestId,
        quantity: 999_999,
        unit_price_ssp: 850,
        delivery_location: 'Juba',
      },
    });
    expect(result.status).toBe(422);
  });

  it('an order for an unverified organisation is refused', async () => {
    const result = await call(adminOrders, 'POST', {
      as: admin,
      body: {
        organization_id: pending.organizationId,
        listing_id: maizeListing,
        quantity: 10,
        unit_price_ssp: 850,
        delivery_location: 'Juba',
      },
    });
    expect(result.status).toBe(422);
  });

  it('the administrator arranges the order; the database computes its total', async () => {
    const result = await call(adminOrders, 'POST', {
      as: admin,
      body: {
        organization_id: verified.organizationId,
        listing_id: maizeListing,
        purchase_request_id: requestId,
        quantity: 500,
        unit_price_ssp: 850,
        delivery_location: 'Juba',
        expected_delivery_date: '2099-01-15',
      },
    });
    expect(result.status).toBe(201);
    const data = result.body.data as { id: string; total_ssp: number; order_number: string };
    orderId = data.id;
    expect(data.total_ssp).toBe(425000);
    expect(data.order_number).toMatch(/^PO-\d{6,}$/);
  });

  it('the buyer sees the order; another organisation gets 404 for it', async () => {
    expect((await call(order, 'GET', { as: verified, params: { id: orderId } })).status).toBe(200);
    expect((await call(order, 'GET', { as: other, params: { id: orderId } })).status).toBe(404);
    const result = await call(order, 'GET', { as: verified, params: { id: orderId } });
    expect(result.text).not.toContain(farmerId);
  });

  it('progress shows in Deliveries with its timeline', async () => {
    for (const status of ['confirmed', 'ready_for_delivery', 'in_transit'] as const) {
      const moved = await call(adminOrder, 'PATCH', {
        as: admin,
        params: { id: orderId },
        body: { status, note: `Zztest ${status}` },
      });
      expect(moved.status).toBe(200);
    }
    const result = await call(deliveries, 'GET', { as: verified });
    const row = (result.body.data as { id: string; status: string; timeline: unknown[] }[]).find(
      (r) => r.id === orderId,
    );
    expect(row?.status).toBe('in_transit');
    expect(row?.timeline.length).toBeGreaterThanOrEqual(4);
  });

  it('an order cannot jump backwards, and a buyer cannot cancel it once confirmed', async () => {
    const back = await call(adminOrder, 'PATCH', {
      as: admin,
      params: { id: orderId },
      body: { status: 'pending' },
    });
    expect(back.status).toBe(422);
    const cancel = await call(order, 'PATCH', {
      as: verified,
      params: { id: orderId },
      body: { reason: 'Changed our mind' },
    });
    expect(cancel.status).toBe(422);
  });

  it('the dashboard summary counts it, from the database', async () => {
    const result = await call(summary, 'GET', { as: verified });
    expect(result.status).toBe(200);
    const kpis = (result.body.data as { kpis: { orders_in_progress: number } }).kpis;
    expect(kpis.orders_in_progress).toBeGreaterThanOrEqual(1);
  });

  it('suspension takes effect on the buyer’s next request', async () => {
    const decided = await call(adminBuyer, 'PATCH', {
      as: admin,
      params: { id: other.organizationId! },
      body: { status: 'suspended', note: 'Zztest suspension' },
    });
    expect(decided.status).toBe(200);
    expect((await call(market, 'GET', { as: other })).status).toBe(403);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as contactRequests from '../apps/web/app/api/listings/[id]/contact-requests/route';
import * as listingItem from '../apps/web/app/api/listings/[id]/route';
import * as listings from '../apps/web/app/api/listings/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { checked, data } from './helpers/scan';

/**
 * THE MARKETPLACE PUBLIC SURFACE (2026-10-05).
 *
 * These five public methods shipped with no test at all, and reading them found
 * two faults recorded in PROJECT-STATE: POST/PATCH authorised on a caller-supplied
 * `farmer_id` (a bearer capability) while the public read handed that id out, and the
 * contact-request create returned the whole row. This is the test they never had.
 *
 * Farmers cannot authenticate on main — no login route, no `farmer` role — so listing
 * creation is officer/admin scoped, not farmer-owned. That is the interim, recorded;
 * the route's shape is ready for a farmer principal when one exists.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const prisma = makeTestPrisma();

const PAYAM_A = 'CE-JUB-MUN';
const PAYAM_B = 'CE-JUB-KAT';

let admin: TestPrincipal & { password: string };
let supervisorA: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let officerB: TestPrincipal & { password: string };

let phoneSeq = 7_000_000;
const farmerBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  given_name: 'Zzmkt',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1980,
  phone: `+21192${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
  payam_id: PAYAM_A,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
  ...overrides,
});

const registerFarmer = async (as: TestPrincipal, overrides: Record<string, unknown> = {}) => {
  const r = await checked(farmers, 'POST', { as, body: farmerBody(overrides) });
  expect(r.status, 'setup registration').toBe(201);
  return data(r).id as string;
};

const listingBody = (farmerId: string, overrides: Record<string, unknown> = {}) => ({
  farmer_id: farmerId,
  trading_name: 'Zzmkt Farm',
  title: 'Zzmkt sorghum for sale',
  category: 'crop',
  product_name: 'Sorghum',
  description: 'zztest listing',
  quantity: 10,
  unit: 'kg',
  price_ssp: 100,
  negotiable: false,
  delivery_available: false,
  available_from: '2026-10-05',
  contact_phone: '+211921000599',
  status: 'listed',
  ...overrides,
});

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisorA = await createPrincipal(prisma, 'supervisor', { stateId: 'CE' });
  officerA = await createPrincipal(prisma, 'officer', { payamId: PAYAM_A });
  officerB = await createPrincipal(prisma, 'officer', { payamId: PAYAM_B });
});
afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

describe('who may create a listing (the write is no longer public)', () => {
  it('refuses an unauthenticated POST — requireRole, not a body field, is the gate now', async () => {
    const farmerA = await registerFarmer(officerA);
    const r = await checked(listings, 'POST', { body: listingBody(farmerA) });
    expect(r.status).toBe(401);
  });

  it('refuses a supervisor and a read-only caller — the route is officer+admin', async () => {
    const farmerA = await registerFarmer(officerA);
    expect(
      (await checked(listings, 'POST', { as: supervisorA, body: listingBody(farmerA) })).status,
    ).toBe(403);
  });

  it('lets an officer create for a farmer in their own caseload', async () => {
    const farmerA = await registerFarmer(officerA);
    const r = await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });
    expect(r.status).toBe(201);
  });

  it('refuses an officer naming a farmer outside their caseload — the house 404', async () => {
    const farmerB = await registerFarmer(officerB, { payam_id: PAYAM_B });
    const r = await checked(listings, 'POST', { as: officerA, body: listingBody(farmerB) });
    expect(r.status).toBe(404);
  });

  it('lets an admin create for any farmer', async () => {
    const farmerB = await registerFarmer(officerB, { payam_id: PAYAM_B });
    const r = await checked(listings, 'POST', { as: admin, body: listingBody(farmerB) });
    expect(r.status).toBe(201);
  });
});

describe('the public read distributes no internal identifier', () => {
  it('the browse list returns neither farmer_id nor contact_phone', async () => {
    const farmerA = await registerFarmer(officerA);
    await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });

    const r = await checked(listings, 'GET', {});
    expect(r.status).toBe(200);
    const rows = r.body.data as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, 'farmer_id must not reach a public read').not.toHaveProperty('farmer_id');
      expect(row, 'contact_phone must not reach a public read').not.toHaveProperty('contact_phone');
    }
  });

  it('the browse FILTERED by farmer_id still returns no contact_phone — the branch that leaked it', async () => {
    const farmerA = await registerFarmer(officerA);
    await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });

    const r = await checked(listings, 'GET', { query: { farmer_id: farmerA } });
    expect(r.status).toBe(200);
    const rows = r.body.data as Record<string, unknown>[];
    for (const row of rows) {
      expect(row).not.toHaveProperty('contact_phone');
      expect(row).not.toHaveProperty('farmer_id');
    }
  });

  it('the single listing read returns neither', async () => {
    const farmerA = await registerFarmer(officerA);
    const created = await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });
    const id = data(created).id as string;

    const r = await checked(listingItem, 'GET', { params: { id } });
    expect(r.status).toBe(200);
    expect(data(r)).not.toHaveProperty('farmer_id');
    expect(data(r)).not.toHaveProperty('contact_phone');
  });
});

describe('editing a listing is scoped the same way', () => {
  it('an officer edits a listing in their caseload; one outside is a 404; unauthenticated is 401', async () => {
    const farmerA = await registerFarmer(officerA);
    const created = await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });
    const id = data(created).id as string;

    expect(
      (
        await checked(listingItem, 'PATCH', {
          as: officerA,
          params: { id },
          body: { farmer_id: farmerA, title: 'Zzmkt edited title' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await checked(listingItem, 'PATCH', {
          as: officerB,
          params: { id },
          body: { farmer_id: farmerA, title: 'Zzmkt hijack' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await checked(listingItem, 'PATCH', {
          params: { id },
          body: { farmer_id: farmerA, title: 'Zzmkt anon' },
        })
      ).status,
    ).toBe(401);
  });
});

describe('the contact-request create returns only what the contract names', () => {
  it('a buyer gets back { id, status, created_at } and nothing about the farmer', async () => {
    const farmerA = await registerFarmer(officerA);
    const created = await checked(listings, 'POST', { as: officerA, body: listingBody(farmerA) });
    const listingId = data(created).id as string;

    const r = await checked(contactRequests, 'POST', {
      params: { id: listingId },
      body: {
        buyer_name: 'Zzbuyer Majok',
        buyer_phone: '+211926004400',
        quantity: '3 bags',
        message: 'Zz can collect',
      },
    });
    expect(r.status).toBe(201);
    expect(Object.keys(data(r)).sort()).toEqual(['created_at', 'id', 'status']);
    expect(data(r)).not.toHaveProperty('farmer_id');
    expect(data(r)).not.toHaveProperty('buyer_phone');
  });
});

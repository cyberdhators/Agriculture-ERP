import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as adminQueue from '../apps/web/app/api/admin/product-reports/route';
import * as adminDetail from '../apps/web/app/api/admin/product-reports/[id]/route';
import * as unreadCount from '../apps/web/app/api/admin/product-reports/unread-count/route';
import * as submit from '../apps/web/app/api/listings/[id]/reports/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import {
  FARMER_TEST_FAMILY,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import { call } from './helpers/request';

/**
 * ============================================================================
 * MARKETPLACE PRODUCT REPORTS, AGAINST THE REAL DATABASE.
 * ============================================================================
 *
 * Prompt 13 built these routes and reported honestly that no database test
 * covered them. This is that test.
 *
 * Two things are being proved, and the second matters more than the first.
 * One: the queue, the detail, the transitions and the count behave. Two: the
 * ONE public route in this system cannot be used to learn anything — not
 * whether a listing exists, not who reported what, not what is stored.
 */

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

requireTestEnv();
const prisma = makeTestPrisma();

const PAYAM = 'CE-JUB-MUN';
const STATE = 'CE';
/** A well-formed id matching no row: a refusal must not depend on the row existing. */
const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

let admin: TestPrincipal & { password: string };
let supervisor: TestPrincipal & { password: string };
let readOnly: TestPrincipal & { password: string };
let officer: TestPrincipal & { password: string };

let farmerId = '';
let listingId = '';
let removedListingId = '';

const farmerBody = () => ({
  id: randomUUID(),
  given_name: 'Zzreport',
  family_name: FARMER_TEST_FAMILY,
  sex: 'f',
  year_of_birth: 1990,
  phone: `+21191${String(6_100_000 + Math.floor(Math.random() * 899_999)).padStart(7, '0')}`,
  payam_id: PAYAM,
  consent: { text_version: 'v1.0-en', language: 'en', granted: true },
});

/** Listings have no creation route yet — the marketplace unit owns that. */
async function insertListing(status: 'listed' | 'draft' = 'listed'): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.produce_listing
       (farmer_id, trading_name, title, category, product_name, status, payam_id, state_id)
     VALUES ($1::uuid, 'Zztest stall', 'Zztest sorghum', 'crop'::public.listing_category,
             'Sorghum', $2::public.listing_status, $3, $4)
     RETURNING id`,
    farmerId,
    status,
    PAYAM,
    STATE,
  );
  return (row as { id: string }).id;
}

const report = async (id: string, body: unknown, headers?: Record<string, string>) =>
  call(submit, 'POST', { as: null, params: { id }, body, ...(headers ? { headers } : {}) });

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  supervisor = await createPrincipal(prisma, 'supervisor', { stateId: STATE });
  readOnly = await createPrincipal(prisma, 'read_only', { stateId: STATE });
  officer = await createPrincipal(prisma, 'officer', { payamId: PAYAM });

  const registered = await call(farmers, 'POST', { as: officer, body: farmerBody() });
  if (registered.status !== 201) throw new Error(`setup: farmer (${registered.status})`);
  farmerId = (registered.body.data as { id: string }).id;

  listingId = await insertListing('listed');
  removedListingId = await insertListing('listed');
  await prisma.$executeRawUnsafe(
    `UPDATE public.produce_listing SET deleted_at = now() WHERE id = $1::uuid`,
    removedListingId,
  );
});

afterAll(async () => {
  await sweep(prisma);
  await prisma.$disconnect();
});

describe('the public submission route', () => {
  it('accepts a report from somebody with no account at all', async () => {
    const result = await report(
      listingId,
      { reason: 'misleading_listing' },
      { 'x-forwarded-for': '10.0.0.1' },
    );
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ received: true });
  });

  it('tells the submitter nothing but that it arrived', async () => {
    const result = await report(listingId, { reason: 'other' }, { 'x-forwarded-for': '10.0.0.2' });
    const text = result.text.toLowerCase();
    // No listing state, no report status, no count, no digest, no farmer.
    for (const leak of ['listed', 'status', 'digest', 'zztest', 'farmer', 'trading']) {
      expect(text, `the submitter learned ${leak}`).not.toContain(leak);
    }
  });

  it('refuses a reason the enum does not define', async () => {
    const result = await report(
      listingId,
      { reason: 'because_i_say_so' },
      { 'x-forwarded-for': '10.0.0.3' },
    );
    expect(result.status).toBe(400);
  });

  it('refuses a description beyond the cap', async () => {
    const result = await report(
      listingId,
      { reason: 'other', description: 'z'.repeat(501) },
      { 'x-forwarded-for': '10.0.0.4' },
    );
    expect(result.status).toBe(400);
  });

  it('refuses a body carrying anything about the reporter', async () => {
    // The schema is strict. This is what stops a well-meaning client from
    // attaching a name or a phone "to help".
    const result = await report(
      listingId,
      { reason: 'other', reporter_name: 'Deng', reporter_phone: '+211912345678' },
      { 'x-forwarded-for': '10.0.0.5' },
    );
    expect(result.status).toBe(400);
  });

  it('answers a REMOVED listing exactly as it answers a fictional one', async () => {
    // The platform rule holds even for a stranger: a record they may not see
    // is indistinguishable from one that never existed. Byte-identical, so
    // nothing is learned from the shape of the refusal either.
    const removed = await report(
      removedListingId,
      { reason: 'other' },
      { 'x-forwarded-for': '10.0.0.6' },
    );
    const fictional = await report(
      DUMMY_ID,
      { reason: 'other' },
      { 'x-forwarded-for': '10.0.0.6' },
    );
    expect(removed.status).toBe(404);
    expect(fictional.status).toBe(404);
    expect(removed.text).toBe(fictional.text);
  });

  it('refuses a second report of the same listing from the same source', async () => {
    const first = await report(
      listingId,
      { reason: 'duplicate_or_spam' },
      { 'x-forwarded-for': '10.9.9.9' },
    );
    expect(first.status).toBe(201);
    const second = await report(
      listingId,
      { reason: 'duplicate_or_spam' },
      { 'x-forwarded-for': '10.9.9.9' },
    );
    expect(second.status).toBe(409);
  });

  it('lets a different source report the same listing', async () => {
    const other = await report(
      listingId,
      { reason: 'prohibited_content' },
      { 'x-forwarded-for': '10.9.9.10' },
    );
    expect(other.status).toBe(201);
  });

  it('writes an audit row that names no reporter and no description', async () => {
    const created = await report(
      listingId,
      { reason: 'counterfeit_or_fraud', description: 'Zzsecretdescription about a person' },
      { 'x-forwarded-for': '10.9.9.11' },
    );
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;
    const rows = await prisma.$queryRawUnsafe<{ action: string; after: unknown }[]>(
      // entity_id is TEXT on audit_event, not uuid: the log records what was
      // touched across tables whose keys are not all uuids.
      `SELECT action, after FROM public.audit_event WHERE entity_id = $1`,
      id,
    );
    expect(rows.map((r) => r.action)).toEqual(['product_report.created']);
    const payload = JSON.stringify(rows[0]?.after);
    expect(payload).not.toContain('Zzsecretdescription');
    expect(payload).not.toContain('10.9.9.11');
    expect(payload).not.toMatch(/digest/i);
  });
});

describe('the public route under abuse', () => {
  /*
   * Prompt 15. The endpoint is unauthenticated on purpose -- a buyer holds no
   * account -- so it is the one place in this system where anybody at all can
   * reach a handler. These tests are about what that costs.
   *
   * THERE IS NO RATE LIMITER, and these tests say so out loud rather than
   * implying otherwise. The repository has no limiter, no counter table and no
   * edge rule; the submission digest refuses a repeat of the SAME listing from
   * the SAME source and nothing else. The flood test below passes BECAUSE the
   * gap is real. When a limiter lands it will fail, and that is the point: the
   * limitation is pinned, not hidden.
   */

  /** Words that would mean a driver, a query or a table reached a stranger. */
  const DATABASE_WORDS = [
    'prisma',
    'postgres',
    'syntax',
    'uuid',
    'select ',
    'insert ',
    'public.',
    'produce_listing',
    'product_report',
    'relation',
    'column',
    'constraint',
    'digest',
  ];

  const leaks = (text: string) =>
    DATABASE_WORDS.filter((word) => text.toLowerCase().includes(word));

  it('a malformed id is answered exactly as a fictional one, with no database sentence', async () => {
    const malformed = await report(
      'not-a-uuid-at-all',
      { reason: 'other' },
      { 'x-forwarded-for': '10.1.0.1' },
    );
    const fictional = await report(
      DUMMY_ID,
      { reason: 'other' },
      { 'x-forwarded-for': '10.1.0.1' },
    );
    expect(malformed.status).toBe(404);
    expect(malformed.text).toBe(fictional.text);
    expect(leaks(malformed.text)).toEqual([]);
  });

  it('a listing that is not on sale is answered as a fictional one', async () => {
    // A draft is a listing the marketplace never showed. It must not be
    // discoverable by reporting it either.
    const draft = await insertListing('draft');
    const hidden = await report(draft, { reason: 'other' }, { 'x-forwarded-for': '10.1.0.2' });
    const fictional = await report(
      DUMMY_ID,
      { reason: 'other' },
      { 'x-forwarded-for': '10.1.0.2' },
    );
    expect(hidden.status).toBe(404);
    expect(hidden.text).toBe(fictional.text);
  });

  it('no refusal it can produce carries a query, a table or the digest', async () => {
    const refusals = await Promise.all([
      report(listingId, { reason: 'nonsense' }, { 'x-forwarded-for': '10.1.0.3' }),
      report(
        listingId,
        { reason: 'other', description: 'z'.repeat(9_000) },
        { 'x-forwarded-for': '10.1.0.4' },
      ),
      report(listingId, {}, { 'x-forwarded-for': '10.1.0.5' }),
      report(listingId, 'a string, not an object', { 'x-forwarded-for': '10.1.0.6' }),
      report(listingId, [1, 2, 3], { 'x-forwarded-for': '10.1.0.7' }),
      report(DUMMY_ID, { reason: 'other' }, { 'x-forwarded-for': '10.1.0.8' }),
      report('', { reason: 'other' }, { 'x-forwarded-for': '10.1.0.9' }),
    ]);
    for (const refusal of refusals) {
      expect(refusal.status, refusal.text).toBeGreaterThanOrEqual(400);
      expect(refusal.status, refusal.text).toBeLessThan(500);
      expect(leaks(refusal.text), refusal.text).toEqual([]);
    }
  });

  it('refuses every shape of reporter identity and contact, one at a time', async () => {
    // The strict schema is what does this. Each field is tried alone, so the
    // test cannot pass because some OTHER field in the body was the problem.
    const injections = [
      { reporter_name: 'Deng' },
      { reporter_phone: '+211912345678' },
      { reporter_email: 'someone@example.org' },
      { contact: '+211912345678' },
      { phone: '+211912345678' },
      { name: 'Deng' },
      { reported_by: DUMMY_ID },
      { submitted_by: DUMMY_ID },
    ];
    for (const [i, extra] of injections.entries()) {
      const result = await report(
        listingId,
        { reason: 'other', ...extra },
        { 'x-forwarded-for': `10.2.0.${i + 1}` },
      );
      expect(result.status, `${Object.keys(extra)[0]} was accepted`).toBe(400);
    }
  });

  it('refuses a body that tries to set the record itself', async () => {
    // status, the digest and the listing are the server's to decide. A strict
    // schema means none of them can be posted in.
    for (const [i, extra] of [
      { status: 'resolved' },
      { submission_digest: 'chosen-by-the-submitter' },
      { listing_id: DUMMY_ID },
      { created_at: '2020-01-01T00:00:00.000Z' },
      { id: DUMMY_ID },
    ].entries()) {
      const result = await report(
        listingId,
        { reason: 'other', ...extra },
        { 'x-forwarded-for': `10.3.0.${i + 1}` },
      );
      expect(result.status, `${Object.keys(extra)[0]} was accepted`).toBe(400);
    }
  });

  it('a submitted digest is not the digest that is stored', async () => {
    // Belt and braces for the one above: even the ATTEMPT leaves no trace.
    const attempt = await report(
      listingId,
      { reason: 'other', submission_digest: 'zzchosendigest' },
      { 'x-forwarded-for': '10.3.9.9' },
    );
    expect(attempt.status).toBe(400);
    const [stored] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.product_report WHERE submission_digest = 'zzchosendigest'`,
    );
    expect(stored?.n).toBe(0);
  });

  it('a body that is not JSON at all is refused before anything is read', async () => {
    const result = await call(submit, 'POST', {
      as: null,
      params: { id: listingId },
      headers: { 'content-type': 'text/plain' },
    });
    expect(result.status).toBe(415);
    expect(leaks(result.text)).toEqual([]);
  });

  it('the receipt carries two fields and nothing else', async () => {
    const listing = await insertListing('listed');
    const result = await report(listing, { reason: 'other' }, { 'x-forwarded-for': '10.4.0.1' });
    expect(result.status).toBe(201);
    expect(Object.keys(result.body.data as object).sort()).toEqual(['id', 'received']);
    expect(Object.keys(result.body).sort()).toEqual(['data']);
  });

  it('a stranger is answered no differently from a signed-in member of staff', async () => {
    // A session neither helps nor hinders here, because this route scopes
    // nothing to one. If that ever stops being true it is a leak.
    const listing = await insertListing('listed');
    const anonymous = await report(listing, { reason: 'other' }, { 'x-forwarded-for': '10.5.0.1' });
    const signedIn = await call(submit, 'POST', {
      as: supervisor,
      params: { id: listing },
      body: { reason: 'other' },
      headers: { 'x-forwarded-for': '10.5.0.1' },
    });
    expect(anonymous.status).toBe(201);
    // Same source, same listing: the second is the digest refusal either way.
    expect(signedIn.status).toBe(409);
    const alsoAnonymous = await report(
      listing,
      { reason: 'other' },
      { 'x-forwarded-for': '10.5.0.1' },
    );
    expect(alsoAnonymous.text).toBe(signedIn.text);
  });

  it('NOTHING STOPS A FLOOD — this is the documented gap, pinned by a test', async () => {
    /*
     * Twelve reports, twelve listings, twelve source addresses, one loop, no
     * waiting: every one is accepted. `x-forwarded-for` is a header the caller
     * writes, so varying it costs an attacker nothing, and the digest -- which
     * is only ever a courtesy against double-submission -- never fires.
     *
     * THIS TEST MUST FAIL WHEN A RATE LIMITER IS ADDED. Rewrite it then to
     * assert the limiter's configured behaviour; do not delete it. A limiter
     * needs a shared store this project does not have, which is CLAUDE.md
     * section 5 territory -- a human's decision, not a session's.
     */
    const accepted: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const listing = await insertListing('listed');
      const result = await report(
        listing,
        { reason: 'duplicate_or_spam' },
        { 'x-forwarded-for': `10.6.0.${i + 1}` },
      );
      accepted.push(result.status);
    }
    expect(accepted).toEqual(Array.from({ length: 12 }, () => 201));
    expect(accepted.some((status) => status === 429)).toBe(false);
  });
});

describe('the administrator queue', () => {
  it('lists reports for an administrator, newest first', async () => {
    const result = await call(adminQueue, 'GET', { as: admin });
    expect(result.status).toBe(200);
    const rows = result.body.data as { id: string; created_at: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const dates = rows.map((r) => r.created_at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('never returns the submission digest or a description in the list', async () => {
    const result = await call(adminQueue, 'GET', { as: admin });
    expect(result.text).not.toMatch(/digest/i);
    expect(result.text).not.toContain('Zzsecretdescription');
  });

  it('pages by cursor and does not repeat a row', async () => {
    const first = await call(adminQueue, 'GET', { as: admin, query: { limit: '2' } });
    expect(first.status).toBe(200);
    const page = first.body.page as { cursor: string | null; hasMore: boolean };
    if (page.hasMore && page.cursor) {
      const second = await call(adminQueue, 'GET', {
        as: admin,
        query: { limit: '2', cursor: page.cursor },
      });
      const firstIds = (first.body.data as { id: string }[]).map((r) => r.id);
      const secondIds = (second.body.data as { id: string }[]).map((r) => r.id);
      expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
    }
  });

  it('filters by status', async () => {
    const result = await call(adminQueue, 'GET', { as: admin, query: { status: 'new' } });
    expect(result.status).toBe(200);
    for (const row of result.body.data as { status: string }[]) expect(row.status).toBe('new');
  });
});

describe('the server enforces the state machine', () => {
  /** A fresh report to drive transitions through, so tests do not fight. */
  async function freshReport(): Promise<string> {
    const listing = await insertListing('listed');
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO public.product_report (listing_id, reason) VALUES ($1::uuid, 'other')
       RETURNING id`,
      listing,
    );
    return (row as { id: string }).id;
  }

  const moderate = (id: string, action: string, as = admin) =>
    call(adminDetail, 'PATCH', { as, params: { id }, body: { action } });

  it('new → reviewing → resolved is allowed', async () => {
    const id = await freshReport();
    expect((await moderate(id, 'mark_reviewing')).status).toBe(200);
    const resolved = await moderate(id, 'resolve');
    expect(resolved.status).toBe(200);
    expect((resolved.body.data as { status: string }).status).toBe('resolved');
  });

  it('new → dismissed is allowed', async () => {
    const id = await freshReport();
    const dismissed = await moderate(id, 'dismiss');
    expect(dismissed.status).toBe(200);
    expect((dismissed.body.data as { status: string }).status).toBe('dismissed');
  });

  it('RESOLVED IS TERMINAL — no further decision is accepted', async () => {
    const id = await freshReport();
    await moderate(id, 'resolve');
    for (const action of ['mark_reviewing', 'dismiss', 'resolve']) {
      const again = await moderate(id, action);
      expect(again.status, `${action} was accepted on a resolved report`).toBe(422);
    }
  });

  it('DISMISSED IS TERMINAL too', async () => {
    const id = await freshReport();
    await moderate(id, 'dismiss');
    expect((await moderate(id, 'resolve')).status).toBe(422);
  });

  it('records a status change in the audit log, without the description', async () => {
    const id = await freshReport();
    await prisma.$executeRawUnsafe(
      `UPDATE public.product_report SET description = 'Zzauditleak sentence' WHERE id = $1::uuid`,
      id,
    );
    await moderate(id, 'dismiss');
    const rows = await prisma.$queryRawUnsafe<{ action: string; after: unknown }[]>(
      `SELECT action, after FROM public.audit_event
        WHERE entity_id = $1 AND action = 'product_report.status_changed'`,
      id,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((r) => r.after))).not.toContain('Zzauditleak');
  });

  it('a nonexistent report is 404 and reveals nothing', async () => {
    const result = await moderate(DUMMY_ID, 'dismiss');
    expect(result.status).toBe(404);
  });

  it('refuses a non-administrator', async () => {
    const id = await freshReport();
    for (const who of [supervisor, readOnly, officer]) {
      expect((await moderate(id, 'dismiss', who)).status).toBe(403);
    }
  });
});

describe('removing a listing is soft, and the report survives it', () => {
  it('removes the listing, keeps the report, destroys nothing', async () => {
    const listing = await insertListing('listed');
    const [created] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO public.product_report (listing_id, reason) VALUES ($1::uuid, 'prohibited_content')
       RETURNING id`,
      listing,
    );
    const reportId = (created as { id: string }).id;

    const result = await call(adminDetail, 'PATCH', {
      as: admin,
      params: { id: reportId },
      body: { action: 'remove_listing' },
    });
    expect(result.status).toBe(200);

    // The listing is gone from the active view but the ROW remains.
    const [active] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.produce_listing_active WHERE id = $1::uuid`,
      listing,
    );
    const [stored] = await prisma.$queryRawUnsafe<{ n: number; deleted: boolean }[]>(
      `SELECT count(*)::int AS n, bool_or(deleted_at IS NOT NULL) AS deleted
         FROM public.produce_listing WHERE id = $1::uuid`,
      listing,
    );
    expect(active!.n).toBe(0);
    expect(stored!.n).toBe(1);
    expect(stored!.deleted).toBe(true);

    // The report is still there to investigate.
    const detail = await call(adminDetail, 'GET', { as: admin, params: { id: reportId } });
    expect(detail.status).toBe(200);
    expect((detail.body.data as { status: string }).status).toBe('resolved');

    const audit = await prisma.$queryRawUnsafe<{ action: string }[]>(
      `SELECT action FROM public.audit_event WHERE entity_id = $1`,
      listing,
    );
    expect(audit.map((a) => a.action)).toContain('product_report.listing_removed');
  });
});

describe('the detail view', () => {
  it('returns the description but never the digest', async () => {
    const listing = await insertListing('listed');
    const [created] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO public.product_report (listing_id, reason, description, submission_digest)
       VALUES ($1::uuid, 'other', 'Zzvisible to an administrator', 'zzdigestvalue')
       RETURNING id`,
      listing,
    );
    const result = await call(adminDetail, 'GET', {
      as: admin,
      params: { id: (created as { id: string }).id },
    });
    expect(result.status).toBe(200);
    expect(result.text).toContain('Zzvisible to an administrator');
    expect(result.text, 'the submission digest reached an administrator').not.toContain(
      'zzdigestvalue',
    );
    expect(result.text).not.toMatch(/digest/i);
  });
});

describe('the unread count comes from the database', () => {
  it('counts the reports actually in the new state', async () => {
    const [counted] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public.product_report_active WHERE status = 'new'`,
    );
    const result = await call(unreadCount, 'GET', { as: admin });
    expect(result.status).toBe(200);
    expect((result.body.data as { unread: number }).unread).toBe(counted?.n);
  });

  it('falls as a report leaves the new state', async () => {
    const before = ((await call(unreadCount, 'GET', { as: admin })).body.data as { unread: number })
      .unread;
    const queue = await call(adminQueue, 'GET', { as: admin, query: { status: 'new' } });
    const target = (queue.body.data as { id: string }[])[0];
    expect(target).toBeDefined();

    await call(adminDetail, 'PATCH', {
      as: admin,
      params: { id: target!.id },
      body: { action: 'dismiss' },
    });

    const after = ((await call(unreadCount, 'GET', { as: admin })).body.data as { unread: number })
      .unread;
    expect(after).toBe(before - 1);
  });

  it('reports a real zero as zero', async () => {
    // The Prompt 12 rule is that an UNAVAILABLE count shows no badge. A
    // measured zero is different and must be reported as the number it is.
    await prisma.$executeRawUnsafe(
      `UPDATE public.product_report SET status = 'dismissed' WHERE status = 'new'`,
    );
    const result = await call(unreadCount, 'GET', { as: admin });
    expect((result.body.data as { unread: number }).unread).toBe(0);
  });
});

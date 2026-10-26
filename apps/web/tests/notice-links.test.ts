import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOTICE_REF_KINDS } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import { noticeRefColumns, presentNoticeRef } from '../lib/api/notice-ref';
import { ACCOUNT_NOTICES, popHref } from '../lib/farmer-notices';

/**
 * A STORED NOTICE OPENS THE EXACT POST OR CONVERSATION (2026-11-01, live
 * test). Tapping a match alert in the notifications list opened the general
 * market page while its live pop opened the buying request itself: the live
 * event carried ref_kind/ref_id and the stored row did not. The row now keeps
 * them, every notifications API answers them, and both lists open a notice
 * through popHref, as the pop does. docs/DECISIONS.md, "A stored notice opens
 * the exact post or conversation".
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');
const ID = '5f1d7c3e-9a4b-4c2d-8e6f-0a1b2c3d4e5f';

describe('popHref with a stored ref', () => {
  const match = ACCOUNT_NOTICES.match_buying_request.title;
  const listing = ACCOUNT_NOTICES.match_listing.title;
  const message = ACCOUNT_NOTICES.message_listing.title;

  it('a match alert about a buying request opens that request, on either side', () => {
    for (const side of ['farmer', 'buyer'] as const) {
      expect(popHref({ side, title: match, refKind: 'buying_request', refId: ID })).toBe(
        `/market/requests/${ID}`,
      );
    }
  });

  it('a match alert about a listing opens that listing', () => {
    expect(popHref({ side: 'farmer', title: listing, refKind: 'listing', refId: ID })).toBe(
      `/market/${ID}`,
    );
  });

  it('a new-message notice opens the conversation, in the side’s own Messages', () => {
    expect(popHref({ side: 'farmer', title: message, refKind: 'conversation', refId: ID })).toBe(
      `/farmer/account/messages?c=${ID}`,
    );
    expect(popHref({ side: 'buyer', title: message, refKind: 'conversation', refId: ID })).toBe(
      `/buyer/messages?c=${ID}`,
    );
  });

  it('an older notice with no ref keeps today’s place', () => {
    expect(popHref({ side: 'farmer', title: match, refKind: null, refId: null })).toBe(
      '/market/requests',
    );
    expect(popHref({ side: 'farmer', title: listing })).toBe('/market');
    expect(popHref({ side: 'buyer', title: message, refKind: null, refId: null })).toBe(
      '/buyer/messages',
    );
  });

  it('a kind it does not know, or a kind with no id, is ignored', () => {
    expect(popHref({ side: 'farmer', title: match, refKind: 'advice_case', refId: ID })).toBe(
      '/market/requests',
    );
    expect(popHref({ side: 'farmer', title: match, refKind: 'listing', refId: null })).toBe(
      '/market/requests',
    );
  });

  it('an id is encoded into the path, never inserted raw', () => {
    expect(popHref({ side: 'farmer', title: null, refKind: 'listing', refId: '../x?y' })).toBe(
      '/market/..%2Fx%3Fy',
    );
  });
});

describe('what an API answers for a stored ref', () => {
  it('a known kind with its id', () => {
    expect(presentNoticeRef({ ref_kind: 'listing', ref_id: ID })).toEqual({
      ref_kind: 'listing',
      ref_id: ID,
    });
  });

  it('both null for an older row, an unknown kind or half a ref', () => {
    const none = { ref_kind: null, ref_id: null };
    expect(presentNoticeRef({ ref_kind: null, ref_id: null })).toEqual(none);
    expect(presentNoticeRef({ ref_kind: 'advice_case', ref_id: ID })).toEqual(none);
    expect(presentNoticeRef({ ref_kind: 'listing', ref_id: null })).toEqual(none);
  });

  it('selects the columns once migrated, and NULLs before', () => {
    expect(noticeRefColumns(true, 'n')).toBe('n.ref_kind, n.ref_id::text AS ref_id');
    expect(noticeRefColumns(false, 'n')).toBe('NULL::text AS ref_kind, NULL::text AS ref_id');
  });
});

describe('the ref is stored, answered and used (read as text)', () => {
  it('the migration allows exactly NOTICE_REF_KINDS, and a whole ref or none', () => {
    const sql = readFileSync(
      join(root, 'prisma/migrations/20261101100000_notification_ref/migration.sql'),
      'utf8',
    );
    // 2026-11-03 (lane-trust): the kinds were widened by one ('rating') in a
    // later migration, which re-creates the kind CHECK; the latest list rules.
    const widened = readFileSync(
      join(root, 'prisma/migrations/20261103090000_archive_and_deal_ratings/migration.sql'),
      'utf8',
    );
    const listed = /"ref_kind" IN \(([^)]*)\)/.exec(widened)?.[1] ?? '';
    const kinds = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual([...NOTICE_REF_KINDS].sort());
    expect(sql).toMatch(/\("ref_kind" IS NULL\) = \("ref_id" IS NULL\)/);
    expect(sql).not.toMatch(/\bDROP\b/);
    // The widening drops and re-adds the kind CHECK only, never the whole-ref one.
    expect(widened).toMatch(/DROP CONSTRAINT "notification_ref_kind_known";/);
    expect(widened).not.toMatch(/DROP CONSTRAINT "notification_ref_whole"/);
  });

  it('notifyAccountWithId writes the ref it is given into the row', () => {
    const notify = read('lib/api/notify.ts');
    expect(notify).toMatch(/title, body, ref_kind, ref_id\)/);
    expect(notify).toMatch(/keepRef\.kind,\s*keepRef\.id/);
  });

  it('match alerts and new-message notices pass a ref', () => {
    expect(read('lib/api/match-alerts.ts')).toMatch(
      /notifyAccountWithId\(tx, \{ authUserId \}, notice, SYSTEM, \{\s*kind,\s*id: postId/,
    );
    const notify = read('lib/api/notify.ts');
    expect(notify.match(/kind: 'conversation',\s*id: conversationId/g)?.length).toBe(2);
  });

  it('every notifications list and detail API answers ref_kind and ref_id', () => {
    for (const path of [
      'app/api/farmer/notifications/route.ts',
      'app/api/buyer/notifications/route.ts',
      'app/api/account/notifications/[id]/route.ts',
      'app/api/notifications/route.ts',
      'app/api/notifications/[id]/route.ts',
    ]) {
      const text = read(path);
      expect(text, path).toMatch(/noticeRefColumns\(/);
      expect(text, path).toMatch(/\.\.\.presentNoticeRef\(/);
    }
  });

  it('the farmer and buyer lists open a notice through popHref with its ref', () => {
    for (const [path, side] of [
      ['components/farmer/FarmerNotifications.tsx', 'farmer'],
      ['components/buyer/BuyerNotifications.tsx', 'buyer'],
    ] as const) {
      const text = read(path);
      expect(text, path).toMatch(/import \{[^}]*\bpopHref\b[^}]*\} from '@\/lib\/farmer-notices'/);
      expect(text, path).toMatch(new RegExp(`popHref\\(\\{\\s*side: '${side}'`));
      expect(text, path).toMatch(/refKind: (notification|n)\.ref_kind/);
      expect(text, path).toMatch(/refId: (notification|n)\.ref_id/);
      expect(text, path).not.toMatch(/\bnoticeHref\(/);
    }
  });
});

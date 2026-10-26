import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * "ARCHIVE FOR ME" AND RATINGS (2026-11-03, lane-trust). Read from the source,
 * because the promises are in SQL text: archiving is per side and never stops
 * a message, a new message brings a chat back, no new conversation is ever
 * closed, and a rating's public face names nobody beyond a public name.
 */
const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('archive for me', () => {
  const messaging = read('lib/api/messaging.ts');

  it('a new message clears both sides’ archive marks', () => {
    const insert = messaging.slice(messaging.indexOf('export async function insertMessage'));
    expect(insert).toMatch(/owner_archived_at = NULL, starter_archived_at = NULL/);
  });

  it('archiving writes the viewer’s own side only, and publishes nothing live', () => {
    const fn = messaging.slice(messaging.indexOf('export async function setArchived'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/const column = side === 'owner' \? 'owner' : 'starter';/);
    expect(body).toMatch(/\$\{column\}_archived_at = now\(\)/);
    expect(body).not.toMatch(/emitRealtime|announce|notify/);
    expect(body).not.toMatch(/blocked_at/);
  });

  it('the old close route archives instead, and nothing sets blocked_at any more', () => {
    const block = read('app/api/conversations/[id]/block/route.ts');
    expect(block).toMatch(/setArchived\(tx, id, viewer, auth, true\)/);
    for (const file of [
      'app/api/conversations/[id]/block/route.ts',
      'app/api/conversations/[id]/archive/route.ts',
      'lib/api/messaging.ts',
    ]) {
      expect(read(file), file).not.toMatch(/SET blocked_at/);
    }
  });

  it('the inbox leaves out what the viewer archived, unless asked for the Archived tab', () => {
    const route = read('app/api/conversations/route.ts');
    expect(route).toMatch(/\$\{archived \? '' : 'NOT '\}\$\{viewerArchivedSql\('\$1', '\$2'\)\}/);
  });

  it('a closed conversation from before stays closed: sending in it is still refused', () => {
    const send = read('app/api/conversations/[id]/messages/route.ts');
    expect(send).toMatch(/conversation_blocked/);
  });
});

describe('ratings', () => {
  const lib = read('lib/api/ratings.ts');

  it('a rater is named only by a published profile or a published organisation', () => {
    expect(lib).toMatch(/o\.status = 'published'/);
    expect(lib).toMatch(/ap\.status = 'published'/);
  });

  it('a suspended or disabled rater’s ratings are hidden (suspended_at, as profiles)', () => {
    const live = lib.slice(lib.indexOf('export const RATER_LIVE_SQL'));
    expect(live).toMatch(/fa\.suspended_at IS NULL/);
    expect(live).toMatch(/ba\.suspended_at IS NULL/);
    expect(live).toMatch(/fs\.suspended_at IS NOT NULL/);
  });

  it('the public profile routes add the summary, never a raw rating row', () => {
    for (const file of [
      'app/api/profiles/p/[publicId]/route.ts',
      'app/api/organizations/[id]/profile/route.ts',
    ]) {
      const text = read(file);
      expect(text, file).toMatch(/ratingSummaryOf\(prisma,/);
      expect(text, file).not.toMatch(/deal_rating/);
    }
  });

  it('a rating is audited without its comment, and the rated party is notified with a ref', () => {
    const route = read('app/api/ratings/route.ts');
    expect(route).toMatch(/action: 'rating\.created'/);
    expect(route).toMatch(/with_comment: body\.comment !== undefined/);
    expect(route).not.toMatch(/after: \{[^}]*\bcomment: body/);
    expect(route).toMatch(/'rating_received'/);
    expect(route).toMatch(/kind: 'rating' as const/);
  });

  it('moderation needs content.moderate, and read-only staff never write', () => {
    const list = read('app/api/admin/ratings/route.ts');
    const one = read('app/api/admin/ratings/[id]/route.ts');
    expect(list).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
    expect(one).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
    expect(one).toMatch(/requireWriter\(auth\)/);
    expect(one).toMatch(/roles: \['admin', 'supervisor'\]/);
  });
});

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * WHICH ROUTES ADMIT A BUYER IS COUNTED, NOT TRUSTED (B13, C-14B.16).
 *
 * A buyer is an outside party. `requireRole` admits one only to a route whose
 * `roles` names `BUYER_ROLE`, and `ALL_ROLES` deliberately excludes it -- so a
 * route grows a buyer by somebody typing the name. This pins every place that
 * has been typed, in both directions:
 *
 *   1. Every route under app/api/buyer/ (bar the public registration) admits
 *      a buyer and NOTHING ELSE. A staff role on a buyer route would put the
 *      register's scope helpers behind a buyer address.
 *   2. Outside app/api/buyer/, exactly the expected routes admit a buyer, and
 *      none of them reads or writes a farmer, a farm, a visit or an officer.
 *
 * And it checks that no buyer route reads a column a buyer must never see.
 */
const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url));

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const rel = (file: string) =>
  file
    .slice(API_DIR.length + 1)
    .replace(/\\/g, '/')
    .replace(/\/route\.ts$/, '');

const files = routeFiles(API_DIR);
const source = (file: string) => readFileSync(file, 'utf8');
const admitsBuyer = (file: string) => /BUYER_ROLE|'buyer'\s*\]/.test(source(file));

/**
 * Outside app/api/buyer: the two reference reads a signed-in buyer needs, and
 * (2026-10-19) the account's own "who you are, what you do", shared by the
 * farmer and buyer sides of one account.
 */
const BUYER_OUTSIDE_ITS_TREE = [
  'account/profile',
  // 2026-10-27: the open correction requests on the account's own posts, keyed
  // by the session's sign-in (its farmer and buyer records only).
  'account/corrections',
  // 2026-10-28: person-level blocks -- the caller's own list, block from a
  // conversation they are part of, and unblock their own (lib/api/blocks.ts).
  'account/blocks',
  'account/blocks/[id]',
  // PUBLIC PROFILES V2 (2026-10-23): the account's own public profile -- one
  // per sign-in, shared by its farmer and buyer sides -- with its publish,
  // unpublish and photo steps. Each reads and writes the caller's own row only
  // (keyed by the session's sign-in, lib/api/public-profile.ts).
  'account/public-profile',
  'account/public-profile/photo',
  'account/public-profile/photo/confirm',
  'account/public-profile/photo/upload-url',
  'account/public-profile/publish',
  'account/public-profile/unpublish',
  // The public profile page is public; it names the buyer role only to
  // recognise a signed-in caller, who alone may see a phone the owner shows.
  'profiles/p/[publicId]',
  // INDEPENDENT ADVICE (2026-10-22): a buyer account asks for advice and may
  // offer it, as a farmer account can. Owned by the sign-in like messaging;
  // every case read is filtered to its two participants (lib/api/advice.ts).
  'advice/cases',
  'advice/cases/[id]',
  'advice/my-provider',
  // APPROVED ADVISERS (2026-10-24): the account's own optional application,
  // keyed by the session's sign-in through its own advice profile.
  'advice/my-provider/application',
  'advice/my-provider/application/reply',
  'advice/my-provider/application/withdraw',
  // ADVICE PHOTOS (2026-10-25): either participant of a case adds or removes
  // a photo; loadCase finds the case for its two participants only.
  'advice/cases/[id]/attachments/[attachmentId]',
  'advice/cases/[id]/attachments/confirm',
  'advice/cases/[id]/attachments/upload-url',
  // ADVICE REFERRAL (2026-10-25): the case's provider proposes, its requester
  // accepts or declines; the same participants-only loadCase.
  'advice/cases/[id]/referral',
  // 2026-10-20: an account deletes itself (its own records only).
  'account/delete',
  // IN-APP MESSAGING (2026-10-20): conversations belong to sign-ins, and every
  // read is filtered to the caller's own (lib/api/messaging.ts).
  'conversations',
  'conversations/[id]',
  'conversations/[id]/block',
  'conversations/[id]/messages',
  'conversations/unread',
  'locations',
  'me',
  // LISTINGS LANE (2026-10-19): a buyer posts and manages public buying
  // requests (as a farmer can), and reads the phone a poster published for
  // contact on a buying request or a service. Each scopes to the session's
  // own account (marketPoster) or to what is on the public market; none
  // returns a farmer's legal name, id or record.
  'buying-requests',
  'buying-requests/[id]',
  'buying-requests/[id]/contact',
  'buying-requests/mine',
  'services/[id]/contact',
  // SERVICES FOR ANY ACCOUNT (2026-10-26): a buyer account -- an institute,
  // college, research body, advisory organisation or adviser -- offers and
  // manages its own services, as a farmer can. The owner is the session's
  // account (marketPoster), in every WHERE; nothing of a farmer is returned.
  'services',
  'services/[id]',
  'services/mine',
  // 2026-10-21: "Contact CORWADO" is public; it names the buyer role only to
  // recognise a signed-in sender, and reads nothing but that sender's own phone.
  'support',
  // TEAM ACCESS (2026-10-27): organisational profiles any account may create
  // and act for. Every read is keyed by the session's sign-in and its ACTIVE
  // membership (lib/api/organizations.ts requireMember / actingAs); a
  // non-member gets 404. Names are "Mary K."; no phone, email or record id
  // of another person is returned.
  'organizations',
  'organizations/acting',
  'organizations/invitations',
  'organizations/[id]',
  'organizations/[id]/close',
  'organizations/[id]/invitations',
  'organizations/[id]/invitations/[invitationId]/cancel',
  'organizations/[id]/leave',
  'organizations/[id]/members',
  'organizations/[id]/members/[memberId]',
  'organizations/[id]/members/[memberId]/revoke',
  'organizations/[id]/membership',
  'organizations/[id]/transfer',
];

describe('buyer routes are counted, not trusted', () => {
  it('finds the buyer routes at all, so this cannot pass by checking nothing', () => {
    expect(files.filter((f) => rel(f).startsWith('buyer/')).length).toBeGreaterThanOrEqual(10);
  });

  it('every route under buyer/ admits a buyer and no other role', () => {
    const wrong = files
      .filter((f) => rel(f).startsWith('buyer/') && rel(f) !== 'buyer/register')
      .filter((f) => {
        const text = source(f);
        const rolesLines = text.match(/roles:\s*[^\n]*/g) ?? [];
        return (
          rolesLines.length === 0 ||
          rolesLines.some((line) => !/roles:\s*\[BUYER_ROLE\]/.test(line))
        );
      })
      .map(rel);
    expect(wrong, 'a buyer route declares roles other than [BUYER_ROLE]').toEqual([]);
  });

  it('outside buyer/, only the expected routes admit a buyer', () => {
    const outside = files
      .filter((f) => !rel(f).startsWith('buyer/') && admitsBuyer(f))
      .map(rel)
      .sort();
    expect(outside).toEqual([...BUYER_OUTSIDE_ITS_TREE].sort());
  });

  it('the registration route is public and grants nothing else', () => {
    const text = readFileSync(join(API_DIR, 'buyer/register/route.ts'), 'utf8');
    expect(text).toMatch(/roles:\s*'public'/);
    expect(text).not.toMatch(/GET:\s*\{/);
    // It must never let an applicant set their own standing.
    expect(text).not.toMatch(/verification_status\s*=\s*\$/);
  });

  it('no buyer route selects a column a buyer must never see', () => {
    const forbidden = [
      /\bcontact_phone\b/,
      /\bpickup_notes\b/,
      /\bnational_id\b/,
      /\bphoto_storage_paths\b/,
      /\bboundary\b/,
      /\bcentroid\b/,
      /\bf\.phone\b/,
      /\bgiven_name\b(?![^\n]*\bb\.)/, // a farmer's name; the buyer's own is b.given_name
    ];
    const leaks: string[] = [];
    // Profile and registration are exempt: both handle the BUYER'S OWN name and
    // phone, which the patterns below cannot tell from a farmer's.
    for (const f of files.filter(
      (f) => rel(f).startsWith('buyer/') && !['buyer/profile', 'buyer/register'].includes(rel(f)),
    )) {
      const text = source(f);
      for (const pattern of forbidden) {
        if (pattern.test(text)) leaks.push(`${rel(f)}: ${pattern.source}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

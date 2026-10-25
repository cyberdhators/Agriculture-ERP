import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * TEAM ACCESS, READ AS TEXT (2026-10-27). docs/DECISIONS.md, "Organisational
 * profiles and team access".
 *
 * The rules that keep an organisation's team and inbox to its members are a
 * few lines in each route. This reads those lines, so a route that forgets
 * one fails here, on the branch that writes it. The permission logic itself
 * is tested in packages/shared/tests/organization.test.ts.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(web, dir))) {
    const path = join(dir, name);
    if (statSync(join(web, path)).isDirectory()) out.push(...routes(path));
    else if (name === 'route.ts') out.push(path.replace(/\\/g, '/'));
  }
  return out;
}

const orgRoutes = routes('app/api/organizations');

describe('organisation routes are keyed by the signed-in person', () => {
  it('finds the organisation routes at all', () => {
    expect(orgRoutes.length).toBeGreaterThanOrEqual(14);
  });

  it('every route but the public profile names the caller from the session', () => {
    for (const file of orgRoutes.filter((f) => !f.endsWith('[id]/profile/route.ts'))) {
      expect(read(file), file).toMatch(/personOf\(auth\)/);
    }
  });

  it('every route about one organisation checks the caller is an active member', () => {
    for (const file of orgRoutes.filter(
      (f) => f.includes('/[id]/') && !f.endsWith('[id]/profile/route.ts'),
    )) {
      expect(read(file), file).toMatch(/requireMember\(/);
    }
  });

  it('every team change needs team.manage', () => {
    for (const file of [
      'app/api/organizations/[id]/members/[memberId]/route.ts',
      'app/api/organizations/[id]/members/[memberId]/revoke/route.ts',
      'app/api/organizations/[id]/invitations/route.ts',
      'app/api/organizations/[id]/invitations/[invitationId]/cancel/route.ts',
      'app/api/organizations/[id]/transfer/route.ts',
      'app/api/organizations/[id]/close/route.ts',
    ]) {
      expect(read(file), file).toMatch(/permission: 'team\.manage'/);
    }
    expect(read('app/api/organizations/[id]/route.ts')).toMatch(/permission: 'profile\.edit'/);
  });

  it('every write is audited in its transaction', () => {
    // Switching who you act as changes no record (a cookie), so it is not audited.
    for (const file of orgRoutes.filter((f) => !f.endsWith('organizations/acting/route.ts'))) {
      const text = read(file);
      if (!/(POST|PATCH):\s*\{/.test(text)) continue;
      expect(text, file).toMatch(/audited\(prisma/);
      expect(text, file).toMatch(/writeAudit\(|closeOrganization\(/);
    }
  });

  it('the public profile shows a member only with their own agreement', () => {
    const text = read('app/api/organizations/[id]/profile/route.ts');
    expect(text).toMatch(/roles: 'public'/);
    expect(text).toMatch(/o\.status = 'published'/);
    expect(text).toMatch(/org\.show_team/);
    expect(text).toMatch(/m\.show_on_profile = true/);
    // Only the member sets that agreement: no other route writes it.
    const writers = orgRoutes.filter((f) => /show_on_profile = \$/.test(read(f)));
    expect(writers).toEqual(['app/api/organizations/[id]/membership/route.ts']);
  });
});

describe('invitations and acting-as', () => {
  it('an invitation stores the hash of its token, never the token', () => {
    const text = read('app/api/organizations/[id]/invitations/route.ts');
    expect(text).toMatch(/hashInvitationToken\(token\),/);
    expect(text).not.toMatch(/token_hash[^\n]*\n[^\n]*\btoken,\n/);
    expect(read('lib/api/organizations.ts')).toMatch(/createHash\('sha256'\)/);
  });

  it('accepting checks the recipient against the contacts they signed in with', () => {
    const text = read('app/api/organizations/invitations/route.ts');
    expect(text).toMatch(/callerContacts\(prisma, me\)/);
    expect(text).toMatch(/acceptIssue\(\{/);
    expect(text).toMatch(/invitationIsFor\(invitation, contacts\)/);
  });

  it('acting-as re-checks an active membership of an open organisation on every request', () => {
    const text = read('lib/api/organizations.ts');
    const at = text.indexOf('export async function resolveActing');
    const body = text.slice(at, at + 1200);
    expect(body).toMatch(/m\.status = 'active'/);
    expect(body).toMatch(/o\.closed_at IS NULL/);
    expect(text).toMatch(
      /if \(acting === 'ended'\) throw unprocessable\('organization_access_ended'\)/,
    );
    expect(text).toMatch(/HttpOnly; SameSite=Lax/);
  });

  it('every conversation route reads the inbox through the viewer, never the bare sign-in', () => {
    for (const file of routes('app/api/conversations')) {
      const text = read(file);
      expect(text, file).toMatch(/viewerOf\(prisma, request, auth, 'inbox\.(read|reply)'\)/);
      expect(text, file).not.toMatch(/\bme\(auth\)/);
    }
  });

  it('a person acting for themselves never sees an organisation conversation', () => {
    const text = read('lib/api/messaging.ts');
    expect(text).toMatch(/c\.owner_organization_id IS NULL AND c\.owner_auth_user_id = /);
    expect(text).toMatch(/c\.starter_organization_id IS NULL AND c\.starter_auth_user_id = /);
  });

  it('posting for an organisation needs listings.manage', () => {
    expect(read('lib/api/market-posts.ts')).toMatch(
      /actingWith\(db, request, auth, 'listings\.manage'\)/,
    );
    for (const file of [
      'app/api/buying-requests/route.ts',
      'app/api/buying-requests/[id]/route.ts',
      'app/api/buying-requests/mine/route.ts',
      'app/api/services/route.ts',
      'app/api/services/[id]/route.ts',
      'app/api/services/mine/route.ts',
    ]) {
      expect(read(file), file).toMatch(/await actingPoster\(prisma, request, auth\)/);
    }
  });

  // 2026-10-28 (user journeys): produce listings too, through the farmer routes.
  it('a produce listing for an organisation needs listings.manage and stays apart', () => {
    for (const file of [
      'app/api/farmer/listings/route.ts',
      'app/api/farmer/listings/[id]/route.ts',
      'app/api/farmer/listings/[id]/sales/route.ts',
    ]) {
      expect(read(file), file).toMatch(
        /await actingWith\(prisma, request, auth, 'listings\.manage'\)/,
      );
    }
    const accounts = read('lib/api/farmer-accounts.ts');
    expect(accounts).toMatch(/farmer_id = \$\{param\}::uuid AND organization_id IS NULL/);
    expect(accounts).toMatch(/organization_id = \$\{param\}::uuid/);
  });
});

describe('deletion and recovery', () => {
  it('deleting the last administrator is refused until they choose to close', () => {
    const text = read('app/api/account/delete/route.ts');
    expect(text).toMatch(/deletionResolution\(teams\)/);
    expect(text).toMatch(/body\.close_organizations !== true/);
    expect(text).toMatch(/unprocessable\('organization_last_admin_delete'\)/);
  });

  it('exceptional recovery is staff-only, permissioned, re-authenticated and audited', () => {
    const text = read('app/api/admin/organizations/[id]/recover/route.ts');
    expect(text).toMatch(/roles: \['admin'\]/);
    expect(text).toMatch(/requirePermission\(auth, 'support\.handle'\)/);
    expect(text).toMatch(/requireReauth\(await reauthenticate\(/);
    expect(text).toMatch(/action: 'organization\.recovered'/);
  });
});

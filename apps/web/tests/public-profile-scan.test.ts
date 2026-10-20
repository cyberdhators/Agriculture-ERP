import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A PUBLIC PROFILE IS SHOWN ONLY WHEN ITS OWNER PUBLISHED IT AND ITS ACCOUNT
 * IS LIVE, AND NEVER CARRIES A SIGN-IN ID (2026-10-23, public profiles v2).
 *
 * Like the suspension filters, this is SQL text, not one function, so this
 * reads the text and asserts each guard is there. A query that drops the
 * published filter would publish drafts; one that drops the live filter would
 * show a suspended or deleted account; a response that names auth_user_id
 * would leak a sign-in id. Each fails here, on the branch that writes it.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

const sql = read('lib/api/public-profile-sql.ts');
const publicRoute = read('app/api/profiles/p/[publicId]/route.ts');
const postRoute = read('app/api/profiles/[kind]/[id]/route.ts');
const reports = read('lib/api/market-posts.ts');

/** The object literal the public route returns: everything from `const view` to `return ok(view)`. */
const returned = publicRoute.slice(
  publicRoute.indexOf('const view'),
  publicRoute.indexOf('return ok(view)'),
);

describe('the public profile filter', () => {
  it('requires published status and a live account', () => {
    expect(sql).toMatch(
      /PUBLIC_PROFILE_WHERE = `ap\.status = 'published' AND \$\{PROFILE_ACCOUNT_LIVE\}`/,
    );
  });

  it('a live account has a record that is not removed or suspended, and none suspended', () => {
    // farmer_active / buyer_active leave out removed (soft-deleted) records.
    expect(sql).toMatch(
      /EXISTS \(SELECT 1 FROM public\.farmer_active fa\s+WHERE fa\.auth_user_id = ap\.auth_user_id AND fa\.suspended_at IS NULL\)/,
    );
    expect(sql).toMatch(
      /EXISTS \(SELECT 1 FROM public\.buyer_active ba\s+WHERE ba\.auth_user_id = ap\.auth_user_id AND ba\.suspended_at IS NULL\)/,
    );
    expect(sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.farmer_active fs\s+WHERE fs\.auth_user_id = ap\.auth_user_id AND fs\.suspended_at IS NOT NULL\)/,
    );
    expect(sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.buyer_active bs\s+WHERE bs\.auth_user_id = ap\.auth_user_id AND bs\.suspended_at IS NOT NULL\)/,
    );
  });
});

describe('GET /api/profiles/p/:publicId', () => {
  it('is public and read-only', () => {
    expect(publicRoute).toMatch(/roles: 'public'/);
    expect(publicRoute).not.toMatch(/\b(POST|PUT|PATCH|DELETE): \{/);
    expect(publicRoute).not.toMatch(/INSERT|UPDATE public|writeAudit/);
  });

  it('finds the profile by its public id, through the published-and-live filter', () => {
    expect(publicRoute).toMatch(/WHERE ap\.public_id = \$1::uuid AND \$\{PUBLIC_PROFILE_WHERE\}/);
  });

  it('returns a whitelist that names no sign-in, farmer or buyer id and no storage path', () => {
    expect(returned.length).toBeGreaterThan(100);
    // No key of these names, and no spread that could carry one.
    for (const key of [
      'auth_user_id',
      'farmer_id',
      'buyer_id',
      'photo_path',
      'given_name',
      'family_name',
    ]) {
      expect(returned, `the public profile returns ${key}`).not.toMatch(
        new RegExp(`\\b${key}\\s*:`),
      );
    }
    expect(returned, 'the public profile spreads a row').not.toMatch(/\.\.\./);
    // The sign-in id is read to find the posts, and never reaches the response.
    expect(returned).not.toContain('auth_user_id');
  });

  it('shows the phone only when the owner chose it AND the caller is signed in', () => {
    expect(returned).toMatch(/phone: row\.show_phone && caller \? account\.phone : null/);
    expect(publicRoute).toMatch(/requireRole\(request, \[FARMER_ROLE, BUYER_ROLE\]\)/);
  });

  it('serves the photo as an expiring read link, never the path', () => {
    expect(returned).toMatch(/photo_url: await photoLink\(row\.photo_path\)/);
  });
});

describe('the post-based profile never leaks an unpublished profile', () => {
  it('adds only the public id, and only through the published-and-live filter', () => {
    expect(postRoute).toMatch(
      /SELECT ap\.public_id FROM public\.account_profile ap\s+WHERE ap\.auth_user_id = \$1::uuid AND \$\{PUBLIC_PROFILE_WHERE\}/,
    );
    for (const field of [
      'ap.display_name',
      'ap.about',
      'photo_path',
      'photo_url',
      'products',
      'show_phone',
    ]) {
      expect(postRoute, `the post-based profile reads ${field}`).not.toContain(field);
    }
  });
});

describe('a profile can be reported only while it is public', () => {
  it('the report target goes through the same filter', () => {
    expect(reports).toMatch(
      /WHERE ap\.public_id = \$1::uuid AND \$\{PUBLIC_PROFILE_WHERE\}`,\s+column: 'profile_id'/,
    );
  });
});

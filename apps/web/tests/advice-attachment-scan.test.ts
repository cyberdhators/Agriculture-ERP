import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AN ADVICE PHOTO IS SHOWN TO THE CASE'S TWO PARTICIPANTS ONLY (2026-10-25).
 * The specification: "Questions and optional attachments remain private to
 * the permitted participants."
 *
 * A read link is the only way to see a photo in the private bucket, so this
 * reads the source and holds every place one could be issued: exactly one
 * function issues them, it refuses anyone who is not the requester or the
 * provider of the case, it is given only rows that loadCase found for the
 * caller, and no staff route reaches it. A new route that issues a link some
 * other way, or a staff screen that imports the helper, fails here, on the
 * branch that writes it.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = [
  ...walk(join(web, 'app')),
  ...walk(join(web, 'lib')),
  ...walk(join(web, 'components')),
].map((full) => ({
  path: relative(web, full).replace(/\\/g, '/'),
  text: readFileSync(full, 'utf8'),
}));

const lib = read('lib/api/advice.ts');
/** The body of attachmentLinks: from its signature to the next top-level export. */
const linkFn = lib.slice(
  lib.indexOf('export async function attachmentLinks'),
  lib.indexOf('export interface ReferralRow'),
);

describe('advice photo read links', () => {
  it('found the sources at all', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(linkFn.length).toBeGreaterThan(200);
  });

  it('are issued in one place: attachmentLinks in lib/api/advice.ts', () => {
    const issuing = sources.filter(
      (s) => /ADVICE_ATTACHMENT_BUCKET/.test(s.text) && /issueReadLink\(/.test(s.text),
    );
    expect(issuing.map((s) => s.path)).toEqual(['lib/api/advice.ts']);
    expect(lib.match(/issueReadLink\(/g)).toHaveLength(1);
    expect(linkFn).toContain('issueReadLink(');
  });

  it('refuse anyone who is not the requester or the provider of the case', () => {
    expect(lib).toMatch(
      /isParticipant = \(row: CaseRow, authUserId: string\): boolean =>\s+authUserId === row\.requester_auth_user_id \|\| authUserId === row\.provider_auth_user_id/,
    );
    const guard = linkFn.indexOf('if (!isParticipant(row, authUserId)) return [];');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(linkFn.indexOf('issueReadLink('));
  });

  it('are reached only through presentCase, for a case loadCase found for its participants', () => {
    const callers = sources.filter((s) => /attachmentLinks\(/.test(s.text));
    expect(callers.map((s) => s.path)).toEqual(['lib/api/advice.ts']);
    // loadCase finds a case only for its two participants.
    expect(lib).toMatch(/AND \$2::uuid IN \(ac\.requester_auth_user_id, p\.auth_user_id\)/);
    // Every route that presents a case with its photos got the row from loadCase.
    const detailRoutes = sources.filter(
      (s) => s.path.startsWith('app/api/') && /presentCase\([^)]*,\s*true\)/.test(s.text),
    );
    // The case itself, confirm, remove and the referral.
    expect(detailRoutes.length).toBeGreaterThanOrEqual(4);
    // And the staff side was looked at at all.
    expect(sources.some((s) => s.path.startsWith('app/api/admin/'))).toBe(true);
    for (const route of detailRoutes) {
      expect(route.path, 'a case with photos is shown only under /api/advice/cases').toMatch(
        /^app\/api\/advice\/cases\/\[id\]\//,
      );
      expect(route.text, `${route.path} presents a case it did not load`).toMatch(/loadCase\(/);
      expect(route.text, `${route.path} admits more than farmer and buyer sign-ins`).toMatch(
        /roles: \[FARMER_ROLE, BUYER_ROLE\]/,
      );
    }
  });

  it('never reach a staff route or screen', () => {
    for (const s of sources) {
      const staff =
        /^(app\/api\/(admin|analytics|audit|users|officers|reports)\/|app\/\(portal\)\/|components\/(admin|portal|analytics)\/)/;
      if (!staff.test(s.path)) continue;
      expect(s.text, `${s.path} reaches advice photos`).not.toMatch(
        /ADVICE_ATTACHMENT_BUCKET|attachmentLinks|presentCase|advice_case_attachment/,
      );
    }
  });

  it('never put a storage path in a case as it leaves the API', () => {
    const shape = lib.slice(
      lib.indexOf('export async function presentCase'),
      lib.indexOf('export async function presentCase') + 3000,
    );
    expect(shape).not.toMatch(/storage_path/);
    expect(linkFn).not.toMatch(/storage_path:/);
  });
});

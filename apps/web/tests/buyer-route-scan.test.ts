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

/** Outside app/api/buyer: the two reference reads a signed-in buyer needs. */
// 2026-10-09: account/recovery-code -- a signed-in farmer or buyer gets a new
// recovery code; it touches only the caller's own sign-in account.
const BUYER_OUTSIDE_ITS_TREE = ['account/recovery-code', 'locations', 'me'];

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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * THE APPROVED-ADVISER PATHWAY, READ AS TEXT (2026-10-24).
 *
 * Who may decide, and what the public may see, are both decided by a few
 * lines of route and presenter source. This reads those lines and fails if a
 * later edit drops the permission, lets a farmer or buyer reach the staff
 * routes, or lets the public presenter carry an application id, a sign-in id
 * or anything else beyond the provider's own id.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('only moderators review adviser applications', () => {
  for (const route of [
    'app/api/admin/advisers/route.ts',
    'app/api/admin/advisers/[id]/route.ts',
    'app/api/admin/advisers/[id]/decision/route.ts',
  ]) {
    it(`${route} is administrator-only and asks for content.moderate before any data`, () => {
      const text = read(route);
      expect(text).toMatch(/roles: \['admin'\]/);
      expect(text).not.toMatch(/BUYER_ROLE|FARMER_ROLE|'public'/);
      const handlers = text.split('handler: async').slice(1);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const permission = handler.indexOf("requirePermission(auth, 'content.moderate')");
        const firstQuery = handler.search(/\$queryRawUnsafe|\$executeRawUnsafe|audited\(/);
        expect(permission, 'no permission check').toBeGreaterThan(-1);
        expect(permission, 'data touched before the permission check').toBeLessThan(firstQuery);
      }
    });
  }

  it('the decision refuses a staff member their own application, and is one transaction', () => {
    const text = read('app/api/admin/advisers/[id]/decision/route.ts');
    expect(text).toMatch(/auth_user_id === auth\.principal\.authUserId/);
    expect(text).toMatch(/unprocessable\('adviser_own_application'\)/);
    expect(text).toMatch(/audited\(prisma/);
    // Approval sets the badge and revocation clears it, inside that transaction.
    expect(text).toMatch(/SET approved_at = now\(\), approved_application_id = \$2::uuid/);
    expect(text).toMatch(/SET approved_at = NULL, approved_application_id = NULL/);
  });
});

describe('approval is independent of account standing', () => {
  it('neither suspending nor restoring an account touches an approval', () => {
    for (const route of ['suspend', 'restore']) {
      const text = read(`app/api/admin/accounts/${route}/route.ts`);
      expect(text).not.toMatch(/approved_at|adviser_application|advice_provider/);
    }
  });
});

describe('the public sees the badge and no more', () => {
  it('presentProvider exposes exactly its whitelist: the provider id, never an application or sign-in id', () => {
    const text = read('lib/api/advice.ts');
    const start = text.indexOf('export const presentProvider');
    const body = text.slice(start, text.indexOf('});', start));
    const keys = [...body.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'id',
      'display_name',
      'provider_kind',
      'description',
      'topics',
      'languages',
      'states',
      'delivery_modes',
      'availability',
      'terms',
      'fee_note',
      'commercial_interests',
      'approved_adviser',
      'approved_since',
      'updated_at',
    ]);
    expect(body).not.toMatch(/approved_application_id|auth_user_id|application/);
    expect(keys.filter((k) => k?.endsWith('id'))).toEqual(['id']);
  });

  it('the public routes leave through presentProvider only', () => {
    for (const route of [
      'app/api/advice/providers/route.ts',
      'app/api/advice/providers/[id]/route.ts',
    ]) {
      const text = read(route);
      expect(text).toMatch(/presentProvider/);
      expect(text).not.toMatch(/adviser_application|presentStaffApplication|presentOwnApplication/);
    }
  });

  it('the staff and applicant presenters never carry a sign-in id', () => {
    const text = read('lib/api/adviser-approval.ts');
    for (const name of ['presentOwnApplication', 'presentStaffApplication']) {
      const start = text.indexOf(`export const ${name}`);
      const body = text.slice(start, text.indexOf('});', start));
      expect(body, name).not.toMatch(/auth_user_id|decided_by:|phone/);
    }
  });
});

describe('the applicant routes are the caller own', () => {
  for (const route of [
    'app/api/advice/my-provider/application/route.ts',
    'app/api/advice/my-provider/application/reply/route.ts',
    'app/api/advice/my-provider/application/withdraw/route.ts',
  ]) {
    it(`${route} reads the caller's own profile by the session's sign-in and audits without text`, () => {
      const text = read(route);
      expect(text).toMatch(/roles: \[FARMER_ROLE, BUYER_ROLE\]/);
      expect(text).toMatch(/loadOwnProvider\((prisma|tx), (me\(auth\)|owner)/);
      for (const audit of text.match(/writeAudit\(tx, \{[\s\S]*?\}\);/g) ?? []) {
        expect(audit).not.toMatch(/experience|qualifications|affiliation|reply|reason/);
      }
    });
  }
});

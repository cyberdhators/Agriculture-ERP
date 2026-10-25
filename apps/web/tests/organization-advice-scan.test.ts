import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ORGANISATION ADVICE CASES, READ AS TEXT (2026-10-28). docs/DECISIONS.md,
 * "Organisation advice cases".
 *
 * The lines that keep an organisation's advice requests to the members who
 * handle advice, and keep them apart from personal profiles and the general
 * organisation inbox. The rules themselves are tested in
 * packages/shared/tests/organization-advice.test.ts.
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

const inboxRoutes = routes('app/api/organizations/[id]/advice-cases');

describe("an organisation's advice inbox is for its handlers", () => {
  it('finds the inbox routes at all', () => {
    expect(inboxRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it('every inbox route names the caller from the session and requires a handler', () => {
    for (const file of inboxRoutes) {
      const text = read(file);
      expect(text, file).toMatch(/personOf\(auth\)/);
      expect(text, file).toMatch(/requireHandler\((prisma|tx), /);
    }
  });

  it('a handler is an active member holding advisory.handle, asked on every request', () => {
    const text = read('lib/api/organization-advice.ts');
    expect(text).toMatch(
      /requireMember\(db, organizationId, person, \{\s*permission: 'advisory\.handle'/,
    );
  });

  it("a case is found only through the organisation's own profile", () => {
    const text = read('lib/api/organization-advice.ts');
    expect(text).toMatch(/ac\.id = \$1::uuid AND p\.organization_id = \$2::uuid/);
    expect(text).toMatch(/p\.organization_id = \$1::uuid AND ac\.deleted_at IS NULL/);
  });

  it('every change is decided by the shared rules and audited in its transaction', () => {
    const action = read('app/api/organizations/[id]/advice-cases/[caseId]/action/route.ts');
    expect(action).toMatch(/orgAdviceDecision\(\{/);
    expect(action).toMatch(/audited\(prisma/);
    expect(action).toMatch(/writeAudit\(tx/);
    const messages = read('app/api/organizations/[id]/advice-cases/[caseId]/messages/route.ts');
    expect(messages).toMatch(/mayReplyOrgAdvice\(caller, caseState\(row\)\)/);
    expect(messages).toMatch(/side: 'owner'/);
    expect(messages).toMatch(/writeAudit\(tx/);
  });

  it("the requester's shared details reach only the member handling it or an administrator", () => {
    expect(read('lib/api/organization-advice.ts')).toMatch(
      /caller\.administrator \|\|\s*\(row\.assigned_auth_user_id === caller\.person && row\.accepted_at !== null\)/,
    );
  });
});

describe('organisation advice stays apart from personal advice and the general inbox', () => {
  it("the general organisation inbox never shows the organisation's advice cases", () => {
    expect(read('lib/api/messaging.ts')).toMatch(
      /c\.owner_organization_id = \$\{org\}::uuid AND c\.post_kind <> 'advice_case'/,
    );
  });

  it("a person's own case reads see the provider side only for a personal profile", () => {
    const text = read('lib/api/advice.ts');
    expect(text).toMatch(/OR \(p\.organization_id IS NULL AND \$2::uuid = p\.auth_user_id\)/);
    expect(text).toMatch(
      /row\.provider_organization_id === null && authUserId === row\.provider_auth_user_id/,
    );
    expect(text).toMatch(/p\.auth_user_id = \$1::uuid AND p\.organization_id IS NULL/);
    expect(read('app/api/advice/cases/route.ts')).toMatch(
      /'p\.organization_id IS NULL AND p\.auth_user_id'/,
    );
  });

  it("a request to an organisation's profile opens a conversation owned by the organisation", () => {
    for (const file of [
      'app/api/advice/cases/route.ts',
      'app/api/advice/cases/[id]/referral/route.ts',
    ]) {
      expect(read(file), file).toMatch(
        /starter_auth_user_id, starter_name, owner_organization_id\)/,
      );
    }
  });

  it("nobody asks their own organisation's profile", () => {
    expect(read('lib/api/advice.ts')).toMatch(
      /om\.auth_user_id = \$\{person\}::uuid AND om\.status = 'active'/,
    );
    expect(read('app/api/advice/cases/route.ts')).toMatch(
      /if \(provider\.own\) throw unprocessable\('advice_own_provider'\)/,
    );
  });
});

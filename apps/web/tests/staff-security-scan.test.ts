import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * STAFF SECURITY AND ADVISORY AUTHORIZATION, READ AS TEXT (2026-10-28,
 * lane-security). Who may skip the two-step gate, where the gate sits, what
 * the sign-in route records, who may reset a factor or publish an official
 * note -- each decided by a few lines of source. This fails if a later edit
 * moves one of them.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });

describe('the two-step gate', () => {
  it('only GET /api/me and /api/staff/mfa may be exempt from it', () => {
    const exempt = routeFiles(join(web, 'app/api'))
      .filter((f) => /mfaExempt:\s*true/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(join(web, 'app/api'), f).replace(/\\/g, '/'))
      .sort();
    expect(exempt).toEqual(['me/route.ts', 'staff/mfa/route.ts']);
  });

  it('requireRole asks the gate for every staff session before the role check', () => {
    const text = read('lib/api/require-role.ts');
    const gate = text.indexOf('staffMfaGate(');
    const roleCheck = text.indexOf('if (!allowed.includes(staff.role)) throw forbidden();');
    expect(gate).toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(gate);
    expect(text).toMatch(/staffMfaMode\(process\.env\.STAFF_MFA_ENFORCEMENT\)/);
    expect(text).toMatch(/throw mfaRequired\(\)/);
    expect(text).toMatch(/throw mfaEnrolmentRequired\(\)/);
  });

  it('the wrapper passes the exemption through and moves last activity', () => {
    const text = read('lib/api/route.ts');
    expect(text).toMatch(/mfaExempt: definition\.mfaExempt === true/);
    expect(text).toMatch(/if \(auth\) await touchActivity\(auth\)/);
  });
});

describe('sign-in through the server', () => {
  const text = read('app/api/auth/sign-in/route.ts');

  it('limits before it signs in, and records a failure against a known account', () => {
    const limit = text.indexOf('identifierWait(');
    const signIn = text.indexOf('signInWithPassword(');
    expect(limit).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(limit);
    expect(text).toMatch(/recordAttempt\(hash, false\)/);
    expect(text).toMatch(/recordSignInFailed\(account\.kind, account\.id, request\)/);
  });

  it('never writes the password anywhere but the sign-in call', () => {
    const uses = text.match(/body\.password/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(text).not.toMatch(/writeAudit|console\./);
  });

  it('stores only a hash of the identifier', () => {
    const lib = read('lib/api/sign-in.ts');
    expect(lib).toMatch(/createHash\('sha256'\)/);
    expect(lib).toMatch(/INSERT INTO public\.sign_in_attempt \(identifier_hash, succeeded\)/);
  });
});

describe('resetting another person’s two-step sign-in', () => {
  const text = read('app/api/admin/staff-access/users/[id]/mfa-reset/route.ts');

  it('is for Super Admins, never on yourself, and re-authenticates before removing anything', () => {
    expect(text).toMatch(/requirePermission\(auth, 'superadmin\.grant'\)/);
    expect(text).toMatch(/unprocessable\('mfa_reset_own'\)/);
    const reauth = text.indexOf('reauthenticate(');
    const remove = text.indexOf('deleteAllFactors(');
    expect(reauth).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(reauth);
    expect(text).toMatch(/action: 'staff\.mfa_reset'/);
  });
});

describe('staff invitations', () => {
  it('stores only the token hash and never returns the address unmasked in a list', () => {
    const lib = read('lib/api/staff-invitations.ts');
    expect(lib).toMatch(/email_hint: maskInviteEmail\(row\.email\)/);
    const presenter = lib.slice(lib.indexOf('export const presentStaffInvitation'));
    expect(presenter.slice(0, presenter.indexOf('});'))).not.toMatch(/\bemail: /);
    const create = read('app/api/admin/staff-invitations/route.ts');
    expect(create).toMatch(/hashStaffInvitationToken\(token\)/);
    expect(create).toMatch(/requirePermission\(\s*auth,\s*'staff\.manage'/);
  });

  it('the invitee chooses the password; nobody else sends one', () => {
    const accept = read('app/api/staff-invitations/accept/route.ts');
    expect(accept).toMatch(/createAuthAccount\(invitation\.email, body\.password\)/);
    expect(accept).toMatch(/FOR UPDATE/);
  });

  it('creating a staff account with a password is the Super Admin fallback once one exists', () => {
    const users = read('app/api/users/route.ts');
    expect(users).toMatch(
      /superAdmins\.length > 0 && !isSuperAdmin\(await permissionsOf\(auth\)\)/,
    );
  });
});

describe('advisory authorization', () => {
  it('suspend and restore are decided in the adviser decision route, never by account standing', () => {
    const decision = read('app/api/admin/advisers/[id]/decision/route.ts');
    expect(decision).toMatch(/suspend: 'adviser_approval\.suspended'/);
    expect(decision).toMatch(/restore: 'adviser_approval\.restored'/);
    for (const route of ['suspend', 'restore']) {
      expect(read(`app/api/admin/accounts/${route}/route.ts`)).not.toMatch(/suspended_until/);
    }
  });

  it('every reader of the badge also asks whether the approval is suspended', () => {
    expect(read('lib/api/advice.ts')).toMatch(/CASE WHEN \$\{APPROVAL_SUSPENDED_SQL\}/);
    expect(read('app/api/advice/providers/route.ts')).toMatch(/APPROVAL_SUSPENDED_SQL/);
    expect(read('app/api/advice/providers/[id]/notes/route.ts')).toMatch(/APPROVAL_ACTIVE_SQL/);
  });

  it('only publishing authority publishes an official note, and only for an active approval', () => {
    const review = read('app/api/admin/advisory-notes/[id]/review/route.ts');
    expect(review).toMatch(/holdsPermission\(permissions, 'content\.publish'\)/);
    expect(review).toMatch(/body\.action !== 'return' && !publisher/);
    expect(review).toMatch(/!current\.approval_active/);
  });

  it('only an approved, unsuspended adviser can submit a note', () => {
    const submit = read('app/api/advice/my-provider/notes/route.ts');
    expect(submit).toMatch(/activeApprovalOf\(tx, provider\.id\)/);
    expect(submit).toMatch(/unprocessable\('advisory_note_not_approved'\)/);
  });
});

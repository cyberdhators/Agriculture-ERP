import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_NOTICES, noticeHref } from '../lib/farmer-notices';
import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';

/**
 * RECOVERY, CHANGE OF NUMBER AND CORRECTION REQUESTS, READ AS TEXT
 * (2026-10-27). The rules are a few lines of route source each: recovery
 * never says whether a number has an account; a reset ends every session; a
 * change of number needs the password on the server and a code for the new
 * number; a correction needs content.moderate, leaves the post live, and is
 * addressed by the owner's edit. This fails on the branch that drops one.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8').replace(/\r\n/g, '\n');

describe('a recovery code request never reveals whether the number has an account', () => {
  const route = read('app/api/auth/recovery/code/route.ts');

  it('is public and writes a code row for every number, sending only when an account exists', () => {
    expect(route).toMatch(/roles: 'public'/);
    expect(route).toMatch(/deliver: account !== null/);
    // Sent after the answer, so the answer takes the same time either way.
    expect(route).toMatch(/defer: true/);
  });

  it('has no branch that answers differently for a number with no account', () => {
    expect(route).not.toMatch(/if \(!account\)|account === null \?|notFound|conflict\(/);
    // One answer shape, built after the code row is written.
    expect(route.match(/const answer: RecoveryCodeSent = \{/g)?.length).toBe(2);
  });

  it('the verify step accepts only a recovery code', () => {
    expect(read('app/api/auth/recovery/verify/route.ts')).toMatch(
      /verifyPhoneCode\(body\.verification_id, body\.code, 'password_recovery'\)/,
    );
  });
});

describe('a reset uses the code once, ends every session, and is audited and notified', () => {
  const route = read('app/api/auth/recovery/reset/route.ts');

  it('uses up the code before the password is set', () => {
    expect(
      route.indexOf("consumeVerification(prisma, body.verification_id, 'password_recovery')"),
    ).toBeGreaterThan(-1);
    expect(route.indexOf('consumeVerification(')).toBeLessThan(
      route.indexOf('await setAuthPassword('),
    );
  });

  it('ends every other session after the password is set', () => {
    expect(route).toMatch(/await revokeAllSessions\(account\.authUserId\)/);
    expect(route.indexOf('await setAuthPassword(')).toBeLessThan(
      route.indexOf('await revokeAllSessions('),
    );
  });

  it('audits how and whether sessions ended, never the password, and sends the fixed notice', () => {
    expect(route).toMatch(/action: 'account\.password_recovered'/);
    expect(route).toMatch(/after: \{ method: 'sms_code', sessions_ended: sessionsEnded \}/);
    expect(route).toMatch(/'password_recovered'/);
  });
});

describe('a change of number is verified on the server', () => {
  const route = read('app/api/farmer/me/route.ts');

  it('checks the password on the server before anything changes', () => {
    expect(route).toMatch(/requireReauth\(await reauthenticate\(authUserId, body\.password\)/);
    expect(route.indexOf('reauthenticate(')).toBeLessThan(route.indexOf('setAuthIdentifier('));
  });

  it('uses up a code for THIS new number and THIS account when codes are sent', () => {
    expect(route).toMatch(
      /consumeVerification\(prisma, body\.verification_id, 'phone_change', \{\s*phone: body\.phone,\s*authUserId,/,
    );
    expect(route.indexOf("'phone_change'")).toBeLessThan(route.indexOf('setAuthIdentifier('));
  });

  it('tells the old number and records only the outcome', () => {
    expect(route).toMatch(/sendNumberChangedSms\(current\.phone/);
    expect(route).toMatch(/old_number_sms: oldNumberSms/);
    expect(route).toMatch(/'phone_changed'/);
  });

  it('the code route does not look up whether the new number is taken', () => {
    const codeRoute = read('app/api/farmer/me/phone-code/route.ts');
    expect(codeRoute).toMatch(/purpose: 'phone_change'/);
    expect(codeRoute).toMatch(/authUserId: auth\.principal\.authUserId/);
    expect(codeRoute).not.toMatch(/farmer_active|farmer_phone_registered/);
  });
});

describe('a correction request', () => {
  const route = read('app/api/admin/corrections/route.ts');

  it('is for staff holding content.moderate, asked before any data, on both methods', () => {
    // 2026-10-30: reads admit read-only accounts, the write does not.
    expect(route.match(/roles: \['admin', 'supervisor', 'read_only'\]/g)?.length).toBe(1);
    expect(route.match(/roles: \['admin', 'supervisor'\]/g)?.length).toBe(1);
    expect(route.match(/await requirePermission\(auth, 'content\.moderate'\)/g)?.length).toBe(2);
  });

  it('leaves the post as it is: no status change, no removal', () => {
    expect(route).not.toMatch(
      /UPDATE public\.(produce_listing|service_listing|buying_request)|deleted_at = now\(\)/,
    );
  });

  it('is audited with its code and note, and tells the owner by a fixed notice', () => {
    expect(route).toMatch(/action: 'listing\.correction_requested'/);
    expect(route).toMatch(/'listing_correction_requested'/);
    expect(route).toMatch(/notifyAccount\(/);
  });

  for (const [file, type] of [
    ['app/api/farmer/listings/[id]/route.ts', 'produce_listing'],
    ['app/api/services/[id]/route.ts', 'service_listing'],
    ['app/api/buying-requests/[id]/route.ts', 'buying_request'],
  ] as const) {
    it(`an owner's edit of a ${type} addresses its open request, in the same transaction`, () => {
      const text = read(file);
      expect(text).toMatch(
        new RegExp(`addressCorrections\\(tx, '${type}', id, sentKeys\\(body\\)`),
      );
    });
  }

  it('the owner reads only their own posts', () => {
    const own = read('app/api/account/corrections/route.ts');
    expect(own).toMatch(/WHERE auth_user_id = \$1::uuid/);
    expect(own).toMatch(/auth\.principal\.authUserId/);
  });
});

describe('the new notices are fixed sentences, in both languages, and open somewhere', () => {
  for (const name of [
    'password_recovered',
    'phone_changed',
    'listing_correction_requested',
  ] as const) {
    it(name, () => {
      const notice = ACCOUNT_NOTICES[name];
      expect((en as Record<string, string>)[`${notice.key}.title`]).toBe(notice.title);
      expect((en as Record<string, string>)[`${notice.key}.body`]).toBe(notice.body);
      expect((ar as Record<string, string>)[`${notice.key}.title`]).toBeTruthy();
      expect(noticeHref(notice.title)).not.toBeNull();
    });
  }
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * OFFICIAL ANNOUNCEMENTS AND SETTINGS PHASE 2, READ AS TEXT (2026-10-27).
 *
 * The rules are a few lines of source each: private conversations are never a
 * broadcast source; every announcement and template route is for
 * administrators holding communications.send; no contact detail is stored or
 * returned; an announcement is previewed and confirmed before it is sent; a
 * failure is never resent automatically; and each phase-2 setting is read by
 * the code it governs. This reads those lines and fails on the branch that
 * drops one. Nothing here touches a database or a provider.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(web, dir))) {
    const path = join(dir, name);
    if (statSync(join(web, path)).isDirectory()) out.push(...routeFiles(path));
    else if (name === 'route.ts') out.push(path.replace(/\\/g, '/'));
  }
  return out;
}

const ADMIN_ROUTES = [
  ...routeFiles('app/api/admin/announcements'),
  ...routeFiles('app/api/admin/message-templates'),
];

describe('private conversations are not a broadcast resource', () => {
  it('nothing that chooses or reaches recipients reads a conversation or a message', () => {
    for (const file of ['lib/api/announcements.ts', ...ADMIN_ROUTES]) {
      const text = read(file);
      expect(text, file).not.toMatch(/public\.(conversation|message)\b/);
      expect(text, file).not.toMatch(/\bmessaging\b/);
    }
  });

  it('recipients are chosen by scope on the server, never from ids a browser sends', () => {
    const lib = read('lib/api/announcements.ts');
    expect(lib).toMatch(/FROM public\.farmer_active f/);
    expect(lib).toMatch(/f\.suspended_at IS NULL/);
    expect(lib).toMatch(/c\.granted = true AND c\.withdrawn_at IS NULL/);
    expect(lib).toMatch(/b\.suspended_at IS NULL/);
    for (const file of ADMIN_ROUTES) expect(read(file), file).not.toMatch(/recipient_ids/);
  });
});

describe('staff holding communications.send, enforced in the route', () => {
  it.each(ADMIN_ROUTES.map((f) => [f]))('%s', (file) => {
    const text = read(file);
    const handlers = text.match(/roles: \[[^\]]*\]/g) ?? [];
    expect(handlers.length, 'no handler found').toBeGreaterThan(0);
    // 2026-10-30 (presets are binding): every staff role that can hold the
    // Administrator preset; reads admit read-only accounts, writes do not.
    for (const roles of handlers) {
      expect(["roles: ['admin', 'supervisor', 'read_only']", "roles: ['admin', 'supervisor']"]).toContain(
        roles,
      );
    }
    const checks = text.match(/await requirePermission\(auth, 'communications\.send'\)/g) ?? [];
    expect(checks.length).toBe(handlers.length);
  });

  it('every write also refuses a read-only caller', () => {
    for (const file of ADMIN_ROUTES) {
      const text = read(file);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const at = text.indexOf(`  ${method}: {`);
        if (at === -1) continue;
        const block = text.slice(at, at + 400);
        expect(block, `${file} ${method}`).toMatch(/requireWriter\(auth\)/);
      }
    }
  });
});

describe('no contact detail is stored, audited or returned', () => {
  it('the delivery insert carries ids, never a phone or an address', () => {
    const lib = read('lib/api/announcements.ts');
    const insert = lib.slice(lib.indexOf('INSERT INTO public.announcement_delivery'));
    const columns = insert.slice(0, insert.indexOf(')'));
    expect(columns).not.toMatch(/phone|email|address/);
  });

  it('the delivery record route selects no phone and no address', () => {
    const text = read('app/api/admin/announcements/[id]/deliveries/route.ts');
    expect(text).not.toMatch(/\.phone\b|email/);
  });

  it('no audit row written for an announcement names a phone, an address or the text', () => {
    for (const file of ['lib/api/announcements.ts', ...ADMIN_ROUTES]) {
      const text = read(file);
      let at = text.indexOf('await writeAudit(');
      while (at !== -1) {
        const call = text.slice(at, text.indexOf('});', at));
        expect(call, file).not.toMatch(/phone|address|body\.body|sms_body|\.title\b/);
        at = text.indexOf('await writeAudit(', at + 1);
      }
    }
  });
});

describe('preview before sending, and a failure is never resent by itself', () => {
  it('the send recounts and must match the count the preview showed', () => {
    const send = read('app/api/admin/announcements/[id]/send/route.ts');
    expect(send).toMatch(/plan\.recipients !== body\.expected_recipients/);
    expect(send).toMatch(/conflict\('announcement_recipients_changed'\)/);
    expect(send).toMatch(/before\.status !== 'draft'/);
  });

  it('the preview and the send use one plan', () => {
    const lib = read('lib/api/announcements.ts');
    expect(lib.match(/\$\{PLAN_SQL\}/g)?.length).toBe(2);
  });

  it('an interrupted delivery is marked failed, never queued again, and only a person retries', () => {
    const lib = read('lib/api/announcements.ts');
    expect(lib).toMatch(/SET status = 'failed', error = \$2/);
    expect(lib).not.toMatch(/status = 'sending'[^`]*SET status = 'queued'/);
    const retry = read('app/api/admin/announcements/[id]/retry/route.ts');
    expect(retry).toMatch(/WHERE announcement_id = \$1::uuid AND status = 'failed'/);
  });

  it('no provider is called before the batch audit is known to be accepted', () => {
    const lib = read('lib/api/announcements.ts');
    expect(lib.indexOf('await batchAuditReady()')).toBeLessThan(lib.indexOf('await sendOneSms('));
  });

  it('a batch stays inside a serverless function', () => {
    const process = read('app/api/admin/announcements/[id]/process/route.ts');
    expect(process).toMatch(/export const maxDuration = 60;/);
    expect(read('lib/api/announcements.ts')).toMatch(/const TIME_BUDGET_MS = 30_000;/);
  });
});

describe('preferences are respected', () => {
  it('the plan consults each preference unless the message is essential', () => {
    const lib = read('lib/api/announcements.ts');
    expect(lib).toMatch(
      /LEFT JOIN public\.notification_preference p ON p\.auth_user_id = r\.auth_user_id/,
    );
    expect(lib).toMatch(/WHEN NOT \$5::boolean AND \(/);
  });

  it('activity updates in the app can be switched off; essential notices cannot', () => {
    const notify = read('lib/api/notify.ts');
    expect(notify).toMatch(/UPDATE_NOTICES\.has\(notice\) &&\s+\(await updatesSwitchedOff\(/);
    for (const essential of ['adviser_approved', 'adviser_revoked', 'account_restored']) {
      const set = notify.slice(notify.indexOf('UPDATE_NOTICES'), notify.indexOf(']);'));
      expect(set).not.toContain(`'${essential}'`);
    }
    // A notice never fails for want of the table: its existence is asked first.
    expect(notify).toMatch(/to_regclass\('public\.notification_preference'\)/);
  });

  it("the preferences routes read and write the caller's own row only", () => {
    const text = read('app/api/account/notification-preferences/route.ts');
    expect(text).toMatch(/const authUserId = auth\.principal\.authUserId;/);
    expect(text).not.toMatch(/params|searchParams/);
  });
});

describe('each phase-2 setting is read by the code it governs', () => {
  it('the sign-up code wait', () => {
    expect(read('lib/api/phone-verification.ts')).toMatch(
      /cachedSettingValue\('registration_recovery'\)\)\.code_resend_seconds/,
    );
  });

  it('the return-session threshold', () => {
    expect(read('lib/api/access-log.ts')).toMatch(/inactivityMs: inactivityMinutes \* 60_000/);
  });

  it('the minimum age and archived crops at self-registration, which stays open', () => {
    const text = read('app/api/farmer/register/route.ts');
    expect(text).toMatch(/meetsMinimumAge\(body\.year_of_birth, registration\.minimum_age_years\)/);
    expect(text).toMatch(/roles: 'public'/);
  });

  it('the listing validity wherever a post is given no end date', () => {
    for (const file of [
      'app/api/farmer/listings/route.ts',
      'app/api/farmer/listings/[id]/route.ts',
      'app/api/services/route.ts',
      'app/api/services/[id]/route.ts',
    ]) {
      expect(read(file), file).toMatch(/await listingValidityDays\(\)/);
    }
  });

  it('archived categories and units are refused only where a post is created', () => {
    for (const file of ['app/api/farmer/listings/route.ts', 'app/api/buying-requests/route.ts']) {
      expect(read(file), file).toMatch(/await refuseArchivedChoice\(body\)/);
    }
    for (const file of [
      'app/api/farmer/listings/[id]/route.ts',
      'app/api/buying-requests/[id]/route.ts',
    ]) {
      expect(read(file), file).not.toMatch(/refuseArchivedChoice/);
    }
  });

  it('privacy defaults apply to a NEW profile row only', () => {
    const profile = read('app/api/account/profile/route.ts');
    expect(profile).toMatch(/privacy\.show_phone_default/);
    const conflict = profile.slice(profile.indexOf('ON CONFLICT'), profile.indexOf('RETURNING'));
    expect(conflict).not.toMatch(/show_phone|allow_messages/);
    expect(read('lib/api/public-profile.ts')).toMatch(
      /show_phone: row \? row\.show_phone : \(defaults\?\.show_phone_default \?\? false\)/,
    );
  });
});

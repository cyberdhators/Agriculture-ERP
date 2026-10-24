import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_NOTICES } from '../lib/farmer-notices';
import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';
import { suspensionSmsText } from '../lib/suspension-sms';

/**
 * NOTICES, SUSPENSION AND APPEALS, READ AS TEXT (2026-10-26, CORWADO's
 * acceptance test of 24 October).
 *
 * The rules are a few lines of route source each: a suspension ends every
 * session; an adviser decision tells the applicant; a notice carries a fixed
 * sentence and never a message, an advice question or a staff reason. This
 * reads those lines and fails on the branch that drops one.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(web, dir))) {
    const path = join(dir, name);
    if (statSync(join(web, path)).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('a suspension ends every existing session (acceptance test, defect 3)', () => {
  const text = read('app/api/admin/accounts/suspend/route.ts');

  it('calls revokeAllSessions for the account, besides the ban', () => {
    expect(text).toMatch(/import \{[^}]*revokeAllSessions[^}]*\} from '[./]+lib\/supabase\/admin'/);
    expect(text).toMatch(/await revokeAllSessions\(account\.authUserId\)/);
    expect(text).toMatch(/await disableAuthAccount\(account\.authUserId\)/);
  });

  it('ends the sessions BEFORE the ban, since a banned account cannot redeem the one-time sign-in', () => {
    expect(text.indexOf('await revokeAllSessions(')).toBeLessThan(
      text.indexOf('await disableAuthAccount('),
    );
  });

  it('says in its answer whether the sessions were ended and whether the text message went', () => {
    expect(text).toMatch(/sessions_ended: sessionsEnded/);
    expect(text).toMatch(/notice_sms: sms/);
  });
});

describe('the suspension text message (acceptance test, defect 2)', () => {
  const route = read('app/api/admin/accounts/suspend/route.ts');
  const moderation = read('lib/api/moderation.ts');

  it('records only the outcome in the audit row, never the number or the text', () => {
    const audit = route.slice(
      route.indexOf('await writeAudit('),
      route.indexOf('return { account'),
    );
    expect(audit).toMatch(/notice_sms: sms/);
    expect(audit).not.toMatch(/phone|suspensionSmsText|sendOneSms/);
  });

  it('names the reason CODE label, never the free-text reason', () => {
    expect(route).toMatch(/reasonCodeLabel\(tx, body\.reason_code\)/);
    expect(route).not.toMatch(/sendSuspensionSms\([^)]*body\.reason\b(?!_)/);
  });

  it('never throws: a failed send leaves the suspension standing', () => {
    const send = moderation.slice(moderation.indexOf('export async function sendSuspensionSms'));
    expect(send).toMatch(/try \{[\s\S]*\} catch \{\s*return 'failed';/);
  });

  it('sends only to a South Sudan mobile', () => {
    expect(moderation).toMatch(/parseSouthSudanMobile\(phone\)/);
  });

  it('fits one 160-character SMS whatever the label, and says how to appeal', () => {
    for (const label of [null, 'Fraud or scam', 'x'.repeat(80)]) {
      const text = suspensionSmsText(label);
      expect(text.length).toBeLessThanOrEqual(160);
      expect(text).toContain("'Appeal a decision'");
      expect(text).toContain('agrionesouthsudan.com/help');
    }
  });
});

describe('an adviser decision tells the applicant (acceptance test, defect 1)', () => {
  const text = read('app/api/admin/advisers/[id]/decision/route.ts');

  it('writes one notice inside the decision transaction, for every decision', () => {
    expect(text).toMatch(
      /await notifyAccount\(tx, \{ authUserId: current\.auth_user_id \}, NOTICE\[body\.action\]/,
    );
    for (const [action, notice] of [
      ['request_clarification', 'adviser_clarification_requested'],
      ['approve', 'adviser_approved'],
      ['decline', 'adviser_declined'],
      ['revoke', 'adviser_revoked'],
    ]) {
      expect(text).toMatch(new RegExp(`${action}: '${notice}'`));
    }
  });

  it('writes the notice before the transaction returns, so a decision and its notice stand or fall together', () => {
    const tx = text.slice(
      text.indexOf('await audited(prisma'),
      text.indexOf('if (!row) throw notFound()'),
    );
    expect(tx).toMatch(/notifyAccount\(/);
  });
});

describe('restore, a new conversation and an advice update each send a notice (defects 2 and 7)', () => {
  it('restore notifies the account', () => {
    expect(read('app/api/admin/accounts/restore/route.ts')).toMatch(
      /notifyAccount\([\s\S]*'account_restored'/,
    );
  });

  for (const file of [
    'app/api/conversations/route.ts',
    'app/api/conversations/[id]/messages/route.ts',
    'app/api/advice/cases/route.ts',
    'app/api/advice/cases/[id]/referral/route.ts',
  ]) {
    it(`${file} tells the other side of a NEW conversation only`, () => {
      expect(read(file)).toMatch(/noticeIfFirstMessage\(/);
    });
  }

  it('a case started or closed, and a referral proposed, tell the other participant', () => {
    const patch = read('app/api/advice/cases/[id]/route.ts');
    expect(patch.match(/noticeCaseChanged\(/g)?.length).toBe(2);
    expect(read('app/api/advice/cases/[id]/referral/route.ts')).toMatch(
      /'advice_referral_proposed'/,
    );
  });

  it('a first message is counted by sender, so later messages send nothing', () => {
    const notify = read('lib/api/notify.ts');
    expect(notify).toMatch(/row\.sent !== 1/);
  });
});

describe('a notice never carries a message, a question or a reason (spec: no private case details)', () => {
  it('every account notice is a fixed sentence with no placeholder', () => {
    for (const [name, notice] of Object.entries(ACCOUNT_NOTICES)) {
      for (const text of [notice.title, notice.body]) {
        expect(text, name).not.toMatch(/\$\{|\{\{|%s|<[a-z]/i);
        expect(text.length, name).toBeLessThanOrEqual(120);
      }
    }
  });

  it('every account notice has its English and Arabic text for the farmer', () => {
    const dict = en as Record<string, string>;
    const arabic = ar as Record<string, string>;
    for (const notice of Object.values(ACCOUNT_NOTICES)) {
      expect(dict[`${notice.key}.title`]).toBe(notice.title);
      expect(dict[`${notice.key}.body`]).toBe(notice.body);
      expect(arabic[`${notice.key}.title`], notice.key).toBeTruthy();
      expect(arabic[`${notice.key}.body`], notice.key).toBeTruthy();
    }
  });

  it('notifyAccount takes a notice NAME and writes only the fixed title and body', () => {
    const notify = read('lib/api/notify.ts');
    expect(notify).toMatch(/notice: AccountNotice,/);
    expect(notify).toMatch(/const \{ title, body \} = ACCOUNT_NOTICES\[notice\];/);
    // Nothing a person wrote is read here: no message body, no question, no reason.
    expect(notify).not.toMatch(/m\.body|\.question|\.reason|description|clarification_request/);
  });

  it('no notification is written with text built from a record, except the one named below', () => {
    // The listing-withdrawn notice (#148) names the farmer's OWN listing and
    // the staff reason, sent to that farmer. Kept as it was; for the owner to
    // confirm (docs/DECISIONS.md, 2026-10-26).
    const known = new Set(['app/api/listings/[id]/withdraw/route.ts']);
    const files = [...sourceFiles('app'), ...sourceFiles('lib')];
    let inserts = 0;
    for (const file of files) {
      const text = read(file);
      let at = text.indexOf('INSERT INTO public.notification');
      while (at !== -1) {
        inserts += 1;
        const args = text.slice(at, text.indexOf(');', at));
        const path = relative(web, join(web, file)).replace(/\\/g, '/');
        if (!known.has(path)) {
          // After the SQL's closing backtick, no bound value is a template.
          const bound = args.slice(args.indexOf('`') + 1);
          expect(bound, path).not.toMatch(/`/);
        }
        at = text.indexOf('INSERT INTO public.notification', at + 1);
      }
    }
    expect(inserts).toBeGreaterThanOrEqual(5);
  });
});

describe('appeals are support messages (acceptance test, defect 4)', () => {
  it('the staff list links an appeal to its account by sign-in, or by one matching phone', () => {
    const support = read('lib/api/support.ts');
    expect(support).toMatch(/acct ON sm\.topic = 'appeal'/);
    expect(support).toMatch(/count\(\*\) FROM public\.farmer f2[\s\S]*= 1/);
    expect(support).toMatch(/count\(\*\) FROM public\.buyer b2[\s\S]*= 1/);
    // The sign-in id itself still never leaves.
    expect(support).not.toMatch(/from_auth_user_id AS|appeal_auth_user_id/);
  });

  it('the migration keeps every earlier topic and adds appeal', () => {
    const sql = readFileSync(
      join(web, '../../prisma/migrations/20261026100000_appeals_topic/migration.sql'),
      'utf8',
    );
    expect(sql).toMatch(
      /"topic" IN \('account', 'marketplace', 'messages', 'technical', 'appeal', 'other'\)/,
    );
  });
});

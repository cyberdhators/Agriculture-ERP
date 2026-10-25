import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  QUEUE_START_BUDGET_MS,
  QUEUE_MAX_BATCHES,
  madeProgress,
  mayStartBatch,
} from '../lib/announcement-queue-plan';
import { actorTypesOf, actorTypesSql } from '../lib/api/admin-accounts';
import { ACCOUNT_NOTICES } from '../lib/farmer-notices';
import { suspensionSmsText } from '../lib/suspension-sms';

/**
 * THE KNOWN DEFECTS OF 2026-10-29, READ AS TEXT AND AS LOGIC: announcements
 * that moved only while the page was open, suspensions that never ended, and
 * an overview actor filter that disagreed with the accounts list.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = join(web, '..', '..');
const read = (path: string) => readFileSync(join(web, path), 'utf8').replace(/\r\n/g, '\n');
const readRepo = (path: string) => readFileSync(join(repo, path), 'utf8').replace(/\r\n/g, '\n');

const zero = {
  in_app_sent: 0,
  sms: { sent: 0, failed: 0, skipped: 0 },
  email: { sent: 0, failed: 0, skipped: 0 },
  interrupted_marked_failed: 0,
};

describe('announcements move on without the page (scheduled job)', () => {
  it('starts batches only early in a run, and only so many', () => {
    expect(mayStartBatch(0, 0)).toBe(true);
    expect(mayStartBatch(QUEUE_START_BUDGET_MS - 1, 3)).toBe(true);
    expect(mayStartBatch(QUEUE_START_BUDGET_MS, 0)).toBe(false);
    expect(mayStartBatch(0, QUEUE_MAX_BATCHES)).toBe(false);
    // The last batch started (30 s budget + a 10 s provider call) still ends inside 60 s.
    expect(QUEUE_START_BUDGET_MS + 30_000 + 10_000).toBeLessThan(60_000);
  });

  it('asks an announcement again only when its batch moved something on', () => {
    expect(madeProgress(zero)).toBe(false);
    expect(madeProgress({ ...zero, in_app_sent: 1 })).toBe(true);
    expect(madeProgress({ ...zero, sms: { sent: 0, failed: 1, skipped: 0 } })).toBe(true);
    expect(madeProgress({ ...zero, email: { sent: 0, failed: 0, skipped: 2 } })).toBe(true);
    expect(madeProgress({ ...zero, interrupted_marked_failed: 1 })).toBe(true);
  });

  it('the cron route fails closed without the secret and runs the queue', () => {
    const route = read('app/api/cron/announcements/route.ts');
    expect(route).toMatch(/secret\.length < 32\) return false/);
    expect(route).toMatch(/timingSafeEqual/);
    expect(route).toMatch(/if \(!authorised\(request\)\) throw unauthenticated\(\)/);
    expect(route).toMatch(/runAnnouncementQueue\(\)/);
    expect(route).toMatch(/export const maxDuration = 60;/);
  });

  it('the job uses the same claiming batch as the page, audited as system', () => {
    const queue = read('lib/api/announcement-queue.ts');
    expect(queue).toMatch(/processBatch\(SYSTEM_ACTOR, row, identity\.service_name\)/);
    expect(queue).toMatch(/completeIfDone\(SYSTEM_ACTOR, id\)/);
    expect(queue).toMatch(/WHERE status = 'sending' AND deleted_at IS NULL/);
    const lib = read('lib/api/announcements.ts');
    expect(lib).toMatch(/SYSTEM_ACTOR: BatchActor = \{ actorType: 'system', actorId: null \}/);
    expect(lib).toMatch(/FOR UPDATE SKIP LOCKED/);
    // The page keeps driving its own batches.
    const page = read('app/api/admin/announcements/[id]/process/route.ts');
    expect(page).toMatch(/processBatch\(auth, row, identity\.service_name\)/);
  });

  it('the installer runs every two minutes and executes the void vault.update_secret', () => {
    const script = readRepo('scripts/announcements-cron-install.mjs');
    expect(script).toMatch(/cron\.schedule\(\$1, '\*\/2 \* \* \* \*', \$2\)/);
    expect(script).toMatch(/\$executeRawUnsafe\('SELECT vault\.update_secret\(/);
    expect(script).toMatch(/\/api\/cron\/announcements/);
    expect(script).toMatch(/secret\.length < 32/);
  });
});

describe('a suspension may end by itself (daily job)', () => {
  it('the daily cron route also lifts ended suspensions, each half running regardless', () => {
    const route = read('app/api/cron/expiry-reminders/route.ts');
    expect(route).toMatch(
      /Promise\.allSettled\(\[\s+runExpiryReminders\(\),\s+liftExpiredSuspensions\(\),/,
    );
  });

  it('never lifts a disabled account, and is audited as system with a notice', () => {
    const lib = read('lib/api/suspension-expiry.ts');
    expect(lib).toMatch(/f\.disabled_at IS NULL/);
    expect(lib).toMatch(/b\.disabled_at IS NULL/);
    expect(lib).toMatch(/AND suspended_at IS NOT NULL AND disabled_at IS NULL/);
    expect(lib).toMatch(/action: 'account\.suspension_expired'/);
    expect(lib).toMatch(/const system = \{ actorType: 'system', actorId: null \} as const;/);
    expect(lib).toMatch(/'suspension_ended',\s+system,/);
    // Sign-in first; the records only after it succeeded.
    expect(lib.indexOf('await enableAuthAccount(')).toBeLessThan(lib.indexOf('await audited('));
  });

  it('the suspend route stores the end, and a disable, restore or re-enable clears it', () => {
    expect(read('app/api/admin/accounts/suspend/route.ts')).toMatch(
      /suspension_ends_at = \$4::timestamptz/,
    );
    for (const route of ['disable', 'restore', 'reenable']) {
      expect(read(`app/api/admin/accounts/${route}/route.ts`), route).toMatch(
        /suspension_ends_at = NULL/,
      );
    }
  });

  it('the text message names the end date and still fits one SMS with the longest label', () => {
    const longest = 'x'.repeat(80);
    const text = suspensionSmsText(longest, '2026-11-12');
    expect(text).toContain('suspended until 2026-11-12.');
    expect(text.length).toBeLessThanOrEqual(160);
    expect(suspensionSmsText(longest).length).toBeLessThanOrEqual(160);
    expect(suspensionSmsText(null)).not.toContain('until');
  });

  it('the notice that a suspension ended is a fixed sentence', () => {
    expect(ACCOUNT_NOTICES.suspension_ended.title).toBe(
      'Your AgriOne account suspension has ended',
    );
  });
});

describe("an account's actor types: one rule for the list and the overview", () => {
  it('is the declared activities plus farmer and buyer for the records held', () => {
    expect(actorTypesOf({ activities: null, hasFarmer: true, hasBuyer: false })).toEqual([
      'farmer',
    ]);
    expect(actorTypesOf({ activities: [], hasFarmer: false, hasBuyer: true })).toEqual(['buyer']);
    expect(
      actorTypesOf({ activities: ['trader', 'farmer'], hasFarmer: true, hasBuyer: true }),
    ).toEqual(['buyer', 'farmer', 'trader']);
  });

  it('is written once in SQL and used by both the accounts list and the overview', () => {
    const sql = actorTypesSql({ activities: 'A', farmer: 'F', buyer: 'B' });
    expect(sql).toMatch(/COALESCE\(A, '\{\}'::text\[\]\)/);
    expect(sql).toMatch(/CASE WHEN F IS NOT NULL THEN ARRAY\['farmer'\]/);
    expect(sql).toMatch(/CASE WHEN B IS NOT NULL THEN ARRAY\['buyer'\]/);
    expect(read('lib/api/admin-accounts.ts')).toMatch(
      /\$\{actorTypesSql\(\{ activities: 'ap\.activities', farmer: 'f\.id', buyer: 'b\.id' \}\)\} AS actor_types/,
    );
    const overview = read('lib/api/admin-overview.ts');
    expect(overview).toMatch(/import \{ actorTypesSql \} from '\.\/admin-accounts';/);
    expect(overview).toMatch(/w\.act = ANY\(\$\{actorTypesSql\(/);
    // No count reads the profile's activities alone any more.
    expect(overview).not.toMatch(/w\.act = ANY\(apx\.activities\)/);
  });
});

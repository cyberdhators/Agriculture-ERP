import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXPIRY_REMINDER_DAYS } from '@agri-erp/shared';

import { ACCOUNT_NOTICES, noticeHref } from '../lib/farmer-notices';

/**
 * USER JOURNEYS (2026-10-28): the person-level block and the expiry reminders
 * are enforced by SQL and by checks in route text, so this reads them.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');
// Read as text: importing the module would open a database client.
const DUE_SQL =
  read('lib/api/expiry-reminders.ts').match(/export const DUE_SQL = `([^`]*)`/)?.[1] ?? '';

describe('a person-level block stops messages both ways', () => {
  it('starting a conversation checks the block before and inside the transaction', () => {
    const text = read('app/api/conversations/route.ts');
    expect(text.match(/blockedBetween\(/g)?.length).toBe(2);
    expect(text).toMatch(/unprocessable\('conversation_account_blocked'\)/);
  });

  it('sending a message checks the block between the two people', () => {
    const text = read('app/api/conversations/[id]/messages/route.ts');
    expect(text).toMatch(
      /blockedBetween\(\s*tx,\s*conversation\.owner_auth_user_id,\s*conversation\.starter_auth_user_id,?\s*\)/,
    );
  });

  it('the block is looked up in both directions and only while live', () => {
    const text = read('lib/api/blocks.ts');
    expect(text).toMatch(/ended_at IS NULL/);
    expect(text).toMatch(/blocker_auth_user_id = \$2::uuid AND blocked_auth_user_id = \$1::uuid/);
  });

  it('the account to block comes from a conversation, never from the body', () => {
    const text = read('app/api/account/blocks/route.ts');
    expect(text).toMatch(/loadConversation\(tx, body\.conversation_id, viewer\)/);
    expect(text).not.toMatch(/body\.(auth_user_id|blocked)/);
  });
});

describe('expiry reminders', () => {
  it('reminds a few days ahead', () => {
    expect(EXPIRY_REMINDER_DAYS).toBeGreaterThan(0);
    expect(EXPIRY_REMINDER_DAYS).toBeLessThan(15);
  });

  it('leaves out suspended posters on every poster join', () => {
    const joins = DUE_SQL.match(/JOIN public\.(farmer_active|buyer_active) [fb] ON [^\n]*/g) ?? [];
    expect(joins.length).toBe(5);
    for (const join of joins) expect(join).toMatch(/suspended_at IS NULL/);
  });

  it('reads only live, unreminded posts', () => {
    expect(DUE_SQL).toMatch(/produce_listing_active/);
    expect(DUE_SQL).toMatch(/buying_request_active/);
    expect(DUE_SQL).toMatch(/service_listing_active/);
    expect(DUE_SQL).toMatch(/NOT EXISTS[\s\S]*post_expiry_reminder/);
  });

  it('is idempotent: insert first, notify only when a row was made', () => {
    const text = read('lib/api/expiry-reminders.ts');
    expect(text).toMatch(/ON CONFLICT ON CONSTRAINT post_expiry_reminder_once DO NOTHING/);
    expect(text.indexOf('INSERT INTO public.post_expiry_reminder')).toBeLessThan(
      text.indexOf('notifyAccount('),
    );
    expect(text).toMatch(/if \(!made\) return 'skipped'/);
  });

  it('the cron route fails closed without the secret', () => {
    const text = read('app/api/cron/expiry-reminders/route.ts');
    expect(text).toMatch(/secret\.length < 32\) return false/);
    expect(text).toMatch(/timingSafeEqual/);
  });

  it('each reminder notice is fixed text and opens the right list', () => {
    for (const key of ['expiry_listing', 'expiry_buying_request', 'expiry_service'] as const) {
      expect(noticeHref(ACCOUNT_NOTICES[key].title)).not.toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';

import type { ParsedSmsEvent } from '../sms/bird-webhook';
import type { AuditTx } from './audit';
import { applyBirdEvent } from './sms-receipts';

/**
 * A stand-in transaction: it answers the statements applyBirdEvent makes and
 * records every write, so the dedupe and ordering rules are tested without a
 * database. `seen` holds the webhook ids already applied.
 */
function fakeTx(opts: { seen?: Set<string>; deliveries?: { id: string; newer: boolean }[] }) {
  const seen = opts.seen ?? new Set<string>();
  const writes: string[] = [];
  const tx = {
    $queryRawUnsafe: async (sql: string, ...p: unknown[]) => {
      if (sql.includes('INSERT INTO public.bird_webhook_event')) {
        const id = p[0] as string;
        if (seen.has(id)) return [];
        seen.add(id);
        return [{ webhook_id: id }];
      }
      if (sql.includes('FROM public.announcement_delivery')) return opts.deliveries ?? [];
      if (sql.includes('INSERT INTO public.sms_opt_out')) {
        writes.push('opt_out');
        return [{ id: 'oo1' }];
      }
      if (sql.includes('INSERT INTO public.audit_event')) {
        writes.push('audit');
        return [];
      }
      if (sql.includes('FROM public.farmer f')) return [{ auth_user_id: 'u1' }];
      return [];
    },
    $executeRawUnsafe: async (sql: string) => {
      if (sql.includes('UPDATE public.announcement_delivery')) writes.push('receipt');
      else if (sql.includes('notification_preference')) writes.push('preference');
      else if (sql.includes('audit_event')) writes.push('audit');
      return 1;
    },
  };
  // The mark audited() puts on its transaction client (Symbol.for, so shared).
  Object.defineProperty(tx, Symbol.for('agri-erp.audit-tx'), { value: true });
  return { tx: tx as unknown as AuditTx, writes, seen };
}

const receipt = (over: Partial<ParsedSmsEvent> = {}): ParsedSmsEvent => ({
  type: 'sms.delivered',
  timestamp: new Date('2026-10-26T10:00:00Z'),
  smsId: 'sms_1',
  phone: null,
  text: null,
  errorCode: null,
  suppressionId: null,
  ...over,
});

describe('a Bird event is applied once', () => {
  it('records a receipt the first time, and nothing on a retry with the same webhook-id', async () => {
    const f = fakeTx({ deliveries: [{ id: 'd1', newer: false }] });
    expect(await applyBirdEvent(f.tx, 'wh_1', receipt())).toBe('receipt_recorded');
    expect(f.writes.filter((w) => w === 'receipt')).toHaveLength(1);
    const before = f.writes.length;
    expect(await applyBirdEvent(f.tx, 'wh_1', receipt())).toBe('duplicate');
    expect(f.writes.length).toBe(before);
  });

  it('an older receipt never replaces a newer one (deliveries are unordered)', async () => {
    const f = fakeTx({ deliveries: [{ id: 'd1', newer: true }] });
    expect(await applyBirdEvent(f.tx, 'wh_2', receipt({ type: 'sms.failed' }))).toBe(
      'receipt_stale',
    );
    expect(f.writes).not.toContain('receipt');
  });

  it('a receipt for a message we did not send is recorded as unmatched', async () => {
    const f = fakeTx({ deliveries: [] });
    expect(await applyBirdEvent(f.tx, 'wh_3', receipt())).toBe('receipt_unmatched');
  });

  it('a STOP reply turns SMS announcements off for the matching account', async () => {
    const f = fakeTx({});
    const outcome = await applyBirdEvent(
      f.tx,
      'wh_4',
      receipt({ type: 'sms.received', smsId: 'sms_9', phone: '+211900000000', text: 'STOP' }),
    );
    expect(outcome).toBe('opt_out_recorded');
    expect(f.writes).toContain('opt_out');
    expect(f.writes).toContain('preference');
  });

  it('any other reply is only recorded as received', async () => {
    const f = fakeTx({});
    expect(
      await applyBirdEvent(
        f.tx,
        'wh_5',
        receipt({ type: 'sms.received', phone: '+211900000000', text: 'Thank you' }),
      ),
    ).toBe('received');
    expect(f.writes).toEqual([]);
  });

  it('an unknown event type is ignored', async () => {
    const f = fakeTx({});
    expect(await applyBirdEvent(f.tx, 'wh_6', receipt({ type: 'sms.accepted' }))).toBe('ignored');
  });
});

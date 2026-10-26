import {
  isStopReply,
  receiptDelivered,
  smsEventAction,
  type ParsedSmsEvent,
} from '../sms/bird-webhook';
import { writeAudit, type AuditTx } from './audit';

/**
 * APPLYING ONE BIRD SMS EVENT (2026-10-26). docs/DECISIONS.md, "SMS delivery
 * receipts". Called by POST /api/webhooks/bird inside one audited
 * transaction, after the signature was verified.
 *
 *   1. DEDUPLICATE on webhook-id: the first delivery inserts the
 *      bird_webhook_event row; a retry or replay finds it and does nothing.
 *   2. A RECEIPT (delivered / undelivered / failed / rejected / expired) is
 *      written on every announcement delivery with that Bird message id --
 *      only if it is not older than the receipt already there, since Bird's
 *      deliveries are unordered (sorted by the event's own timestamp).
 *   3. AN OPT-OUT (a suppression, or a reply that is only a stop word) turns
 *      off SMS announcements and SMS match alerts for every account with that
 *      number. Essential messages have no switch and are not affected.
 *      Any other inbound text is recorded as received and otherwise ignored.
 *
 * No number and no text is stored or audited: the number is used to find
 * accounts, then dropped.
 *
 * WHERE ELSE BIRD MESSAGE IDS LIVE: nowhere else. Phone verification codes,
 * invitations and suspension texts do not keep Bird's id (they report
 * acceptance only), so announcement_delivery is the one table with receipts.
 */

export type ApplyOutcome =
  | 'duplicate'
  | 'receipt_recorded'
  | 'receipt_unmatched'
  | 'receipt_stale'
  | 'opt_out_recorded'
  | 'received'
  | 'ignored';

const SYSTEM = { actorType: 'system' as const, actorId: null };

export async function applyBirdEvent(
  tx: AuditTx,
  webhookId: string,
  event: ParsedSmsEvent,
): Promise<ApplyOutcome> {
  const action = smsEventAction(event.type);
  const outcome = await decide(tx, event, action);
  const [fresh] = await tx.$queryRawUnsafe<{ webhook_id: string }[]>(
    `INSERT INTO public.bird_webhook_event (webhook_id, event_type, event_at, outcome)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (webhook_id) DO NOTHING RETURNING webhook_id`,
    webhookId,
    event.type,
    event.timestamp,
    outcome.name,
  );
  // Already applied: the work below is NOT done, and the decision above made
  // no write (it only read), so a duplicate changes nothing.
  if (!fresh) return 'duplicate';
  await outcome.apply();
  return outcome.name;
}

interface Decision {
  name: Exclude<ApplyOutcome, 'duplicate'>;
  apply: () => Promise<void>;
}

const nothing = async () => undefined;

async function decide(
  tx: AuditTx,
  event: ParsedSmsEvent,
  action: ReturnType<typeof smsEventAction>,
): Promise<Decision> {
  if (action.kind === 'receipt') {
    if (!event.smsId || !event.timestamp) return { name: 'receipt_unmatched', apply: nothing };
    const rows = await tx.$queryRawUnsafe<{ id: string; newer: boolean }[]>(
      `SELECT id, (receipt_at IS NOT NULL AND receipt_at > $2) AS newer
         FROM public.announcement_delivery
        WHERE provider_message_id = $1 AND channel = 'sms'`,
      event.smsId,
      event.timestamp,
    );
    if (rows.length === 0) return { name: 'receipt_unmatched', apply: nothing };
    const current = rows.filter((r) => !r.newer);
    if (current.length === 0) return { name: 'receipt_stale', apply: nothing };
    return {
      name: 'receipt_recorded',
      apply: async () => {
        for (const r of current) {
          // The condition is repeated in the write: a concurrent newer receipt wins.
          const n = await tx.$executeRawUnsafe(
            `UPDATE public.announcement_delivery
                SET receipt_status = $2, receipt_reason = $3, receipt_at = $4, updated_at = now()
              WHERE id = $1::uuid AND (receipt_at IS NULL OR receipt_at <= $4)`,
            r.id,
            action.status,
            receiptDelivered(action.status) ? null : event.errorCode,
            event.timestamp,
          );
          if (n === 0) continue;
          await writeAudit(tx, {
            entityType: 'announcement_delivery',
            entityId: r.id,
            ...SYSTEM,
            action: 'sms_receipt.recorded',
            after: {
              receipt_status: action.status,
              ...(event.errorCode && !receiptDelivered(action.status)
                ? { reason: event.errorCode }
                : {}),
            },
          });
        }
      },
    };
  }

  const optOut =
    action.kind === 'suppression' || (action.kind === 'received' && isStopReply(event.text));
  if (!optOut) {
    return { name: action.kind === 'received' ? 'received' : 'ignored', apply: nothing };
  }
  const source = action.kind === 'suppression' ? 'suppression' : 'keyword_stop';
  const accounts = event.phone
    ? await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
        `SELECT f.auth_user_id FROM public.farmer f
          WHERE f.phone = $1 AND f.auth_user_id IS NOT NULL AND f.deleted_at IS NULL
         UNION
         SELECT b.auth_user_id FROM public.buyer b
          WHERE b.phone = $1 AND b.auth_user_id IS NOT NULL AND b.deleted_at IS NULL`,
        event.phone,
      )
    : [];
  const ref = event.suppressionId ?? event.smsId;
  return {
    name: 'opt_out_recorded',
    apply: async () => {
      const targets = accounts.length > 0 ? accounts.map((a) => a.auth_user_id) : [null];
      for (const authUserId of targets) {
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.sms_opt_out (auth_user_id, source, provider_ref)
           VALUES ($1::uuid, $2, $3) RETURNING id`,
          authUserId,
          source,
          ref,
        );
        await writeAudit(tx, {
          entityType: 'sms_opt_out',
          entityId: row!.id,
          ...SYSTEM,
          action: 'sms_opt_out.recorded',
          after: { source, matched_account: authUserId !== null },
        });
        if (!authUserId) continue;
        await tx.$executeRawUnsafe(
          `INSERT INTO public.notification_preference
             (auth_user_id, announcements_sms, match_sms, updated_at)
           VALUES ($1::uuid, false, false, now())
           ON CONFLICT (auth_user_id) DO UPDATE
             SET announcements_sms = false, match_sms = false, updated_at = now()`,
          authUserId,
        );
        await writeAudit(tx, {
          entityType: 'notification_preference',
          entityId: authUserId,
          ...SYSTEM,
          action: 'notification_preference.updated',
          after: { announcements_sms: false, match_sms: false, source },
        });
      }
    },
  };
}

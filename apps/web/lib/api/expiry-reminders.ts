import { EXPIRY_REMINDER_BATCH, EXPIRY_REMINDER_DAYS } from '@agri-erp/shared';

import { type AccountNotice } from '../farmer-notices';
import { prisma } from '../db';
import { audited, writeAudit } from './audit';
import { notifyAccount } from './notify';

/**
 * EXPIRY REMINDERS (2026-10-28, CORWADO's specification: "Expired --
 * availability/validity period ended; review and renew if eligible", and the
 * Settings line "Listing fields, validity and reminders"). docs/DECISIONS.md,
 * "Expiry reminders".
 *
 * Once a day (POST /api/cron/expiry-reminders): every post on the market whose
 * end date falls within EXPIRY_REMINDER_DAYS -- a produce listing's
 * available_until, a buying request's needed_by, a service's available_until
 * -- and that has not yet been reminded FOR THAT DATE, gets one fixed in-app
 * notice to the person who posted it. The post's title never enters the
 * notice (a shared phone shows previews).
 *
 * IDEMPOTENT PER POST PER END DATE: the post_expiry_reminder row is inserted
 * first (ON CONFLICT DO NOTHING on post_kind, post_id, ends_on) and the notice
 * is written only when that insert made a row, in the same transaction. A
 * second run, or two runs at once, send nothing twice. An edited end date is
 * a new date and earns a new reminder.
 *
 * Only a live poster is reminded: a suspended or removed farmer or buyer is
 * left out (their posts are off the market anyway). A post made for an
 * organisation reminds the person who posted it; if that person has gone, the
 * post is not reminded (a known gap: the organisation's administrators are
 * not told).
 */

const NOTICE: Record<DueRow['post_kind'], AccountNotice> = {
  listing: 'expiry_listing',
  buying_request: 'expiry_buying_request',
  service: 'expiry_service',
};

interface DueRow {
  post_kind: 'listing' | 'buying_request' | 'service';
  post_id: string;
  ends_on: string;
  auth_user_id: string | null;
  farmer_id: string | null;
}

/** Posts due a reminder, oldest end date first. Read as text by the scan test. */
export const DUE_SQL = `WITH due AS (
    SELECT 'listing'::text AS post_kind, pl.id AS post_id, pl.available_until AS ends_on,
           f.auth_user_id, f.id AS farmer_id
      FROM public.produce_listing_active pl
      JOIN public.farmer_active f ON f.id = pl.farmer_id AND f.suspended_at IS NULL
     WHERE pl.status = 'listed' AND pl.available_until IS NOT NULL
       AND pl.available_until BETWEEN current_date AND current_date + $1::int
    UNION ALL
    SELECT 'buying_request'::text, br.id, br.needed_by,
           COALESCE(f.auth_user_id, b.auth_user_id), f.id
      FROM public.buying_request_active br
      LEFT JOIN public.farmer_active f ON f.id = br.farmer_id AND f.suspended_at IS NULL
      LEFT JOIN public.buyer_active b ON b.id = br.buyer_id AND b.suspended_at IS NULL
     WHERE br.status = 'active'
       AND br.needed_by BETWEEN current_date AND current_date + $1::int
       AND (f.id IS NOT NULL OR b.id IS NOT NULL)
    UNION ALL
    SELECT 'service'::text, sl.id, sl.available_until,
           COALESCE(f.auth_user_id, b.auth_user_id), f.id
      FROM public.service_listing_active sl
      LEFT JOIN public.farmer_active f ON f.id = sl.farmer_id AND f.suspended_at IS NULL
      LEFT JOIN public.buyer_active b ON b.id = sl.buyer_id AND b.suspended_at IS NULL
     WHERE sl.status = 'active' AND sl.available_until IS NOT NULL
       AND sl.available_until BETWEEN current_date AND current_date + $1::int
       AND (f.id IS NOT NULL OR b.id IS NOT NULL)
  )
  SELECT d.post_kind, d.post_id, to_char(d.ends_on, 'YYYY-MM-DD') AS ends_on,
         d.auth_user_id, d.farmer_id
    FROM due d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.post_expiry_reminder r
      WHERE r.post_kind = d.post_kind AND r.post_id = d.post_id AND r.ends_on = d.ends_on)
   ORDER BY d.ends_on, d.post_id
   LIMIT $2`;

export interface ExpiryRunOutcome {
  due: number;
  reminded: number;
  undeliverable: number;
  skipped: number;
  failed: number;
}

export async function runExpiryReminders(): Promise<ExpiryRunOutcome> {
  const rows = await prisma.$queryRawUnsafe<DueRow[]>(
    DUE_SQL,
    EXPIRY_REMINDER_DAYS,
    EXPIRY_REMINDER_BATCH,
  );
  const outcome: ExpiryRunOutcome = {
    due: rows.length,
    reminded: 0,
    undeliverable: 0,
    skipped: 0,
    failed: 0,
  };
  const system = { actorType: 'system', actorId: null } as const;
  for (const row of rows) {
    try {
      // One transaction per post: one failure never undoes another's reminder.
      const result = await audited(prisma, async (tx) => {
        const [made] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.post_expiry_reminder (post_kind, post_id, ends_on, delivered)
           VALUES ($1, $2::uuid, $3::date, false)
           ON CONFLICT ON CONSTRAINT post_expiry_reminder_once DO NOTHING
           RETURNING id`,
          row.post_kind,
          row.post_id,
          row.ends_on,
        );
        if (!made) return 'skipped' as const;
        const delivered = await notifyAccount(
          tx,
          { authUserId: row.auth_user_id, farmerId: row.farmer_id },
          NOTICE[row.post_kind],
          system,
        );
        if (delivered) {
          await tx.$executeRawUnsafe(
            'UPDATE public.post_expiry_reminder SET delivered = true WHERE id = $1::uuid',
            made.id,
          );
        }
        await writeAudit(tx, {
          entityType: 'post_expiry_reminder',
          entityId: made.id,
          ...system,
          action: 'post.expiry_reminder_sent',
          after: {
            post_kind: row.post_kind,
            post_id: row.post_id,
            ends_on: row.ends_on,
            delivered,
          },
        });
        return delivered ? ('reminded' as const) : ('undeliverable' as const);
      });
      outcome[result] += 1;
    } catch {
      outcome.failed += 1;
    }
  }
  return outcome;
}

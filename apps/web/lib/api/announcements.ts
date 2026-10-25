import { randomUUID } from 'node:crypto';

import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_LIMITS,
  DEFAULT_PREFERENCES,
  NAME_FALLBACK,
  renderMessage,
  smsCost,
  smsEstimate,
  tallyDeliveries,
  type AnnouncementPreview,
  type AnnouncementCategory,
  type AnnouncementChannel,
  type AnnouncementScope,
  type DeliveryCounts,
  type NotificationPreferences,
  type StaffAnnouncement,
} from '@agri-erp/shared';

import { prisma } from '../db';
import { MailerNotConfiguredError, mailerConfig, sendOneEmail } from '../email/resend';
import { SmsNotConfiguredError, SmsUnavailableError, sendOneSms, smsConfig } from '../sms/bird';
import { adminAuthEmails } from '../supabase/admin';
import { audited, writeAudit, type AuditTx } from './audit';
import { settingValue } from './settings';
import { UUID_PATTERN } from './buyer-presenters';
import { notFound, unprocessable } from './errors';
import type { Authenticated } from './require-role';

/** A route's :id, or a 404: a malformed id names nothing. */
export function idParam(params: Record<string, string>): string {
  const id = params.id ?? '';
  if (!UUID_PATTERN.test(id)) throw notFound();
  return id;
}

/**
 * OFFICIAL ANNOUNCEMENTS -- THE SERVER SIDE (2026-10-27). docs/DECISIONS.md,
 * "Official announcements".
 *
 * WHO IS REACHED is decided here, in SQL, from the account tables only: the
 * live farmer records (consent granted and not withdrawn, not suspended, not
 * merged), the live buyer accounts (not suspended), active extension officers
 * and active staff. NOTHING HERE READS A CONVERSATION OR A MESSAGE: a private
 * conversation is not a broadcast resource (apps/web/tests/announcements-scan
 * holds this).
 *
 * ONE PLAN, TWO USES. `PLAN_SQL` says, for every recipient in scope and every
 * chosen channel, whether it will be sent or why not (a preference, no
 * contact, a shared phone or inbox, no inbox). The preview counts it; the send
 * inserts it as delivery rows. So the preview and the send cannot disagree.
 *
 * SENDING IN BATCHES. Queuing is one statement. In-app deliveries are then
 * written in batches of 500, set-based; SMS and email go out ANNOUNCEMENT_
 * LIMITS.chunkSize per request, a few at a time, inside a time budget, and
 * every outcome is written back before the request ends. A batch that dies
 * part-way leaves its claimed rows `sending`; they are reported as failed
 * after staleSendingMinutes and NEVER resent automatically -- a resend could
 * bill a second SMS for one that went -- and a person retries them.
 *
 * NO CONTACT DETAIL IS STORED OR AUDITED. Phone numbers and addresses are
 * read at the moment of sending and never written to a delivery row or an
 * audit row; neither is a message's text.
 */

type Queryable = {
  $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...p: unknown[]) => Promise<number>;
};

const SOUTH_SUDAN_MOBILE = '^\\+211[0-9]{9}$';
const SOUTH_SUDAN_MOBILE_JS = /^\+211\d{9}$/;

// ---------------------------------------------------------------------------
// RECIPIENTS IN SCOPE
// ---------------------------------------------------------------------------

/**
 * The accounts an announcement can reach, one row per account. An account
 * that is both a farmer and a buyer is ONE row, its farmer side (where its
 * notices already go, as lib/api/notify.ts does), and can also be emailed.
 * $1 scope kind, $2 state, $3 activity.
 */
const RECIPIENTS_SQL = `
  farmer_accounts AS (
    SELECT 'farmer'::text AS kind, f.id AS recipient_id, f.auth_user_id,
           f.given_name AS name, f.phone, f.state_id,
           f.id AS inbox_id,
           (f.auth_user_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.buyer_active b2
               WHERE b2.auth_user_id = f.auth_user_id AND b2.suspended_at IS NULL
           )) AS can_email
      FROM public.farmer_active f
      JOIN public.consent c ON c.id = f.consent_id
     WHERE f.suspended_at IS NULL AND f.merged_into IS NULL
       AND c.granted = true AND c.withdrawn_at IS NULL
  ),
  buyer_accounts AS (
    SELECT 'buyer'::text AS kind, b.id AS recipient_id, b.auth_user_id,
           b.given_name AS name, b.phone, o.state_id,
           o.id AS inbox_id, true AS can_email
      FROM public.buyer_active b
      JOIN public.buyer_organization o ON o.id = b.organization_id
     WHERE b.suspended_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM farmer_accounts fa WHERE fa.auth_user_id = b.auth_user_id)
  ),
  accounts AS (
    SELECT * FROM farmer_accounts UNION ALL SELECT * FROM buyer_accounts
  ),
  staff_accounts AS (
    SELECT 'staff'::text AS kind, u.id AS recipient_id, u.auth_user_id,
           split_part(u.name, ' ', 1) AS name, NULL::text AS phone, u.scope_state_id AS state_id,
           NULL::uuid AS inbox_id, true AS can_email
      FROM public.user_active u
  ),
  officer_accounts AS (
    SELECT 'officer'::text AS kind, o.id AS recipient_id, o.auth_user_id,
           split_part(o.name, ' ', 1) AS name, o.phone, o.state_id,
           NULL::uuid AS inbox_id, false AS can_email
      FROM public.officer_active o
     WHERE o.status = 'active'
  ),
  recipients AS (
    SELECT * FROM accounts a
     WHERE $1 = 'all'
        OR ($1 = 'phone' AND a.kind = 'farmer')
        OR ($1 = 'email' AND a.can_email)
        OR ($1 = 'state' AND a.state_id = $2)
        OR ($1 = 'activity' AND (
             ($3 = 'farmer' AND a.kind = 'farmer')
          OR ($3 = 'buyer' AND (a.kind = 'buyer' OR a.can_email))
          OR EXISTS (SELECT 1 FROM public.account_profile ap
                      WHERE ap.auth_user_id = a.auth_user_id AND $3 = ANY (ap.activities))
        ))
    UNION ALL
    SELECT * FROM staff_accounts WHERE $1 = 'staff'
    UNION ALL
    SELECT * FROM officer_accounts WHERE $1 = 'officers'
  )`;

/**
 * THE PLAN: one row per recipient per channel, with the reason it will not be
 * sent (NULL: it will). $4 channels, $5 whether the category is essential
 * (then preferences are not consulted).
 *
 * In order: no inbox (in-app to staff or an officer); a preference; no
 * contact (no South Sudan mobile; no email account); then a shared phone or
 * a shared organisation inbox -- the first recipient is sent, the rest are
 * skipped, so one handset is billed once and one inbox gets one notice.
 */
const PLAN_SQL = `
  WITH ${RECIPIENTS_SQL},
  with_prefs AS (
    SELECT r.*,
           COALESCE(p.announcements_in_app, true) AS p_in_app,
           COALESCE(p.announcements_sms, true) AS p_sms,
           COALESCE(p.announcements_email, true) AS p_email
      FROM recipients r
      LEFT JOIN public.notification_preference p ON p.auth_user_id = r.auth_user_id
  ),
  channel AS (SELECT unnest($4::text[]) AS channel),
  plan0 AS (
    SELECT ch.channel, r.kind, r.recipient_id, r.auth_user_id, r.name, r.phone, r.inbox_id,
      CASE
        WHEN ch.channel = 'in_app' AND r.inbox_id IS NULL THEN 'no_inbox'
        WHEN NOT $5::boolean AND (
               (ch.channel = 'in_app' AND NOT r.p_in_app)
            OR (ch.channel = 'sms' AND NOT r.p_sms)
            OR (ch.channel = 'email' AND NOT r.p_email)) THEN 'preference'
        WHEN ch.channel = 'sms' AND (r.phone IS NULL OR r.phone !~ '${SOUTH_SUDAN_MOBILE}') THEN 'no_contact'
        WHEN ch.channel = 'email' AND (NOT r.can_email OR r.auth_user_id IS NULL) THEN 'no_contact'
        ELSE NULL
      END AS skip0
      FROM with_prefs r CROSS JOIN channel ch
  ),
  plan AS (
    SELECT p.*,
      CASE
        WHEN p.skip0 IS NULL AND p.channel IN ('sms', 'in_app') AND row_number() OVER (
               PARTITION BY p.channel, (p.skip0 IS NULL),
                            CASE p.channel WHEN 'sms' THEN p.phone ELSE p.inbox_id::text END
               ORDER BY p.kind, p.recipient_id) > 1
          THEN 'duplicate_contact'
        ELSE p.skip0
      END AS skip_reason
      FROM plan0 p
  )`;

export interface PlanInput {
  scope: AnnouncementScope;
  channels: readonly AnnouncementChannel[];
  category: AnnouncementCategory;
}

const planParams = (input: PlanInput) => [
  input.scope.kind,
  input.scope.state_id,
  input.scope.activity,
  [...input.channels],
  input.category === 'essential',
];

export interface PlanSummary {
  recipients: number;
  /** channel -> reason ('send' for will-be-sent) -> count */
  byChannel: Partial<Record<AnnouncementChannel, Record<string, number>>>;
}

/** What a send would do, counted. Reads only. */
export async function planSummary(input: PlanInput, client: Queryable = prisma): Promise<PlanSummary> {
  const rows = await client.$queryRawUnsafe<
    { channel: string | null; reason: string | null; n: number; recipients: number }[]
  >(
    `${PLAN_SQL}
     SELECT channel, COALESCE(skip_reason, 'send') AS reason, count(*)::int AS n,
            (SELECT count(*)::int FROM recipients) AS recipients
       FROM plan GROUP BY 1, 2
     UNION ALL
     SELECT NULL, NULL, 0, (SELECT count(*)::int FROM recipients)`,
    ...planParams(input),
  );
  const out: PlanSummary = { recipients: rows[0]?.recipients ?? 0, byChannel: {} };
  for (const r of rows) {
    if (!r.channel || !r.reason) continue;
    const ch = r.channel as AnnouncementChannel;
    out.byChannel[ch] ??= {};
    out.byChannel[ch]![r.reason] = r.n;
  }
  return out;
}

/** Inserts the plan as delivery rows. Inside the send's transaction. Returns the recipient count. */
export async function queueDeliveries(
  tx: AuditTx,
  announcementId: string,
  input: PlanInput,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `${PLAN_SQL}
     INSERT INTO public.announcement_delivery
       (announcement_id, channel, recipient_kind, recipient_id, auth_user_id, status, skip_reason)
     SELECT $6::uuid, channel, kind, recipient_id, auth_user_id,
            CASE WHEN skip_reason IS NULL THEN 'queued' ELSE 'skipped' END, skip_reason
       FROM plan
     ON CONFLICT DO NOTHING`,
    ...planParams(input),
    announcementId,
  );
}

/**
 * A draft's references, checked before it is saved: the state exists, and a
 * template it was made from is active.
 */
export async function checkDraftReferences(
  tx: Queryable,
  body: { scope: AnnouncementScope; template_id: string | null },
): Promise<void> {
  if (body.scope.state_id) {
    const [state] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public.state_active WHERE id = $1`,
      body.scope.state_id,
    );
    if (!state) throw unprocessable('announcement_state_unknown');
  }
  if (body.template_id) {
    const [template] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public.message_template WHERE id = $1::uuid AND status = 'active'`,
      body.template_id,
    );
    if (!template) throw unprocessable('template_inactive');
  }
}

/** The example name the preview shows in place of {name}. */
export const PREVIEW_NAME = 'Amina';

/** The preview of one announcement: the plan counted, the text rendered, SMS parts costed. */
export async function buildPreview(row: AnnouncementRow): Promise<AnnouncementPreview> {
  const [identity, notifications, summary] = await Promise.all([
    settingValue('identity'),
    settingValue('notifications_moderation'),
    planSummary({
      scope: {
        kind: row.scope_kind,
        state_id: row.scope_state_id,
        activity: row.scope_activity as AnnouncementScope['activity'],
      },
      channels: row.channels,
      category: row.category,
    }),
  ]);
  const values = { name: PREVIEW_NAME, service_name: identity.service_name };
  const channels = Object.fromEntries(
    ANNOUNCEMENT_CHANNELS.map((c) => {
      const counts = summary.byChannel[c] ?? {};
      return [
        c,
        {
          selected: row.channels.includes(c),
          will_send: counts.send ?? 0,
          skipped_preference: counts.preference ?? 0,
          skipped_no_contact: (counts.no_contact ?? 0) + (counts.no_inbox ?? 0),
          skipped_duplicate: counts.duplicate_contact ?? 0,
        },
      ];
    }),
  ) as AnnouncementPreview['channels'];
  let sms: AnnouncementPreview['sms'] = null;
  if (row.channels.includes('sms') && row.sms_body) {
    const length = smsEstimate(row.sms_body, identity.service_name);
    const cost = smsCost(
      channels.sms.will_send,
      length.segments,
      notifications.sms_cost_per_segment_usd,
    );
    sms = {
      segments_per_message: length.segments,
      encoding: length.encoding,
      total_segments: cost.total_segments,
      cost_per_segment_usd: notifications.sms_cost_per_segment_usd,
      estimated_cost_usd: cost.estimated_cost_usd,
    };
  }
  return {
    recipients: summary.recipients,
    rendered: {
      title: renderMessage(row.title, values),
      body: renderMessage(row.body, values),
      sms_body: row.sms_body ? renderMessage(row.sms_body, values) : null,
    },
    channels,
    sms,
  };
}

// ---------------------------------------------------------------------------
// READING AN ANNOUNCEMENT
// ---------------------------------------------------------------------------

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  sms_body: string | null;
  category: AnnouncementCategory;
  channels: AnnouncementChannel[];
  scope_kind: AnnouncementScope['kind'];
  scope_state_id: string | null;
  scope_activity: string | null;
  template_id: string | null;
  status: StaffAnnouncement['status'];
  recipient_count: number | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  sent_by: string | null;
  sent_at: Date | null;
  completed_at: Date | null;
}

export const ANNOUNCEMENT_SELECT = `
  SELECT a.id, a.title, a.body, a.sms_body, a.category, a.channels, a.scope_kind,
         a.scope_state_id, a.scope_activity, a.template_id, a.status, a.recipient_count,
         cu.name AS created_by, a.created_at, a.updated_at, su.name AS sent_by,
         a.sent_at, a.completed_at
    FROM public.announcement a
    LEFT JOIN public."user" cu ON cu.id = a.created_by
    LEFT JOIN public."user" su ON su.id = a.sent_by`;

export const presentAnnouncement = (r: AnnouncementRow): StaffAnnouncement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  sms_body: r.sms_body,
  category: r.category,
  channels: r.channels,
  scope: {
    kind: r.scope_kind,
    state_id: r.scope_state_id,
    activity: r.scope_activity as AnnouncementScope['activity'],
  },
  template_id: r.template_id,
  status: r.status,
  recipient_count: r.recipient_count,
  created_by: r.created_by,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
  sent_by: r.sent_by,
  sent_at: r.sent_at?.toISOString() ?? null,
  completed_at: r.completed_at?.toISOString() ?? null,
});

export async function loadAnnouncement(
  id: string,
  client: Queryable = prisma,
  lock = false,
): Promise<AnnouncementRow | null> {
  if (lock) {
    await client.$queryRawUnsafe(
      `SELECT 1 AS locked FROM public.announcement WHERE id = $1::uuid FOR UPDATE`,
      id,
    );
  }
  const [row] = await client.$queryRawUnsafe<AnnouncementRow[]>(
    `${ANNOUNCEMENT_SELECT} WHERE a.id = $1::uuid AND a.deleted_at IS NULL`,
    id,
  );
  return row ?? null;
}

export async function deliveryCounts(id: string, client: Queryable = prisma): Promise<DeliveryCounts> {
  const rows = await client.$queryRawUnsafe<{ channel: string; status: string; n: number }[]>(
    `SELECT channel, status, count(*)::int AS n FROM public.announcement_delivery
      WHERE announcement_id = $1::uuid GROUP BY 1, 2`,
    id,
  );
  return tallyDeliveries(rows);
}

// ---------------------------------------------------------------------------
// PREFERENCES
// ---------------------------------------------------------------------------

export async function preferencesOf(
  authUserId: string,
  client: Queryable = prisma,
): Promise<NotificationPreferences & { saved: boolean }> {
  const [row] = await client.$queryRawUnsafe<(NotificationPreferences & { saved: boolean })[]>(
    `SELECT announcements_in_app, announcements_sms, announcements_email, updates_in_app,
            true AS saved
       FROM public.notification_preference WHERE auth_user_id = $1::uuid`,
    authUserId,
  );
  return row ?? { ...DEFAULT_PREFERENCES, saved: false };
}

// ---------------------------------------------------------------------------
// THE BATCH WORKER
// ---------------------------------------------------------------------------

/** In-app deliveries written per request, set-based. Database rows only, no provider. */
const IN_APP_BATCH = 500;
/** Stop starting new provider calls after this long; unstarted rows go back to the queue. */
const TIME_BUDGET_MS = 30_000;
const PROVIDER_CONCURRENCY = 6;

const INTERRUPTED =
  'Interrupted before the outcome was known, so it was not resent automatically. Retry to send it again.';

export interface BatchOutcome {
  in_app_sent: number;
  sms: { sent: number; failed: number; skipped: number; requeued: number };
  email: { sent: number; failed: number; skipped: number; requeued: number };
  /** Channels left waiting because the deployment has no provider configured. */
  waiting_for_configuration: AnnouncementChannel[];
  interrupted_marked_failed: number;
}

/**
 * Would the audit row of a batch be accepted? Asked BEFORE any provider is
 * called, exactly as the direct SMS route asks: migrations are applied by
 * hand, and an audit insert refused after a send would report as an error
 * for messages that were billed.
 */
async function batchAuditReady(): Promise<boolean> {
  const [row] = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'audit_event_action_known'
        AND conrelid = 'public.audit_event'::regclass`,
  );
  return !row || row.def.includes(`'announcement.batch_sent'`);
}

interface Claimed {
  id: string;
  channel: 'sms' | 'email';
  recipient_kind: 'farmer' | 'buyer' | 'officer' | 'staff';
  recipient_id: string;
  auth_user_id: string | null;
}

interface Result {
  id: string;
  status: 'sent' | 'failed' | 'skipped' | 'queued';
  skip_reason?: 'no_contact';
  provider_message_id?: string | null;
  error?: string | null;
}

/**
 * One request's worth of sending for one announcement. Returns what it did;
 * the caller reads the counts afterwards. Safe to call concurrently: rows are
 * claimed with SKIP LOCKED, so two tabs never send the same delivery.
 */
export async function processBatch(
  auth: Authenticated,
  announcement: AnnouncementRow,
  serviceName: string,
): Promise<BatchOutcome> {
  const started = Date.now();
  const outcome: BatchOutcome = {
    in_app_sent: 0,
    sms: { sent: 0, failed: 0, skipped: 0, requeued: 0 },
    email: { sent: 0, failed: 0, skipped: 0, requeued: 0 },
    waiting_for_configuration: [],
    interrupted_marked_failed: 0,
  };
  const actor = { actorType: auth.role, actorId: auth.principal.id } as const;

  // 1. A claim that never finished is reported, never resent.
  outcome.interrupted_marked_failed = await audited(prisma, async (tx) => {
    const n = await tx.$executeRawUnsafe(
      `UPDATE public.announcement_delivery
          SET status = 'failed', error = $2, updated_at = now()
        WHERE announcement_id = $1::uuid AND status = 'sending'
          AND claimed_at < now() - make_interval(mins => $3)`,
      announcement.id,
      INTERRUPTED,
      ANNOUNCEMENT_LIMITS.staleSendingMinutes,
    );
    if (n > 0) {
      await writeAudit(tx, {
        entityType: 'announcement',
        entityId: announcement.id,
        ...actor,
        action: 'announcement.batch_sent',
        after: { interrupted_marked_failed: n },
      });
    }
    return n;
  });

  // 2. In-app: set-based, inside one audited transaction.
  outcome.in_app_sent = await audited(prisma, async (tx) => {
    const claimed = await tx.$queryRawUnsafe<
      { id: string; recipient_kind: string; recipient_id: string }[]
    >(
      `SELECT id, recipient_kind, recipient_id FROM public.announcement_delivery
        WHERE announcement_id = $1::uuid AND channel = 'in_app' AND status = 'queued'
        ORDER BY id LIMIT ${IN_APP_BATCH}
        FOR UPDATE SKIP LOCKED`,
      announcement.id,
    );
    if (claimed.length === 0) return 0;
    const deliveryIds = claimed.map((c) => c.id);
    const notificationIds = claimed.map(() => randomUUID());
    const title = announcement.title.replaceAll('{service_name}', serviceName);
    const body = announcement.body.replaceAll('{service_name}', serviceName);
    // {name} per recipient, cut to 20 characters, as renderMessage does.
    await tx.$executeRawUnsafe(
      `INSERT INTO public.notification (id, farmer_id, buyer_organization_id, channel, title, body)
       SELECT x.nid, f.id, CASE WHEN f.id IS NULL THEN b.organization_id END, 'in_app',
              replace($3, '{name}', COALESCE(NULLIF(left(btrim(COALESCE(f.given_name, b.given_name)), $6), ''), $5)),
              replace($4, '{name}', COALESCE(NULLIF(left(btrim(COALESCE(f.given_name, b.given_name)), $6), ''), $5))
         FROM unnest($1::uuid[], $2::uuid[]) AS x(did, nid)
         JOIN public.announcement_delivery d ON d.id = x.did
         LEFT JOIN public.farmer f ON d.recipient_kind = 'farmer' AND f.id = d.recipient_id
         LEFT JOIN public.buyer b ON d.recipient_kind = 'buyer' AND b.id = d.recipient_id`,
      deliveryIds,
      notificationIds,
      title,
      body,
      NAME_FALLBACK,
      ANNOUNCEMENT_LIMITS.nameInMessageMax,
    );
    await tx.$executeRawUnsafe(
      `UPDATE public.announcement_delivery d
          SET status = 'sent', sent_at = now(), notification_id = x.nid,
              attempts = d.attempts + 1, updated_at = now()
         FROM unnest($1::uuid[], $2::uuid[]) AS x(did, nid)
        WHERE d.id = x.did`,
      deliveryIds,
      notificationIds,
    );
    await writeAudit(tx, {
      entityType: 'announcement',
      entityId: announcement.id,
      ...actor,
      action: 'announcement.batch_sent',
      after: { channel: 'in_app', sent: claimed.length },
    });
    return claimed.length;
  });

  // 3. SMS and email: configuration first, then the audit check, then a claim.
  const external: ('sms' | 'email')[] = announcement.channels.filter(
    (c): c is 'sms' | 'email' => c === 'sms' || c === 'email',
  );
  if (external.length === 0) return outcome;

  let sms: ReturnType<typeof smsConfig> | null = null;
  let mail: ReturnType<typeof mailerConfig> | null = null;
  const ready: ('sms' | 'email')[] = [];
  for (const channel of external) {
    try {
      if (channel === 'sms') sms = smsConfig();
      else mail = mailerConfig();
      ready.push(channel);
    } catch (failure) {
      if (failure instanceof SmsNotConfiguredError || failure instanceof MailerNotConfiguredError) {
        outcome.waiting_for_configuration.push(channel);
      } else {
        throw failure;
      }
    }
  }
  if (ready.length === 0 || !(await batchAuditReady())) {
    for (const c of ready) outcome.waiting_for_configuration.push(c);
    return outcome;
  }

  const claimed = await prisma.$queryRawUnsafe<Claimed[]>(
    `UPDATE public.announcement_delivery d
        SET status = 'sending', claimed_at = now(), attempts = d.attempts + 1, updated_at = now()
      WHERE d.id IN (
        SELECT id FROM public.announcement_delivery
         WHERE announcement_id = $1::uuid AND status = 'queued' AND channel = ANY ($2::text[])
         ORDER BY channel, id LIMIT $3
         FOR UPDATE SKIP LOCKED)
      RETURNING d.id, d.channel, d.recipient_kind, d.recipient_id, d.auth_user_id`,
    announcement.id,
    ready,
    ANNOUNCEMENT_LIMITS.chunkSize,
  );
  if (claimed.length === 0) return outcome;

  // Contacts, read now and never stored.
  const contacts = await prisma.$queryRawUnsafe<
    { id: string; phone: string | null; name: string | null }[]
  >(
    `SELECT d.id,
            COALESCE(f.phone, b.phone, o.phone) AS phone,
            COALESCE(f.given_name, b.given_name, split_part(o.name, ' ', 1), split_part(u.name, ' ', 1)) AS name
       FROM public.announcement_delivery d
       LEFT JOIN public.farmer_active f ON d.recipient_kind = 'farmer' AND f.id = d.recipient_id
       LEFT JOIN public.buyer_active b ON d.recipient_kind = 'buyer' AND b.id = d.recipient_id
       LEFT JOIN public.officer_active o ON d.recipient_kind = 'officer' AND o.id = d.recipient_id
       LEFT JOIN public.user_active u ON d.recipient_kind = 'staff' AND u.id = d.recipient_id
      WHERE d.id = ANY ($1::uuid[])`,
    claimed.map((c) => c.id),
  );
  const contact = new Map(contacts.map((c) => [c.id, c]));
  const emailRows = claimed.filter((c) => c.channel === 'email' && c.auth_user_id);
  let emails = new Map<string, string>();
  let authUnavailable = false;
  if (emailRows.length > 0) {
    try {
      emails = await adminAuthEmails(emailRows.map((c) => c.auth_user_id as string));
    } catch {
      // The authentication service is unreachable: the email rows go back
      // to the queue untouched, below.
      authUnavailable = true;
    }
  }

  const results: Result[] = [];
  let smsStopped = false;
  let emailStopped = false;
  let next = 0;
  const footer = `\n\n--\nYou receive this as an account holder of ${serviceName}. Choose what you receive in your account's notification settings.`;

  const sendOne = async (row: Claimed): Promise<Result> => {
    const who = contact.get(row.id);
    const values = { name: who?.name ?? null, service_name: serviceName };
    if (row.channel === 'sms') {
      if (smsStopped || !sms) return { id: row.id, status: 'queued' };
      const phone = who?.phone ?? null;
      if (!phone || !SOUTH_SUDAN_MOBILE_JS.test(phone)) {
        return { id: row.id, status: 'skipped', skip_reason: 'no_contact' };
      }
      try {
        const r = await sendOneSms(sms, phone, renderMessage(announcement.sms_body ?? '', values));
        return r.accepted
          ? { id: row.id, status: 'sent', provider_message_id: r.messageId ?? null }
          : { id: row.id, status: 'failed', error: (r.error ?? 'Refused.').slice(0, 300) };
      } catch (failure) {
        if (failure instanceof SmsUnavailableError) {
          smsStopped = true;
          return { id: row.id, status: 'failed', error: failure.message.slice(0, 300) };
        }
        throw failure;
      }
    }
    if (emailStopped || !mail) return { id: row.id, status: 'queued' };
    const address = row.auth_user_id ? emails.get(row.auth_user_id) : undefined;
    if (authUnavailable) return { id: row.id, status: 'queued' };
    if (!address || address.endsWith('.invalid')) {
      return { id: row.id, status: 'skipped', skip_reason: 'no_contact' };
    }
    try {
      const body = renderMessage(announcement.body, values);
      const r = await sendOneEmail(
        mail,
        address,
        renderMessage(announcement.title, values),
        announcement.category === 'essential' ? body : body + footer,
      );
      return r.accepted
        ? { id: row.id, status: 'sent', provider_message_id: r.messageId ?? null }
        : { id: row.id, status: 'failed', error: (r.error ?? 'Refused.').slice(0, 300) };
    } catch {
      emailStopped = true;
      return { id: row.id, status: 'failed', error: 'The email service could not be reached.' };
    }
  };

  const worker = async () => {
    while (next < claimed.length) {
      const row = claimed[next++] as Claimed;
      if (Date.now() - started > TIME_BUDGET_MS) {
        results.push({ id: row.id, status: 'queued' });
        continue;
      }
      results.push(await sendOne(row));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROVIDER_CONCURRENCY, claimed.length) }, () => worker()),
  );

  // Every outcome written back, with one audit row of counts.
  const channelOf = new Map(claimed.map((c) => [c.id, c.channel]));
  for (const r of results) {
    const bucket = outcome[channelOf.get(r.id) as 'sms' | 'email'];
    if (r.status === 'queued') bucket.requeued += 1;
    else bucket[r.status] += 1;
  }
  await audited(prisma, async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE public.announcement_delivery d
          SET status = x.status,
              skip_reason = x.skip_reason,
              provider_message_id = x.provider_message_id,
              error = x.error,
              sent_at = CASE WHEN x.status = 'sent' THEN now() ELSE d.sent_at END,
              attempts = CASE WHEN x.status = 'queued' THEN d.attempts - 1 ELSE d.attempts END,
              claimed_at = CASE WHEN x.status = 'queued' THEN NULL ELSE d.claimed_at END,
              updated_at = now()
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS x(id, status, skip_reason, provider_message_id, error)
        WHERE d.id = x.id AND d.status = 'sending'`,
      results.map((r) => r.id),
      results.map((r) => r.status),
      results.map((r) => r.skip_reason ?? null),
      results.map((r) => r.provider_message_id ?? null),
      results.map((r) => r.error ?? null),
    );
    for (const channel of ['sms', 'email'] as const) {
      const c = outcome[channel];
      if (c.sent + c.failed + c.skipped + c.requeued === 0) continue;
      await writeAudit(tx, {
        entityType: 'announcement',
        entityId: announcement.id,
        ...actor,
        action: 'announcement.batch_sent',
        after: { channel, ...c },
      });
    }
  });
  return outcome;
}

/**
 * Marks a sending announcement completed once nothing is queued or in flight,
 * with its audit row. Returns whether it did.
 */
export async function completeIfDone(auth: Authenticated, id: string): Promise<boolean> {
  return audited(prisma, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE public.announcement a
          SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE a.id = $1::uuid AND a.status = 'sending'
          AND NOT EXISTS (SELECT 1 FROM public.announcement_delivery d
                           WHERE d.announcement_id = a.id AND d.status IN ('queued', 'sending'))
        RETURNING a.id`,
      id,
    );
    if (!row) return false;
    const counts = await deliveryCounts(id, tx);
    await writeAudit(tx, {
      entityType: 'announcement',
      entityId: id,
      actorType: auth.role,
      actorId: auth.principal.id,
      action: 'announcement.completed',
      before: { status: 'sending' },
      after: { status: 'completed', deliveries: counts },
    });
    return true;
  });
}

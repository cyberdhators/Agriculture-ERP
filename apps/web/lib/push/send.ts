import { createHash } from 'node:crypto';

import webpush from 'web-push';

import { audited, writeAudit } from '../api/audit';
import { prisma } from '../db';
import type { RealtimeEvent } from '../realtime/publish';
import { alertsFor, intentsFrom, type Alert, type PushNote, type Subscriber } from './plan';

/**
 * SENDING PHONE ALERTS, SERVER-SIDE ONLY (2026-11-03). docs/DECISIONS.md,
 * "Push alerts on a phone".
 *
 * Runs after the answer has gone and the caller's transaction has committed
 * (lib/realtime/outbox.ts), and never throws: an alert is never a reason for a
 * member's action to fail or slow down. With no keys configured it does nothing.
 * A phone that has gone away (the service answers 404 or 410) is soft-deleted.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/push/send is server-only and must never be imported by a client.');
}

/** A slow service must not hold the function open for long. */
const SEND_TIMEOUT_MS = 5_000;
const AT_ONCE = 20;
/** Signal comes and goes: the service keeps an alert three days for a phone that is offline. */
const KEEP_FOR_S = 3 * 24 * 60 * 60;

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** Only the newest alert per thread reaches a phone that was offline. At most 32 url-safe characters. */
const topicOf = (tag: string) => createHash('sha256').update(tag).digest('base64url').slice(0, 32);

async function membersOfInbox(conversationId: string, organizations: string[]): Promise<string[]> {
  if (organizations.length === 0) return [];
  // Who may read it, as lib/api/notify.ts notices it: an advice request reaches
  // the members who handle advice, not everyone who reads the inbox.
  const rows = await prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `SELECT m.auth_user_id FROM public.organization_member m
       JOIN public.conversation c ON c.id = $1::uuid
      WHERE m.organization_id = ANY($2::uuid[]) AND m.status = 'active'
        AND (m.preset = 'administrator' OR
             (CASE WHEN c.post_kind = 'advice_case' THEN 'advisory.handle' ELSE 'inbox.read' END)
               = ANY (m.permissions))
      ORDER BY m.joined_at LIMIT 20`,
    conversationId,
    organizations,
  );
  return rows.map((r) => r.auth_user_id);
}

async function accountsOf(farmers: string[], organizations: string[]): Promise<string[]> {
  if (farmers.length === 0 && organizations.length === 0) return [];
  const rows = await prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
    `SELECT f.auth_user_id FROM public.farmer f
      WHERE f.id = ANY($1::uuid[]) AND f.auth_user_id IS NOT NULL AND f.deleted_at IS NULL
     UNION
     SELECT b.auth_user_id FROM public.buyer b
      WHERE b.organization_id = ANY($2::uuid[]) AND b.auth_user_id IS NOT NULL
        AND b.deleted_at IS NULL`,
    farmers,
    organizations,
  );
  return rows.map((r) => r.auth_user_id);
}

/** The account's live phones. A removed member's account has no farmer or buyer row: none. */
async function phonesOf(accounts: string[]): Promise<Subscriber[]> {
  if (accounts.length === 0) return [];
  return prisma.$queryRawUnsafe<Subscriber[]>(
    `SELECT s.id, s.auth_user_id, s.endpoint, s.p256dh, s.auth, s.language,
            CASE WHEN f.id IS NOT NULL THEN 'farmer' ELSE 'buyer' END AS side,
            COALESCE(p.updates_in_app, true) AS updates_on
       FROM public.push_subscription s
       LEFT JOIN public.farmer f ON f.auth_user_id = s.auth_user_id AND f.deleted_at IS NULL
       LEFT JOIN public.buyer b ON b.auth_user_id = s.auth_user_id AND b.deleted_at IS NULL
       LEFT JOIN public.notification_preference p ON p.auth_user_id = s.auth_user_id
      WHERE s.auth_user_id = ANY($1::uuid[]) AND s.deleted_at IS NULL
        AND (f.id IS NOT NULL OR b.id IS NOT NULL)`,
    accounts,
  );
}

async function forgetPhone(id: string): Promise<void> {
  await audited(prisma, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE public.push_subscription SET deleted_at = now(), updated_at = now()
        WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id`,
      id,
    );
    if (!row) return;
    await writeAudit(tx, {
      entityType: 'push_subscription',
      entityId: row.id,
      actorType: 'system',
      actorId: null,
      action: 'push_subscription.removed',
      after: { reason: 'gone' },
    });
  });
}

async function deliver(alert: Alert, keys: NonNullable<ReturnType<typeof vapid>>): Promise<void> {
  const { subscriber } = alert;
  try {
    await webpush.sendNotification(
      {
        endpoint: subscriber.endpoint,
        keys: { p256dh: subscriber.p256dh, auth: subscriber.auth },
      },
      JSON.stringify(alert.payload),
      {
        vapidDetails: keys,
        TTL: KEEP_FOR_S,
        urgency: alert.urgency,
        topic: topicOf(alert.tag),
        timeout: SEND_TIMEOUT_MS,
      },
    );
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) await forgetPhone(subscriber.id);
  }
}

export async function sendPushes(
  events: readonly RealtimeEvent[],
  notes: readonly PushNote[],
): Promise<void> {
  try {
    const keys = vapid();
    if (!keys) return;
    const seen = new Set<string>();
    const alerts: Alert[] = [];
    for (const intent of intentsFrom(events, notes)) {
      const accounts = [
        ...intent.accounts,
        ...(await accountsOf(intent.farmers, intent.conversationId ? [] : intent.organizations)),
        ...(intent.conversationId
          ? await membersOfInbox(intent.conversationId, intent.organizations)
          : []),
      ];
      alerts.push(...alertsFor(intent, await phonesOf([...new Set(accounts)]), seen));
    }
    for (let i = 0; i < alerts.length; i += AT_ONCE) {
      await Promise.allSettled(alerts.slice(i, i + AT_ONCE).map((a) => deliver(a, keys)));
    }
  } catch {
    // Never in the way: the notice is stored, and the in-app badge still shows it.
  }
}

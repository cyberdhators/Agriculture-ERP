import {
  matchWords,
  selectMatchRecipients,
  type MatchCandidate,
  type MatchItem,
  type MatchPost,
} from '@agri-erp/shared';

import { prisma } from '../db';
import { afterResponse, flushRealtime, withRealtimeOutbox } from '../realtime/outbox';
import { sendOneSms, smsConfig } from '../sms/bird';
import { audited, type AuditTx } from './audit';
import { MARKET_BASE_WHERE, MARKET_FROM } from './buyer-presenters';
import { BUYING_REQUEST_FROM, BUYING_REQUEST_MARKET_WHERE } from './market-posts';
import { notifyAccountWithId } from './notify';

/**
 * MATCH ALERTS, THE SERVER SIDE (2026-10-26). docs/DECISIONS.md, "Match
 * alerts". Who is told is decided by shared/src/match-alerts.ts; this file
 * reads the candidates and writes the notices.
 *
 *   A BUYING REQUEST goes on the market  -> the people selling that product
 *     (an active listing of it, or the product on their public profile), in
 *     the request's state, are told "A buyer is looking for something you
 *     sell", which opens the request.
 *   A PRODUCE LISTING goes on the market -> the owners of open buying
 *     requests for that product in its state are told "New produce matches
 *     your buying request", which opens the listing.
 *
 * NEVER IN THE POSTER'S WAY. It runs after the post's own answer has gone
 * (`after()`), in its own transaction; any failure -- a database without
 * migration 20261101090000, an outage -- is swallowed and the post is
 * unaffected. A notice is a fixed sentence (ACCOUNT_NOTICES), audited as
 * 'notification.created' like every other notice, and its live pop carries
 * only ids (lib/realtime).
 *
 * MARKETING RULES: never the poster, never across a block, never a suspended
 * account, only with the match-alert switch on (it is on by default in the
 * app), at most MATCH_ALERT_DAILY_CAP in 24 hours per person, and one alert
 * per person per post however often it is saved (marketing_notice). SMS only
 * for people who switched SMS match alerts on (off by default).
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

const SYSTEM = { actorType: 'system' as const, actorId: null };

const SMS_TEXT: Record<MatchPost['kind'], string> = {
  buying_request:
    'AgriOne: a buyer is looking for something you sell. Open the app to see the request. Reply STOP to stop these messages.',
  listing:
    'AgriOne: new produce matches your buying request. Open the app to see it. Reply STOP to stop these messages.',
};

/** The post, if it is on the market now. */
async function loadPost(db: Db, kind: MatchPost['kind'], id: string): Promise<MatchPost | null> {
  if (kind === 'buying_request') {
    const [row] = await db.$queryRawUnsafe<MatchPost[]>(
      `SELECT 'buying_request' AS kind, br.category::text AS category, br.product_name,
              br.state_id, COALESCE(f.auth_user_id, b.auth_user_id) AS poster_auth_user_id
         ${BUYING_REQUEST_FROM}
        WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
      id,
    );
    return row ?? null;
  }
  const [row] = await db.$queryRawUnsafe<MatchPost[]>(
    `SELECT 'listing' AS kind, pl.category::text AS category, pl.product_name, pl.state_id,
            f.auth_user_id AS poster_auth_user_id
       ${MARKET_FROM}
      WHERE pl.id = $1::uuid AND ${MARKET_BASE_WHERE}`,
    id,
  );
  return row ?? null;
}

interface ItemRow extends MatchItem {
  auth_user_id: string;
}

/** What each possible recipient sells (for a request) or wants (for a listing). */
async function candidateItems(db: Db, post: MatchPost, patterns: string[]): Promise<ItemRow[]> {
  if (post.kind === 'buying_request') {
    return db.$queryRawUnsafe<ItemRow[]>(
      `SELECT f.auth_user_id, pl.category::text AS category, pl.product_name, pl.state_id
         ${MARKET_FROM}
        WHERE ${MARKET_BASE_WHERE} AND f.auth_user_id IS NOT NULL
          AND pl.product_name ILIKE ANY ($1::text[])
       UNION ALL
       SELECT ap.auth_user_id, NULL::text, p.product, ap.state_id
         FROM public.account_profile ap
         CROSS JOIN LATERAL unnest(ap.products) AS p(product)
        WHERE p.product ILIKE ANY ($1::text[])
        LIMIT 500`,
      patterns,
    );
  }
  return db.$queryRawUnsafe<ItemRow[]>(
    `SELECT COALESCE(f.auth_user_id, b.auth_user_id) AS auth_user_id,
            br.category::text AS category, br.product_name, br.state_id
       ${BUYING_REQUEST_FROM}
      WHERE ${BUYING_REQUEST_MARKET_WHERE}
        AND COALESCE(f.auth_user_id, b.auth_user_id) IS NOT NULL
        AND br.product_name ILIKE ANY ($1::text[])
      LIMIT 500`,
    patterns,
  );
}

interface FactRow {
  auth_user_id: string;
  suspended: boolean;
  blocked: boolean;
  match_in_app: boolean;
  match_sms: boolean;
  sent_last_24h: number;
  already_told: boolean;
}

/** The marketing facts about each candidate, in one statement. */
async function candidateFacts(
  db: Db,
  people: string[],
  poster: string | null,
  kind: MatchPost['kind'],
  postId: string,
): Promise<Map<string, FactRow>> {
  const rows = await db.$queryRawUnsafe<FactRow[]>(
    `SELECT u.id AS auth_user_id,
            (EXISTS (SELECT 1 FROM public.farmer f WHERE f.auth_user_id = u.id
                      AND f.deleted_at IS NULL AND f.suspended_at IS NOT NULL)
             OR EXISTS (SELECT 1 FROM public.buyer b WHERE b.auth_user_id = u.id
                      AND b.deleted_at IS NULL AND b.suspended_at IS NOT NULL)) AS suspended,
            ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM public.account_block k
                      WHERE k.ended_at IS NULL
                        AND ((k.blocker_auth_user_id = u.id AND k.blocked_auth_user_id = $2::uuid)
                          OR (k.blocker_auth_user_id = $2::uuid AND k.blocked_auth_user_id = u.id))))
              AS blocked,
            COALESCE((to_jsonb(p) ->> 'match_in_app')::boolean, true) AS match_in_app,
            COALESCE((to_jsonb(p) ->> 'match_sms')::boolean, false) AS match_sms,
            (SELECT count(*)::int FROM public.marketing_notice m
              WHERE m.auth_user_id = u.id AND m.created_at > now() - interval '24 hours')
              AS sent_last_24h,
            EXISTS (SELECT 1 FROM public.marketing_notice m
                     WHERE m.auth_user_id = u.id AND m.post_kind = $3 AND m.post_id = $4::uuid)
              AS already_told
       FROM unnest($1::uuid[]) AS u(id)
       LEFT JOIN public.notification_preference p ON p.auth_user_id = u.id`,
    people,
    poster,
    kind,
    postId,
  );
  return new Map(rows.map((r) => [r.auth_user_id, r]));
}

export interface MatchRun {
  told: number;
  sms: number;
}

/** Decides and writes the alerts for one post. Returns how many were told. */
export async function runMatchAlerts(kind: MatchPost['kind'], postId: string): Promise<MatchRun> {
  const post = await loadPost(prisma, kind, postId);
  if (!post) return { told: 0, sms: 0 };
  const words = matchWords(post.product_name);
  if (words.length === 0) return { told: 0, sms: 0 };
  const items = await candidateItems(
    prisma,
    post,
    words.map((w) => `%${w.replace(/[\\%_]/g, '')}%`),
  );
  const byPerson = new Map<string, MatchItem[]>();
  for (const i of items) {
    const list = byPerson.get(i.auth_user_id) ?? [];
    list.push({ category: i.category, product_name: i.product_name, state_id: i.state_id });
    byPerson.set(i.auth_user_id, list);
  }
  if (byPerson.size === 0) return { told: 0, sms: 0 };
  const facts = await candidateFacts(
    prisma,
    [...byPerson.keys()],
    post.poster_auth_user_id,
    kind,
    postId,
  );
  const candidates: MatchCandidate[] = [...byPerson.entries()].flatMap(([id, list]) => {
    const f = facts.get(id);
    return f
      ? [
          {
            auth_user_id: id,
            items: list,
            suspended: f.suspended,
            blocked: f.blocked,
            match_in_app: f.match_in_app,
            sent_last_24h: f.sent_last_24h,
            already_told: f.already_told,
          },
        ]
      : [];
  });
  const recipients = selectMatchRecipients(post, candidates);
  if (recipients.length === 0) return { told: 0, sms: 0 };

  const notice = kind === 'buying_request' ? 'match_buying_request' : 'match_listing';
  const { result: told, events } = await withRealtimeOutbox(() =>
    audited(prisma, async (tx) => {
      const out: { authUserId: string; markId: string }[] = [];
      for (const authUserId of recipients) {
        // The once-per-post record first: a concurrent run for the same post
        // finds it taken and tells nobody twice.
        const [mark] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.marketing_notice (auth_user_id, kind, post_kind, post_id)
           VALUES ($1::uuid, 'match', $2, $3::uuid)
           ON CONFLICT DO NOTHING RETURNING id`,
          authUserId,
          kind,
          postId,
        );
        if (!mark) continue;
        const notificationId = await notifyAccountWithId(tx, { authUserId }, notice, SYSTEM, {
          kind,
          id: postId,
        });
        if (notificationId) {
          await tx.$executeRawUnsafe(
            `UPDATE public.marketing_notice SET notification_id = $2::uuid WHERE id = $1::uuid`,
            mark.id,
            notificationId,
          );
        }
        out.push({ authUserId, markId: mark.id });
      }
      return out;
    }),
  );
  // Published now: this runs after the poster's answer, outside its request.
  flushRealtime(events);

  // SMS only to those who switched SMS match alerts on. Best effort.
  let sms = 0;
  const smsTo = told.filter((t) => facts.get(t.authUserId)?.match_sms === true);
  if (smsTo.length > 0) {
    try {
      const config = smsConfig();
      const phones = await prisma.$queryRawUnsafe<{ auth_user_id: string; phone: string }[]>(
        `SELECT DISTINCT ON (x.auth_user_id) x.auth_user_id, x.phone FROM (
           SELECT f.auth_user_id, f.phone FROM public.farmer_active f
            WHERE f.auth_user_id = ANY ($1::uuid[]) AND f.phone ~ '^\\+211[0-9]{9}$'
           UNION ALL
           SELECT b.auth_user_id, b.phone FROM public.buyer_active b
            WHERE b.auth_user_id = ANY ($1::uuid[]) AND b.phone ~ '^\\+211[0-9]{9}$') x`,
        smsTo.map((t) => t.authUserId),
      );
      const phoneOf = new Map(phones.map((p) => [p.auth_user_id, p.phone]));
      for (const t of smsTo) {
        const phone = phoneOf.get(t.authUserId);
        if (!phone) continue;
        const r = await sendOneSms(config, phone, SMS_TEXT[kind], {
          idempotencyKey: `match-alert-${t.markId}`,
        }).catch(() => null);
        if (r?.accepted) sms += 1;
      }
    } catch {
      // Not configured, or unreachable: the in-app alert stands on its own.
    }
  }
  return { told: told.length, sms };
}

/**
 * Called by the routes that put a post on the market. Runs after the answer;
 * never throws, never delays the poster. `wasLive` false and `isLive` true is
 * the only case that alerts anyone.
 */
export function matchAlertsAfter(
  kind: MatchPost['kind'],
  postId: string,
  wasLive: boolean,
  isLive: boolean,
): void {
  if (wasLive || !isLive) return;
  afterResponse(() => runMatchAlerts(kind, postId).catch(() => undefined));
}

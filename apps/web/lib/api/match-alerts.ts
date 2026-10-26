import {
  SELLING_ACTIVITIES,
  matchWords,
  selectAlertRecipients,
  type AlertRecipient,
  type MatchAlertSource,
  type MatchCandidate,
  type MatchItem,
  type MatchPost,
  type SavedSearchCandidate,
  type SavedSearchCriteria,
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
 *
 * SAVED SEARCHES (2026-11-03, migration 20261103100000). A live, unpaused
 * saved search the post answers is one more way to be a candidate, under
 * exactly the rules above (shared/src/saved-searches.ts). A person already
 * told by the matches above is told once, as before; a saved search only
 * adds people, with its own sentence ("... matches your saved search"). Each
 * alert records its source and, when the provider accepts it, its SMS time,
 * for the staff report. On a database without the migration none of this
 * runs and the alerts are exactly as they were.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

const SYSTEM = { actorType: 'system' as const, actorId: null };

const SMS_TEXT: Record<MatchPost['kind'], string> = {
  buying_request:
    'AgriOne: a buyer is looking for something you sell. Open the app to see the request. Reply STOP to stop these messages.',
  listing:
    'AgriOne: new produce matches your buying request. Open the app to see it. Reply STOP to stop these messages.',
};

/** 2026-11-03: the SMS for a saved-search alert. */
const SAVED_SMS_TEXT: Record<MatchPost['kind'], string> = {
  buying_request:
    'AgriOne: a new buying request matches your saved search. Open the app to see it. Reply STOP to stop these messages.',
  listing:
    'AgriOne: new produce matches your saved search. Open the app to see it. Reply STOP to stop these messages.',
};

/** The notice each kind of post and source sends (lib/farmer-notices.ts). */
const NOTICE = {
  buying_request: { activity: 'match_buying_request', saved: 'match_saved_buying_request' },
  listing: { activity: 'match_listing', saved: 'match_saved_listing' },
} as const;

/** The post, if it is on the market now. */
async function loadPost(db: Db, kind: MatchPost['kind'], id: string): Promise<MatchPost | null> {
  if (kind === 'buying_request') {
    const [row] = await db.$queryRawUnsafe<MatchPost[]>(
      `SELECT 'buying_request' AS kind, br.category::text AS category, br.product_name,
              br.state_id, COALESCE(f.auth_user_id, b.auth_user_id) AS poster_auth_user_id,
              br.price_ssp::float8 AS price_ssp
         ${BUYING_REQUEST_FROM}
        WHERE br.id = $1::uuid AND ${BUYING_REQUEST_MARKET_WHERE}`,
      id,
    );
    return row ?? null;
  }
  const [row] = await db.$queryRawUnsafe<MatchPost[]>(
    `SELECT 'listing' AS kind, pl.category::text AS category, pl.product_name, pl.state_id,
            f.auth_user_id AS poster_auth_user_id, pl.price_ssp::float8 AS price_ssp
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
          AND (cardinality(ap.activities) = 0 OR ap.activities && $2::text[])
        LIMIT 500`,
      patterns,
      [...SELLING_ACTIVITIES],
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

/** 2026-11-03: whether migration 20261103100000 is in this database. Cannot fail. */
async function savedSearchesStored(db: Db): Promise<boolean> {
  const [row] = await db.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT (to_regclass('public.saved_search') IS NOT NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'marketing_notice'
                            AND column_name = 'sms_sent_at')) AS present`,
  );
  return row?.present === true;
}

interface SavedRow extends SavedSearchCriteria {
  id: string;
  auth_user_id: string;
}

/**
 * The live, unpaused saved searches that may answer the post, narrowed in
 * SQL the way candidateItems is (same kind; category and state equal or not
 * named; a product word in common, or no product named). The pure
 * savedSearchMatches makes the decision.
 */
async function savedSearchRows(db: Db, post: MatchPost, patterns: string[]): Promise<SavedRow[]> {
  return db.$queryRawUnsafe<SavedRow[]>(
    `SELECT s.id, s.auth_user_id, s.target, s.product_name, s.category::text AS category,
            s.state_id, s.max_price_ssp::float8 AS max_price_ssp
       FROM public.saved_search s
      WHERE s.deleted_at IS NULL AND s.paused_at IS NULL AND s.target = $1
        AND (s.category IS NULL OR s.category::text = $2)
        AND (s.state_id IS NULL OR s.state_id = $3)
        AND (s.product_name IS NULL OR s.product_name ILIKE ANY ($4::text[]))
      ORDER BY s.created_at, s.id
      LIMIT 500`,
    post.kind,
    post.category,
    post.state_id,
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
  const patterns = words.map((w) => `%${w.replace(/[\\%_]/g, '')}%`);
  const items = await candidateItems(prisma, post, patterns);
  const byPerson = new Map<string, MatchItem[]>();
  for (const i of items) {
    const list = byPerson.get(i.auth_user_id) ?? [];
    list.push({ category: i.category, product_name: i.product_name, state_id: i.state_id });
    byPerson.set(i.auth_user_id, list);
  }
  // 2026-11-03: saved searches, only where the database has them.
  const withSources = await savedSearchesStored(prisma).catch(() => false);
  const searchesOf = new Map<string, SavedRow[]>();
  if (withSources) {
    for (const row of await savedSearchRows(prisma, post, patterns)) {
      const list = searchesOf.get(row.auth_user_id) ?? [];
      list.push(row);
      searchesOf.set(row.auth_user_id, list);
    }
  }
  const people = [...new Set([...byPerson.keys(), ...searchesOf.keys()])];
  if (people.length === 0) return { told: 0, sms: 0 };
  const facts = await candidateFacts(prisma, people, post.poster_auth_user_id, kind, postId);
  const factsOf = (id: string) => {
    const f = facts.get(id);
    return f
      ? {
          auth_user_id: id,
          suspended: f.suspended,
          blocked: f.blocked,
          match_in_app: f.match_in_app,
          sent_last_24h: f.sent_last_24h,
          already_told: f.already_told,
        }
      : null;
  };
  const candidates: MatchCandidate[] = [...byPerson.entries()].flatMap(([id, list]) => {
    const f = factsOf(id);
    return f ? [{ ...f, items: list }] : [];
  });
  const savedCandidates: SavedSearchCandidate[] = [...searchesOf.entries()].flatMap(
    ([id, list]) => {
      const f = factsOf(id);
      return f
        ? [
            {
              ...f,
              searches: list.map((r) => ({
                id: r.id,
                target: r.target,
                product_name: r.product_name,
                category: r.category,
                state_id: r.state_id,
                max_price_ssp: r.max_price_ssp === null ? null : Number(r.max_price_ssp),
              })),
            },
          ]
        : [];
    },
  );
  const recipients: AlertRecipient[] = selectAlertRecipients(post, candidates, savedCandidates);
  if (recipients.length === 0) return { told: 0, sms: 0 };

  const { result: told, events } = await withRealtimeOutbox(() =>
    audited(prisma, async (tx) => {
      const out: { authUserId: string; markId: string; source: MatchAlertSource }[] = [];
      for (const r of recipients) {
        const authUserId = r.auth_user_id;
        // The once-per-post record first: a concurrent run for the same post
        // finds it taken and tells nobody twice.
        const [mark] = withSources
          ? await tx.$queryRawUnsafe<{ id: string }[]>(
              `INSERT INTO public.marketing_notice
                 (auth_user_id, kind, post_kind, post_id, source, saved_search_id)
               VALUES ($1::uuid, 'match', $2, $3::uuid, $4, $5::uuid)
               ON CONFLICT DO NOTHING RETURNING id`,
              authUserId,
              kind,
              postId,
              r.source,
              r.saved_search_id ?? null,
            )
          : await tx.$queryRawUnsafe<{ id: string }[]>(
              `INSERT INTO public.marketing_notice (auth_user_id, kind, post_kind, post_id)
               VALUES ($1::uuid, 'match', $2, $3::uuid)
               ON CONFLICT DO NOTHING RETURNING id`,
              authUserId,
              kind,
              postId,
            );
        if (!mark) continue;
        const notice = r.source === 'saved_search' ? NOTICE[kind].saved : NOTICE[kind].activity;
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
        out.push({ authUserId, markId: mark.id, source: r.source });
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
        const text = t.source === 'saved_search' ? SAVED_SMS_TEXT[kind] : SMS_TEXT[kind];
        const r = await sendOneSms(config, phone, text, {
          idempotencyKey: `match-alert-${t.markId}`,
        }).catch(() => null);
        if (r?.accepted) {
          sms += 1;
          // 2026-11-03: for the staff report. A time only; never the number.
          if (withSources) {
            await prisma
              .$executeRawUnsafe(
                `UPDATE public.marketing_notice SET sms_sent_at = now() WHERE id = $1::uuid`,
                t.markId,
              )
              .catch(() => undefined);
          }
        }
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

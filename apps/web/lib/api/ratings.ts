import {
  ratingRefusal,
  ratingWindowEnds,
  summarizeRatings,
  RATING_WINDOW_DAYS,
  type DealKind,
  type DealToRate,
  type ModerationRating,
  type RaterSide,
  type RatingSummary,
  type RatingSummaryRow,
  type ReceivedRating,
} from '@agri-erp/shared';

import { type AuditTx } from './audit';
import { blockedBetween } from './blocks';
import { notFound, unprocessable } from './errors';
import { viewerIsOwnerSql, viewerWhere, type Viewer } from './messaging';
import { PERSON_NAME_SQL } from './organizations';

/**
 * RATINGS AFTER A COMPLETED DEAL (2026-11-03, lane-trust). The rules are pure
 * and live in packages/shared/src/ratings.ts; this module reads the deals and
 * the ratings for them. docs/DECISIONS.md, "Ratings after a completed deal".
 *
 * A DEAL is a completed purchase order (sides buyer and seller) or a
 * conversation about a completed listing, buying request or service in which
 * BOTH sides wrote (sides owner and starter). Nobody else is a party: a
 * stranger asking about a deal is 404, never told it exists.
 *
 * WHO A SIDE IS. A conversation side may be an organisation's shared inbox
 * (team access): it is then the organisation that rates (a member holding
 * inbox.reply writes it) and the organisation that is rated. An order's
 * seller is the farmer the order names; its buyer is a live buyer account of
 * the ordering organisation, and the buyer rated is the person who made the
 * purchase request (or, with none, the organisation's first buyer account).
 *
 * WHAT IS NEVER SHOWN. Who rated is shown only as a name the rater already
 * shows publicly -- their published public profile's display name, or their
 * published organisation's name -- and otherwise as "An AgriOne member". No
 * sign-in or record id ever leaves here.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

/** The rated party: a person or an organisation. */
export type Ratee =
  { authUserId: string; organizationId: null } | { authUserId: null; organizationId: string };

/** One deal, from the caller's side. */
export interface DealForViewer {
  kind: DealKind;
  id: string;
  side: RaterSide;
  /** False when the caller is not one of the two sides (or, for a conversation, a side never wrote). */
  isParty: boolean;
  completed: boolean;
  completedAt: Date | null;
  ratee: Ratee | null;
  /** The two people, for the person-level block check. */
  people: [string, string] | null;
}

/** A post completed: its owner said so. Listings store the legacy `sold` too. */
const POST_COMPLETION_SQL = `LEFT JOIN LATERAL (
    SELECT (pl.status::text IN ('completed', 'sold')) AS completed, pl.updated_at AS completed_at
      FROM public.produce_listing pl
     WHERE c.post_kind = 'listing' AND pl.id = c.post_id AND pl.deleted_at IS NULL
    UNION ALL
    SELECT (br.status = 'completed'), br.updated_at
      FROM public.buying_request br
     WHERE c.post_kind = 'buying_request' AND br.id = c.post_id AND br.deleted_at IS NULL
    UNION ALL
    SELECT (sl.status = 'completed'), sl.updated_at
      FROM public.service_listing sl
     WHERE c.post_kind = 'service' AND sl.id = c.post_id AND sl.deleted_at IS NULL
  ) p ON true`;

/** Whether a side of conversation `c` wrote at least one message. */
const SIDE_WROTE = (side: 'owner' | 'starter') => `EXISTS (
    SELECT 1 FROM public.message m
     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
       AND COALESCE(m.sender_side,
             CASE WHEN m.sender_auth_user_id = c.owner_auth_user_id THEN 'owner' ELSE 'starter' END)
           = '${side}')`;

/** When an order completed: its "completed" timeline entry, else its last change. */
const ORDER_COMPLETED_AT = `COALESCE(
    (SELECT max(du.occurred_at) FROM public.delivery_update du
      WHERE du.order_id = po.id AND du.status::text = 'completed'),
    po.updated_at)`;

/** The buyer an order's seller rates: who made the request, else the organisation's first buyer. */
const ORDER_BUYER_PERSON = `COALESCE(
    (SELECT b.auth_user_id FROM public.purchase_request pr
       JOIN public.buyer_active b ON b.id = pr.created_by
      WHERE pr.id = po.purchase_request_id),
    (SELECT b.auth_user_id FROM public.buyer_active b
      WHERE b.organization_id = po.organization_id ORDER BY b.created_at, b.id LIMIT 1))`;

/** The caller's live buyer account in the ordering organisation. */
const I_BUY = (person: string) => `EXISTS (
    SELECT 1 FROM public.buyer_active b
     WHERE b.organization_id = po.organization_id AND b.auth_user_id = ${person}::uuid
       AND b.suspended_at IS NULL)`;

/** One deal as the caller sees it; 404 when it does not exist or cannot concern them. */
export async function dealForViewer(
  db: Db,
  kind: DealKind,
  id: string,
  viewer: Viewer,
): Promise<DealForViewer> {
  if (kind === 'conversation') {
    const [row] = await db.$queryRawUnsafe<
      {
        id: string;
        i_own: boolean;
        owner_auth_user_id: string;
        starter_auth_user_id: string;
        owner_organization_id: string | null;
        starter_organization_id: string | null;
        completed: boolean | null;
        completed_at: Date | null;
        owner_wrote: boolean;
        starter_wrote: boolean;
      }[]
    >(
      `SELECT c.id, ${viewerIsOwnerSql('$2', '$3')} AS i_own,
              c.owner_auth_user_id, c.starter_auth_user_id,
              c.owner_organization_id, c.starter_organization_id,
              p.completed, p.completed_at,
              ${SIDE_WROTE('owner')} AS owner_wrote, ${SIDE_WROTE('starter')} AS starter_wrote
         FROM public.conversation c
         ${POST_COMPLETION_SQL}
        WHERE c.id = $1::uuid AND c.post_kind <> 'advice_case' AND ${viewerWhere('$2', '$3')}`,
      id,
      viewer.person,
      viewer.org,
    );
    if (!row) throw notFound();
    const side: RaterSide = row.i_own ? 'owner' : 'starter';
    const otherOrg = row.i_own ? row.starter_organization_id : row.owner_organization_id;
    const otherPerson = row.i_own ? row.starter_auth_user_id : row.owner_auth_user_id;
    return {
      kind,
      id: row.id,
      side,
      isParty: row.owner_wrote && row.starter_wrote,
      completed: row.completed === true,
      completedAt: row.completed_at,
      ratee: otherOrg
        ? { authUserId: null, organizationId: otherOrg }
        : { authUserId: otherPerson, organizationId: null },
      people: [row.owner_auth_user_id, row.starter_auth_user_id],
    };
  }

  // An order is a person's deal: never an organisation inbox's.
  const [row] = await db.$queryRawUnsafe<
    {
      id: string;
      completed: boolean;
      completed_at: Date;
      farmer_auth_user_id: string | null;
      buyer_auth_user_id: string | null;
      i_sell: boolean;
      i_buy: boolean;
    }[]
  >(
    `SELECT po.id, (po.status::text = 'completed') AS completed,
            ${ORDER_COMPLETED_AT} AS completed_at,
            f.auth_user_id AS farmer_auth_user_id,
            ${ORDER_BUYER_PERSON} AS buyer_auth_user_id,
            (f.auth_user_id IS NOT NULL AND f.auth_user_id = $2::uuid
              AND f.suspended_at IS NULL) AS i_sell,
            ${I_BUY('$2')} AS i_buy
       FROM public.purchase_order po
       JOIN public.farmer_active f ON f.id = po.farmer_id
      WHERE po.id = $1::uuid AND po.deleted_at IS NULL`,
    id,
    viewer.person,
  );
  if (!row || viewer.org !== null || row.i_sell === row.i_buy) throw notFound();
  const otherPerson = row.i_sell ? row.buyer_auth_user_id : row.farmer_auth_user_id;
  if (!otherPerson || otherPerson === viewer.person) throw notFound();
  return {
    kind,
    id: row.id,
    side: row.i_sell ? 'seller' : 'buyer',
    isParty: true,
    completed: row.completed,
    completedAt: row.completed ? row.completed_at : null,
    ratee: { authUserId: otherPerson, organizationId: null },
    people: [viewer.person, otherPerson],
  };
}

/** Whether the caller's side has already rated this deal. */
export async function alreadyRated(db: Db, deal: DealForViewer): Promise<boolean> {
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.deal_rating
      WHERE deal_kind = $1 AND deal_id = $2::uuid AND rater_side = $3`,
    deal.kind,
    deal.id,
    deal.side,
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Applies the rule (packages/shared ratingRefusal) and turns a refusal into
 * the caller's answer: a stranger is 404, everything else names its rule.
 */
export async function assertMayRate(db: Db, deal: DealForViewer, now: Date): Promise<void> {
  const blocked = deal.people ? await blockedBetween(db, deal.people[0], deal.people[1]) : false;
  const refusal = ratingRefusal({
    isParty: deal.isParty && deal.ratee !== null,
    completed: deal.completed,
    completedAt: deal.completedAt,
    alreadyRated: await alreadyRated(db, deal),
    blocked,
    now,
  });
  if (refusal === null) return;
  if (refusal === 'not_party') throw notFound();
  if (refusal === 'not_completed') throw unprocessable('rating_not_completed');
  if (refusal === 'already_rated') throw unprocessable('rating_already_given');
  if (refusal === 'window_closed') throw unprocessable('rating_window_closed');
  throw unprocessable('rating_account_blocked');
}

// ---------------------------------------------------------------------------
// LISTS FOR THE PARTIES
// ---------------------------------------------------------------------------

const WINDOW = `interval '${RATING_WINDOW_DAYS} days'`;

/** The completed deals the caller's side may still rate, newest first. At most 50. */
export async function dealsToRate(db: Db, viewer: Viewer): Promise<DealToRate[]> {
  const conversations = await db.$queryRawUnsafe<
    { deal_id: string; title: string; other_name: string; completed_at: Date }[]
  >(
    `SELECT c.id AS deal_id, c.post_title AS title,
            CASE WHEN ${viewerIsOwnerSql('$1', '$2')} THEN c.starter_name ELSE c.owner_name END
              AS other_name,
            p.completed_at
       FROM public.conversation c
       ${POST_COMPLETION_SQL}
      WHERE ${viewerWhere('$1', '$2')} AND c.post_kind <> 'advice_case'
        AND p.completed AND p.completed_at > now() - ${WINDOW}
        AND ${SIDE_WROTE('owner')} AND ${SIDE_WROTE('starter')}
        AND NOT EXISTS (
          SELECT 1 FROM public.deal_rating r
           WHERE r.deal_kind = 'conversation' AND r.deal_id = c.id
             AND r.rater_side = CASE WHEN ${viewerIsOwnerSql('$1', '$2')}
                                     THEN 'owner' ELSE 'starter' END)
        AND NOT EXISTS (
          SELECT 1 FROM public.account_block ab
           WHERE ab.ended_at IS NULL
             AND ((ab.blocker_auth_user_id = c.owner_auth_user_id
                   AND ab.blocked_auth_user_id = c.starter_auth_user_id)
               OR (ab.blocker_auth_user_id = c.starter_auth_user_id
                   AND ab.blocked_auth_user_id = c.owner_auth_user_id)))
      ORDER BY p.completed_at DESC, c.id LIMIT 50`,
    viewer.person,
    viewer.org,
  );
  const orders =
    viewer.org !== null
      ? []
      : await db.$queryRawUnsafe<
          { deal_id: string; title: string; other_name: string; completed_at: Date }[]
        >(
          `SELECT * FROM (
             SELECT po.id AS deal_id, po.product_name AS title,
                    CASE WHEN f.auth_user_id = $1::uuid THEN bo.name ELSE pl.trading_name END
                      AS other_name,
                    ${ORDER_COMPLETED_AT} AS completed_at,
                    CASE WHEN f.auth_user_id = $1::uuid THEN 'seller' ELSE 'buyer' END AS side
               FROM public.purchase_order po
               JOIN public.farmer_active f ON f.id = po.farmer_id
               JOIN public.buyer_organization bo ON bo.id = po.organization_id
               JOIN public.produce_listing pl ON pl.id = po.listing_id
              WHERE po.deleted_at IS NULL AND po.status::text = 'completed'
                AND ((f.auth_user_id = $1::uuid AND f.suspended_at IS NULL) <> ${I_BUY('$1')})
           ) o
           WHERE o.completed_at > now() - ${WINDOW}
             AND NOT EXISTS (
               SELECT 1 FROM public.deal_rating r
                WHERE r.deal_kind = 'purchase_order' AND r.deal_id = o.deal_id
                  AND r.rater_side = o.side)
           ORDER BY o.completed_at DESC, o.deal_id LIMIT 50`,
          viewer.person,
        );
  const present = (kind: DealKind) => (r: (typeof conversations)[number]) => ({
    deal_kind: kind,
    deal_id: r.deal_id,
    title: r.title,
    other_name: r.other_name,
    completed_at: r.completed_at.toISOString(),
    rate_by: ratingWindowEnds(r.completed_at).toISOString(),
  });
  return [...orders.map(present('purchase_order')), ...conversations.map(present('conversation'))]
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
    .slice(0, 50);
}

/**
 * The rater's public name, as SQL over `r`: their published organisation's
 * name when they rated for one, else their published public profile's
 * display name; null otherwise ("An AgriOne member").
 */
export const RATER_NAME_SQL = `(CASE WHEN r.rater_organization_id IS NOT NULL
    THEN (SELECT o.name FROM public.organization o
           WHERE o.id = r.rater_organization_id AND o.status = 'published'
             AND o.deleted_at IS NULL AND o.closed_at IS NULL)
    ELSE (SELECT ap.display_name FROM public.account_profile ap
           WHERE ap.auth_user_id = r.rater_auth_user_id AND ap.status = 'published') END)`;

/**
 * The rater's account is live, as SQL over `r`: a farmer or buyer record not
 * removed and not suspended (a disabled account is suspended too), and none
 * of its records suspended -- PROFILE_ACCOUNT_LIVE's rule, for the rater.
 */
export const RATER_LIVE_SQL = `(
  (EXISTS (SELECT 1 FROM public.farmer_active fa
            WHERE fa.auth_user_id = r.rater_auth_user_id AND fa.suspended_at IS NULL)
   OR EXISTS (SELECT 1 FROM public.buyer_active ba
               WHERE ba.auth_user_id = r.rater_auth_user_id AND ba.suspended_at IS NULL))
  AND NOT EXISTS (SELECT 1 FROM public.farmer_active fs
                   WHERE fs.auth_user_id = r.rater_auth_user_id AND fs.suspended_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.buyer_active bs
                   WHERE bs.auth_user_id = r.rater_auth_user_id AND bs.suspended_at IS NOT NULL)
)`;

/** Ratings of one party: a person (`$1`) or an organisation (`$2`). */
const RATEE_WHERE = `r.deleted_at IS NULL AND (
    ($1::uuid IS NOT NULL AND r.ratee_auth_user_id = $1::uuid AND r.ratee_organization_id IS NULL)
    OR ($2::uuid IS NOT NULL AND r.ratee_organization_id = $2::uuid))`;

type SummaryRow = Omit<RatingSummaryRow, 'created_at'> & { created_at: Date };

async function rowsOf(db: Db, ratee: Ratee): Promise<SummaryRow[]> {
  return db.$queryRawUnsafe<SummaryRow[]>(
    `SELECT r.stars, r.comment, ${RATER_NAME_SQL} AS rater_name, r.created_at,
            r.hidden_at, r.deleted_at, ${RATER_LIVE_SQL} AS rater_live
       FROM public.deal_rating r
      WHERE ${RATEE_WHERE}
      ORDER BY r.created_at DESC, r.id DESC LIMIT 500`,
    ratee.authUserId,
    ratee.organizationId,
  );
}

/**
 * THE PUBLIC SUMMARY of one party: average, count and the latest comments,
 * from visible ratings only (shared summarizeRatings). Read by the public
 * profile routes, which have already decided the profile may be shown.
 */
export async function ratingSummaryOf(db: Db, ratee: Ratee): Promise<RatingSummary> {
  return summarizeRatings(await rowsOf(db, ratee));
}

/** The ratings the caller's side received, every one (hidden ones marked), newest first. */
export async function receivedBy(db: Db, viewer: Viewer): Promise<ReceivedRating[]> {
  const rows = await db.$queryRawUnsafe<
    {
      id: string;
      stars: number;
      comment: string | null;
      rater_name: string | null;
      created_at: Date;
      reported_at: Date | null;
      hidden_at: Date | null;
      rater_live: boolean;
    }[]
  >(
    `SELECT r.id, r.stars, r.comment, ${RATER_NAME_SQL} AS rater_name, r.created_at,
            r.reported_at, r.hidden_at, ${RATER_LIVE_SQL} AS rater_live
       FROM public.deal_rating r
      WHERE ${RATEE_WHERE}
      ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
    viewer.org === null ? viewer.person : null,
    viewer.org,
  );
  return rows.map((r) => ({
    id: r.id,
    stars: r.stars,
    comment: r.comment,
    rater_name: r.rater_name,
    created_at: r.created_at.toISOString(),
    reported: r.reported_at !== null,
    // A moderator hid it, or its writer's account is suspended: not shown anywhere public.
    hidden: r.hidden_at !== null || !r.rater_live,
  }));
}

/** The viewer as a rated party. */
export const rateeOf = (viewer: Viewer): Ratee =>
  viewer.org === null
    ? { authUserId: viewer.person, organizationId: null }
    : { authUserId: null, organizationId: viewer.org };

// ---------------------------------------------------------------------------
// THE MODERATORS' QUEUE (content.moderate)
// ---------------------------------------------------------------------------

/**
 * One rating for a moderator: the words, the report, and both parties as
 * short names ("Mary K.", an organisation's name). Never an id of a party.
 */
export const MODERATION_RATING_SELECT = `SELECT r.id, r.stars, r.comment, r.deal_kind, r.created_at,
    r.report_reason::text AS report_reason, r.report_note, r.reported_at,
    r.hidden_at, r.hidden_reason,
    COALESCE(${RATER_NAME_SQL},
      CASE WHEN r.rater_organization_id IS NULL THEN ${PERSON_NAME_SQL('r.rater_auth_user_id')} END)
      AS rater_name,
    CASE WHEN r.ratee_organization_id IS NOT NULL
      THEN (SELECT o.name FROM public.organization o WHERE o.id = r.ratee_organization_id)
      ELSE ${PERSON_NAME_SQL('r.ratee_auth_user_id')} END AS ratee_name
  FROM public.deal_rating r`;

export const presentModerationRating = (row: {
  id: string;
  stars: number;
  comment: string | null;
  deal_kind: DealKind;
  created_at: Date;
  report_reason: string | null;
  report_note: string | null;
  reported_at: Date | null;
  hidden_at: Date | null;
  hidden_reason: string | null;
  rater_name: string | null;
  ratee_name: string | null;
}): ModerationRating => ({
  id: row.id,
  stars: row.stars,
  comment: row.comment,
  rater_name: row.rater_name,
  ratee_name: row.ratee_name,
  deal_kind: row.deal_kind,
  created_at: row.created_at.toISOString(),
  report_reason: row.report_reason as ModerationRating['report_reason'],
  report_note: row.report_note,
  reported_at: row.reported_at ? row.reported_at.toISOString() : null,
  hidden_at: row.hidden_at ? row.hidden_at.toISOString() : null,
  hidden_reason: row.hidden_reason,
});

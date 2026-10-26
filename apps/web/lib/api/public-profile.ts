import {
  ADVICE_TOPICS,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_LIMITS,
  type Activity,
  type AdviceTopic,
  type PublicExpertise,
  type PublicProfileOwn,
  type PublicProfileStatus,
} from '@agri-erp/shared';

import { settingValue } from './settings';
import { type AuditTx } from './audit';
import {
  MARKET_BASE_WHERE,
  MARKET_COLUMNS,
  MARKET_FROM,
  presentMarketListing,
  type MarketRow,
} from './buyer-presenters';
import {
  BUYING_REQUEST_COLUMNS,
  BUYING_REQUEST_FROM,
  BUYING_REQUEST_MARKET_WHERE,
  SERVICE_COLUMNS,
  SERVICE_FROM,
  SERVICE_MARKET_WHERE,
  presentBuyingRequest,
  presentService,
  type BuyingRequestRow,
  type ServiceRow,
} from './market-posts';
import { myName } from './messaging';
import { issueReadLink } from '../supabase/admin';

/**
 * PUBLIC PROFILES, VERSION 2 (2026-10-23). docs/DECISIONS.md, "Public
 * profiles v2: drafts, publishing, photo".
 *
 * One profile per sign-in, in account_profile. A DRAFT until its owner
 * publishes it -- no staff approval -- and public only while it is published
 * AND its account is live: some farmer or buyer record of the sign-in is not
 * removed and not suspended, and none is suspended. Removing (deleting) the
 * account takes every record out of the *_active views, so its profile goes
 * with it.
 *
 * THE PRIVACY LINE. The public address is `public_id`. A public read never
 * carries a sign-in id, a farmer or buyer id, a legal name or a storage path;
 * the photo is a read link that expires; the phone only when the owner chose
 * to show it AND the caller is signed in (the contact routes' line).
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export { PROFILE_ACCOUNT_LIVE, PUBLIC_PROFILE_WHERE } from './public-profile-sql';

// ---------------------------------------------------------------------------
// THE ROW
// ---------------------------------------------------------------------------

export interface ProfileRow {
  public_id: string;
  profile_kind: string;
  group_kind: string | null;
  activities: Activity[];
  display_name: string | null;
  about: string | null;
  state_id: string | null;
  state_name: string | null;
  payam_id: string | null;
  payam_name: string | null;
  products: string[];
  services: string[];
  photo_path: string | null;
  show_phone: boolean;
  allow_messages: boolean;
  enterprise_size: string | null;
  show_enterprise_size: boolean;
  status: PublicProfileStatus;
  published_at: Date | null;
  updated_at: Date;
}

/** The columns of a profile. Never auth_user_id: a caller that needs it selects it itself. */
export const PROFILE_COLUMNS = `ap.public_id, ap.profile_kind, ap.group_kind, ap.activities,
  ap.display_name, ap.about, ap.state_id, s.name AS state_name, ap.payam_id,
  pm.name AS payam_name, ap.products, ap.services, ap.photo_path, ap.show_phone,
  ap.allow_messages, ap.enterprise_size, ap.show_enterprise_size, ap.status, ap.published_at,
  ap.updated_at`;

export const PROFILE_FROM = `FROM public.account_profile ap
  LEFT JOIN public.state_active s ON s.id = ap.state_id
  LEFT JOIN public.payam_active pm ON pm.id = ap.payam_id`;

/** The caller's own profile, or undefined before the first save. */
export async function loadOwnProfile(
  db: Db,
  authUserId: string,
  lock = false,
): Promise<ProfileRow | undefined> {
  if (lock) {
    await db.$queryRawUnsafe(
      'SELECT auth_user_id FROM public.account_profile WHERE auth_user_id = $1::uuid FOR UPDATE',
      authUserId,
    );
  }
  const [row] = await db.$queryRawUnsafe<ProfileRow[]>(
    `SELECT ${PROFILE_COLUMNS} ${PROFILE_FROM} WHERE ap.auth_user_id = $1::uuid`,
    authUserId,
  );
  return row;
}

// ---------------------------------------------------------------------------
// THE ACCOUNT BEHIND A PROFILE
// ---------------------------------------------------------------------------

export interface ProfileAccount {
  farmer_id: string | null;
  buyer_id: string | null;
  verified: boolean;
  member_since: Date | null;
  phone: string | null;
}

/**
 * The live records of a sign-in, its badge and when it joined. The ids stay
 * on the server: they find the posts, and are never presented.
 */
export async function accountOfSignIn(db: Db, authUserId: string): Promise<ProfileAccount> {
  const [row] = await db.$queryRawUnsafe<ProfileAccount[]>(
    `WITH f AS (
       SELECT fa.* FROM public.farmer_active fa
        WHERE fa.auth_user_id = $1::uuid AND fa.suspended_at IS NULL LIMIT 1
     ),
     b AS (
       SELECT ba.* FROM public.buyer_active ba
        WHERE ba.auth_user_id = $1::uuid AND ba.suspended_at IS NULL LIMIT 1
     )
     SELECT (SELECT id FROM f) AS farmer_id,
            (SELECT id FROM b) AS buyer_id,
            -- 2026-10-31: only an organisation is verified -- the buyer's
            -- organisation when it is a verified business; never a person.
            COALESCE((SELECT o.account_type::text <> 'individual'
                             AND o.verification_status::text = 'verified'
                        FROM b JOIN public.buyer_organization_active o ON o.id = b.organization_id),
                     false) AS verified,
            LEAST((SELECT created_at FROM f), (SELECT created_at FROM b)) AS member_since,
            COALESCE((SELECT phone FROM f), (SELECT phone FROM b)) AS phone`,
    authUserId,
  );
  return (
    row ?? { farmer_id: null, buyer_id: null, verified: false, member_since: null, phone: null }
  );
}

// ---------------------------------------------------------------------------
// WHAT THE ACCOUNT HAS ON THE MARKET NOW -- each post through its own presenter
// ---------------------------------------------------------------------------

export async function postsOf(db: Db, farmerId: string | null, buyerId: string | null) {
  const listings = farmerId
    ? await db.$queryRawUnsafe<MarketRow[]>(
        `SELECT ${MARKET_COLUMNS} ${MARKET_FROM}
          WHERE pl.farmer_id = $1::uuid AND ${MARKET_BASE_WHERE}
          ORDER BY pl.updated_at DESC LIMIT 50`,
        farmerId,
      )
    : [];
  const requests =
    farmerId || buyerId
      ? await db.$queryRawUnsafe<BuyingRequestRow[]>(
          `SELECT ${BUYING_REQUEST_COLUMNS} ${BUYING_REQUEST_FROM}
            WHERE (br.farmer_id = $1::uuid OR br.buyer_id = $2::uuid)
              AND ${BUYING_REQUEST_MARKET_WHERE}
            ORDER BY br.updated_at DESC LIMIT 50`,
          farmerId,
          buyerId,
        )
      : [];
  // 2026-10-26: a buyer account may offer services too.
  const services =
    farmerId || buyerId
      ? await db.$queryRawUnsafe<ServiceRow[]>(
          `SELECT ${SERVICE_COLUMNS} ${SERVICE_FROM}
            WHERE (sl.farmer_id = $1::uuid OR sl.buyer_id = $2::uuid)
              AND ${SERVICE_MARKET_WHERE}
            ORDER BY sl.updated_at DESC LIMIT 50`,
          farmerId,
          buyerId,
        )
      : [];
  return {
    listings: listings.map(presentMarketListing),
    buying_requests: requests.map(presentBuyingRequest),
    services: services.map(presentService),
  };
}

// ---------------------------------------------------------------------------
// EXPERTISE -- from the advice provider profile (2026-10-28, infographic no. 5)
// ---------------------------------------------------------------------------

/**
 * What a public profile shows of the account's advice work: the topics of its
 * PUBLISHED advice provider profile (the provider chose to show them in the
 * advice directory already), and whether it holds the "Approved adviser"
 * authorization (approved_at, set by an approval and cleared by a revocation,
 * never by suspension). A whitelist: nothing else of the provider profile or
 * of any application -- no qualifications, fees, cases or reviewer's reason.
 * Topics are filtered to the known list. Public visibility is not endorsement.
 */
export async function expertiseOf(db: Db, authUserId: string | null): Promise<PublicExpertise> {
  if (!authUserId) return { topics: [], approved_adviser: false };
  const [row] = await db.$queryRawUnsafe<
    { topics: string[]; published: boolean; approved: boolean }[]
  >(
    `SELECT p.topics, (p.status = 'published') AS published,
            (p.approved_at IS NOT NULL) AS approved
       FROM public.advice_provider p
      WHERE p.auth_user_id = $1::uuid AND p.deleted_at IS NULL`,
    authUserId,
  );
  if (!row) return { topics: [], approved_adviser: false };
  const known = new Set<string>(ADVICE_TOPICS);
  return {
    topics: row.published ? (row.topics.filter((x) => known.has(x)) as AdviceTopic[]) : [],
    approved_adviser: row.approved,
  };
}

// ---------------------------------------------------------------------------
// THE PHOTO -- a read link that expires, never the path
// ---------------------------------------------------------------------------

/** A short-lived link to a stored photo, or null when there is none or it cannot be issued. */
export async function photoLink(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const link = await issueReadLink(
      PROFILE_PHOTO_BUCKET,
      path,
      PROFILE_PHOTO_LIMITS.readLinkSeconds,
    );
    return link.url;
  } catch {
    // A missing object or bucket shows the initials instead; never the provider's error.
    return null;
  }
}

// ---------------------------------------------------------------------------
// THE OWNER'S OWN VIEW
// ---------------------------------------------------------------------------

/** The fields a save compares, to audit the NAMES of those that changed. */
export const SAVED_FIELDS = [
  'display_name',
  'activities',
  'state_id',
  'payam_id',
  'about',
  'products',
  'services',
  'show_phone',
  'allow_messages',
] as const;

export const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : (a ?? null) === (b ?? null);

export async function presentOwnProfile(
  db: Db,
  authUserId: string,
  row: ProfileRow | undefined,
): Promise<PublicProfileOwn> {
  const account = await accountOfSignIn(db, authUserId);
  // A staff-registered farmer may have no name to suggest: then none.
  const suggested = await myName(db, authUserId).catch(() => '');
  // 2026-10-27 (settings phase 2): a profile not yet created starts from
  // Profile privacy's defaults; a saved profile keeps its own choices.
  const defaults = row ? null : await settingValue('profile_privacy');
  return {
    public_id: row?.public_id ?? null,
    status: row?.status ?? 'draft',
    published_at: row?.published_at ? row.published_at.toISOString() : null,
    display_name: row?.display_name ?? null,
    suggested_name: suggested,
    activities: row?.activities ?? [],
    state_id: row?.state_id ?? null,
    state_name: row?.state_name ?? null,
    payam_id: row?.payam_id ?? null,
    payam_name: row?.payam_name ?? null,
    about: row?.about ?? null,
    products: row?.products ?? [],
    services: row?.services ?? [],
    show_phone: row ? row.show_phone : (defaults?.show_phone_default ?? false),
    allow_messages: row ? row.allow_messages : (defaults?.allow_messages_default ?? true),
    photo_url: await photoLink(row?.photo_path ?? null),
    verified: account.verified,
    member_since: account.member_since ? account.member_since.toISOString().slice(0, 7) : null,
    updated_at: row ? row.updated_at.toISOString() : null,
  };
}

/** The audit actor for a farmer or buyer caller. */
export const profileActor = (auth: { principal: { kind: string; id: string } }) => ({
  actorType: (auth.principal.kind === 'buyer' ? 'buyer' : 'farmer') as 'farmer' | 'buyer',
  actorId: auth.principal.id,
});

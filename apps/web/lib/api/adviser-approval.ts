import {
  type AdviserApplicationOwn,
  type AdviserApplicationStaff,
  type AdviserApplicationStatus,
  type AdviserCheck,
  effectiveAdviserStatus,
} from '@agri-erp/shared';

import { type AuditTx } from './audit';

/**
 * THE APPROVED-ADVISER PATHWAY (2026-10-24), independent advice part 2.
 * docs/DECISIONS.md, "Approved advisers: optional, reviewed, revocable".
 *
 * WHO SEES WHAT. An application leaves the API in two shapes only:
 * presentOwnApplication (its applicant: their own text, CORWADO's question
 * and the recorded reason) and presentStaffApplication (the staff queue: the
 * same, plus the provider's public profile and the account's side and
 * standing -- never a phone, never a sign-in id). The public sees neither:
 * only `approved_adviser` and the month on the provider (lib/api/advice.ts).
 *
 * INDEPENDENT OF ACCOUNT STANDING. Nothing here reads or writes a farmer's
 * or a buyer's suspension, and the suspension routes never touch the
 * provider's approval. So restoring an account cannot restore a revoked
 * approval, which the specification requires.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export const APPLICATION_COLUMNS = `a.id, a.provider_id, a.auth_user_id, a.specialties,
  a.service_area, a.languages, a.experience, a.qualifications, a.affiliation, a.status,
  a.clarification_request, a.applicant_reply, a.decision_reason, a.decided_at, a.decided_by,
  a.created_at, a.updated_at, a.suspended_until, a.suspension_reason, a.verified_checks`;

/**
 * 2026-10-28: true when provider `p`'s standing approval is SUSPENDED RIGHT
 * NOW. Every reader of the badge asks this as well as approved_at: a
 * suspension pauses the approval without clearing it, and lapses by itself at
 * suspended_until. Account suspension never touches it, as before.
 */
export const APPROVAL_SUSPENDED_SQL = `EXISTS (
  SELECT 1 FROM public.adviser_application sa
   WHERE sa.id = p.approved_application_id AND sa.status = 'suspended'
     AND sa.suspended_until > now())`;

/** The approval of provider `p` stands and is not suspended. */
export const APPROVAL_ACTIVE_SQL = `(p.approved_at IS NOT NULL AND NOT ${APPROVAL_SUSPENDED_SQL})`;

export interface ApplicationRow {
  id: string;
  provider_id: string;
  auth_user_id: string;
  specialties: AdviserApplicationOwn['specialties'];
  service_area: string[];
  languages: AdviserApplicationOwn['languages'];
  experience: string;
  qualifications: string | null;
  affiliation: string | null;
  status: AdviserApplicationStatus;
  clarification_request: string | null;
  applicant_reply: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  decided_by: string | null;
  created_at: Date;
  updated_at: Date;
  suspended_until: Date | null;
  suspension_reason: string | null;
  verified_checks: AdviserCheck[];
}

/** An application as its own applicant sees it. No sign-in id, no staff id. */
export const presentOwnApplication = (row: ApplicationRow): AdviserApplicationOwn => ({
  id: row.id,
  specialties: row.specialties,
  service_area: row.service_area,
  languages: row.languages,
  experience: row.experience,
  qualifications: row.qualifications,
  affiliation: row.affiliation,
  // 2026-10-28: a suspension past its end reads as approved (it lapsed).
  status: effectiveAdviserStatus(row.status, row.suspended_until, Date.now()),
  clarification_request: row.clarification_request,
  applicant_reply: row.applicant_reply,
  decision_reason: row.decision_reason,
  decided_at: row.decided_at ? row.decided_at.toISOString() : null,
  suspended_until:
    effectiveAdviserStatus(row.status, row.suspended_until, Date.now()) === 'suspended' &&
    row.suspended_until
      ? row.suspended_until.toISOString()
      : null,
  suspension_reason: row.suspension_reason,
  verified_checks: row.verified_checks ?? [],
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

/** Every application of one provider, newest first. */
export async function applicationsOf(
  db: Db,
  providerId: string,
  lock = false,
): Promise<ApplicationRow[]> {
  return db.$queryRawUnsafe<ApplicationRow[]>(
    `SELECT ${APPLICATION_COLUMNS} FROM public.adviser_application a
      WHERE a.provider_id = $1::uuid AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC, a.id DESC
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    providerId,
  );
}

/** The provider's open application (with CORWADO), locked, or null. */
export async function openApplicationOf(
  db: Db,
  providerId: string,
): Promise<ApplicationRow | null> {
  const [row] = await db.$queryRawUnsafe<ApplicationRow[]>(
    `SELECT ${APPLICATION_COLUMNS} FROM public.adviser_application a
      WHERE a.provider_id = $1::uuid AND a.deleted_at IS NULL
        AND a.status IN ('submitted', 'clarification_requested')
      FOR UPDATE OF a`,
    providerId,
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// STAFF
// ---------------------------------------------------------------------------

export interface StaffApplicationRow extends ApplicationRow {
  provider_name: string;
  provider_kind: string;
  provider_status: string;
  provider_description: string;
  provider_commercial: string | null;
  provider_approved_at: Date | null;
  has_farmer: boolean;
  has_buyer: boolean;
  suspended: boolean;
  decided_by_name: string | null;
}

/**
 * An application with its provider and the account's side and standing. The
 * account is read through the _active views; its phone and names are never
 * selected.
 */
export const STAFF_APPLICATION_SELECT = `SELECT ${APPLICATION_COLUMNS},
    p.display_name AS provider_name, p.provider_kind, p.status AS provider_status,
    p.description AS provider_description, p.commercial_interests AS provider_commercial,
    p.approved_at AS provider_approved_at,
    EXISTS (SELECT 1 FROM public.farmer_active fa WHERE fa.auth_user_id = a.auth_user_id) AS has_farmer,
    EXISTS (SELECT 1 FROM public.buyer_active ba WHERE ba.auth_user_id = a.auth_user_id) AS has_buyer,
    (EXISTS (SELECT 1 FROM public.farmer_active fa
              WHERE fa.auth_user_id = a.auth_user_id AND fa.suspended_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.buyer_active ba
                 WHERE ba.auth_user_id = a.auth_user_id AND ba.suspended_at IS NOT NULL)) AS suspended,
    u.name AS decided_by_name
  FROM public.adviser_application a
  JOIN public.advice_provider p ON p.id = a.provider_id AND p.deleted_at IS NULL
  LEFT JOIN public."user" u ON u.id = a.decided_by`;

export const presentStaffApplication = (row: StaffApplicationRow): AdviserApplicationStaff => ({
  ...presentOwnApplication(row),
  provider: {
    id: row.provider_id,
    display_name: row.provider_name,
    provider_kind: row.provider_kind,
    status: row.provider_status,
    description: row.provider_description,
    commercial_interests: row.provider_commercial,
    approved_at: row.provider_approved_at ? row.provider_approved_at.toISOString() : null,
  },
  account: { farmer: row.has_farmer, buyer: row.has_buyer, suspended: row.suspended },
  decided_by_name: row.decided_by_name,
});

// ---------------------------------------------------------------------------
// ADVISORY STANDING ON THE ADMIN ACCOUNT RECORD (2026-10-28)
// ---------------------------------------------------------------------------

/** Where an account stands as an adviser, beside its account standing. */
export interface AdvisoryStanding {
  /** none: no advice profile; profile: a profile, never applied; else the latest application's effective status. */
  status: 'none' | 'profile' | AdviserApplicationStatus;
  application_id: string | null;
  suspended_until: string | null;
  decided_at: string | null;
}

/**
 * The account's PERSONAL advice profile and its latest application, read by
 * the account's sign-in. Separate from account suspension by construction:
 * nothing here reads suspended_at.
 */
export async function advisoryStandingOf(
  db: Db,
  authUserId: string | null,
): Promise<AdvisoryStanding> {
  const none: AdvisoryStanding = {
    status: 'none',
    application_id: null,
    suspended_until: null,
    decided_at: null,
  };
  if (!authUserId) return none;
  const [row] = await db.$queryRawUnsafe<
    {
      provider_id: string;
      id: string | null;
      status: AdviserApplicationStatus | null;
      suspended_until: Date | null;
      decided_at: Date | null;
    }[]
  >(
    `SELECT p.id AS provider_id, a.id, a.status, a.suspended_until, a.decided_at
       FROM public.advice_provider p
       LEFT JOIN LATERAL (
         SELECT x.id, x.status, x.suspended_until, x.decided_at
           FROM public.adviser_application x
          WHERE x.provider_id = p.id AND x.deleted_at IS NULL
          ORDER BY x.created_at DESC, x.id DESC LIMIT 1) a ON true
      WHERE p.auth_user_id = $1::uuid AND p.deleted_at IS NULL
        AND p.organization_id IS NULL
      LIMIT 1`,
    authUserId,
  );
  if (!row) return none;
  if (!row.id || !row.status) return { ...none, status: 'profile' };
  const status = effectiveAdviserStatus(row.status, row.suspended_until, Date.now());
  return {
    status,
    application_id: row.id,
    suspended_until:
      status === 'suspended' && row.suspended_until ? row.suspended_until.toISOString() : null,
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
  };
}

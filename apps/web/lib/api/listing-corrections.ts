import {
  LISTING_CORRECTION_MESSAGES,
  SETTING_DEFAULTS,
  correctionStatusAfterEdit,
  toIso,
  type CorrectionStatus,
  type CorrectionTarget,
  type ListingCorrection,
  type ReasonCodesSetting,
} from '@agri-erp/shared';

import { writeAudit, type AuditEntry, type AuditTx } from './audit';
import { invalidField } from './market-posts';
import { notFound } from './errors';
import { currentSetting, settingsTablesPresent } from './settings';

/**
 * A MODERATOR ASKS FOR A CORRECTION (2026-10-27). docs/DECISIONS.md, "A
 * moderator requests a correction; the post stays live".
 *
 * One `listing_correction` row per request, about one produce listing,
 * service listing or buying request. The OWNER is told by a fixed in-app
 * notice (lib/farmer-notices.ts `listing_correction_requested`) -- the note is
 * shown on their own posts (GET /api/account/corrections), never in a notice
 * that a shared phone's screen might show. The post is NOT changed: removing
 * it is a separate decision.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

/** The id column a target type is kept in. */
export const TARGET_COLUMN: Record<CorrectionTarget, string> = {
  produce_listing: 'produce_listing_id',
  service_listing: 'service_listing_id',
  buying_request: 'buying_request_id',
};

/** The post a correction is about, and the account that owns it. */
export interface CorrectionTargetRow {
  title: string;
  owner_auth_user_id: string | null;
  owner_farmer_id: string | null;
}

/** The live post, or 404. A soft-deleted post cannot be asked to change. */
export async function loadCorrectionTarget(
  db: Db,
  type: CorrectionTarget,
  id: string,
): Promise<CorrectionTargetRow> {
  const sql: Record<CorrectionTarget, string> = {
    produce_listing: `SELECT pl.title, f.auth_user_id AS owner_auth_user_id, pl.farmer_id AS owner_farmer_id
        FROM public.produce_listing_active pl
        JOIN public.farmer f ON f.id = pl.farmer_id
       WHERE pl.id = $1::uuid`,
    service_listing: `SELECT sl.title,
             COALESCE(f.auth_user_id, b.auth_user_id) AS owner_auth_user_id,
             sl.farmer_id AS owner_farmer_id
        FROM public.service_listing_active sl
        LEFT JOIN public.farmer f ON f.id = sl.farmer_id
        LEFT JOIN public.buyer b ON b.id = sl.buyer_id
       WHERE sl.id = $1::uuid`,
    buying_request: `SELECT br.product_name AS title,
             COALESCE(f.auth_user_id, b.auth_user_id) AS owner_auth_user_id,
             br.farmer_id AS owner_farmer_id
        FROM public.buying_request_active br
        LEFT JOIN public.farmer f ON f.id = br.farmer_id
        LEFT JOIN public.buyer b ON b.id = br.buyer_id
       WHERE br.id = $1::uuid`,
  };
  const [row] = await db.$queryRawUnsafe<CorrectionTargetRow[]>(sql[type], id);
  if (!row) throw notFound();
  return row;
}

/** CORWADO's reason codes as kept in Settings, or the seeded defaults before any save. */
export async function reasonCodesSetting(db: Db): Promise<ReasonCodesSetting> {
  return (await settingsTablesPresent(db))
    ? (await currentSetting('reason_codes', db)).value
    : SETTING_DEFAULTS.reason_codes;
}

/** A request must name an ACTIVE code offered for listings. */
export function checkListingReasonCode(setting: ReasonCodesSetting, code: string): void {
  const entry = setting.codes.find((c) => c.code === code);
  if (!entry || !entry.active || !entry.applies_to.includes('listing')) {
    throw invalidField('reason_code', LISTING_CORRECTION_MESSAGES.reasonCodeNotOffered);
  }
}

/** A code's label, archived codes included; the code itself if it is no longer listed. */
export const labelOf = (setting: ReasonCodesSetting, code: string): string =>
  setting.codes.find((c) => c.code === code)?.label ?? code;

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export interface CorrectionRow {
  id: string;
  target_type: CorrectionTarget;
  target_id: string;
  target_title: string | null;
  reason_code: string;
  note: string;
  status: CorrectionStatus;
  requested_at: Date;
  addressed_at: Date | null;
}

/** Every column a list needs, with the post's current title (null once it is removed). */
export const CORRECTION_SELECT = `SELECT c.id, c.target_type,
       COALESCE(c.produce_listing_id, c.service_listing_id, c.buying_request_id) AS target_id,
       COALESCE(pl.title, sl.title, br.product_name) AS target_title,
       c.reason_code, c.note, c.status, c.requested_at, c.addressed_at
  FROM public.listing_correction_active c
  LEFT JOIN public.produce_listing_active pl ON pl.id = c.produce_listing_id
  LEFT JOIN public.service_listing_active sl ON sl.id = c.service_listing_id
  LEFT JOIN public.buying_request_active br ON br.id = c.buying_request_id`;

export const presentCorrection = (
  row: CorrectionRow,
  setting: ReasonCodesSetting,
): ListingCorrection => ({
  id: row.id,
  target_type: row.target_type,
  target_id: row.target_id,
  ...(row.target_title === null ? {} : { target_title: row.target_title }),
  reason_code: row.reason_code,
  reason_label: labelOf(setting, row.reason_code),
  note: row.note,
  status: row.status,
  requested_at: toIso(row.requested_at),
  addressed_at: row.addressed_at ? toIso(row.addressed_at) : null,
});

// ---------------------------------------------------------------------------
// THE OWNER EDITS THE POST
// ---------------------------------------------------------------------------

/**
 * Called inside the owner's audited save of a post, after the update. If the
 * post has an OPEN correction and the save changed its content (not only a
 * lifecycle move or a renewal -- correctionStatusAfterEdit), the request is
 * marked addressed and audited, so the moderator sees it. Returns whether one
 * was addressed. Never throws for a post with no correction.
 */
export async function addressCorrections(
  tx: AuditTx,
  type: CorrectionTarget,
  targetId: string,
  changedKeys: readonly string[],
  actor: Pick<AuditEntry, 'actorType' | 'actorId'>,
): Promise<boolean> {
  if (correctionStatusAfterEdit('open', changedKeys) !== 'addressed') return false;
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE public.listing_correction
        SET status = 'addressed', addressed_at = now(), updated_at = now()
      WHERE ${TARGET_COLUMN[type]} = $1::uuid AND status = 'open' AND deleted_at IS NULL
      RETURNING id`,
    targetId,
  );
  for (const row of rows) {
    await writeAudit(tx, {
      entityType: 'listing_correction',
      entityId: row.id,
      ...actor,
      action: 'listing.correction_addressed',
      before: { status: 'open' },
      // The NAMES of the fields the owner changed, never their values.
      after: { status: 'addressed', target_type: type, target_id: targetId, changed: changedKeys },
    });
  }
  return rows.length > 0;
}

/** The keys a save actually sent, without the undefined ones. */
export const sentKeys = (body: Record<string, unknown>): string[] =>
  Object.entries(body)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);

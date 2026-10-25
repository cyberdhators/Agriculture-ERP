import type {
  AdviceLanguage,
  AdviceTopic,
  AdvisoryNoteOwn,
  AdvisoryNotePublic,
  AdvisoryNoteStaff,
  AdvisoryNoteStatus,
} from '@agri-erp/shared';

import { APPROVAL_ACTIVE_SQL } from './adviser-approval';
import { type AuditTx } from './audit';

/**
 * OFFICIAL ADVISORY NOTES (2026-10-28, lane-security). The approved-adviser
 * channel: docs/DECISIONS.md, "Approved advisers: suspend, restore, what was
 * checked, and official notes".
 *
 * WHO SEES WHAT. A note leaves in three shapes: its author's (presentOwnNote),
 * the staff queue's (presentStaffNote: the provider's public name, never a
 * sign-in id) and the public's (presentPublicNote: published, title, topics,
 * language, text and date -- nothing about the review). The public reads only
 * published notes of a provider whose approval stands, is not suspended and
 * whose profile is public.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

export const NOTE_COLUMNS = `n.id, n.provider_id, n.application_id, n.title, n.topics, n.language,
  n.body, n.status, n.review_note, n.published_at, n.created_at, n.updated_at`;

export interface NoteRow {
  id: string;
  provider_id: string;
  application_id: string;
  title: string;
  topics: AdviceTopic[];
  language: AdviceLanguage;
  body: string;
  status: AdvisoryNoteStatus;
  review_note: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const presentOwnNote = (row: NoteRow): AdvisoryNoteOwn => ({
  id: row.id,
  title: row.title,
  topics: row.topics,
  language: row.language,
  body: row.body,
  status: row.status,
  review_note: row.review_note,
  published_at: row.published_at ? row.published_at.toISOString() : null,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

export interface StaffNoteRow extends NoteRow {
  provider_name: string;
  approval_active: boolean;
  reviewed_by_name: string | null;
}

export const STAFF_NOTE_SELECT = `SELECT ${NOTE_COLUMNS},
    p.display_name AS provider_name, ${APPROVAL_ACTIVE_SQL} AS approval_active,
    u.name AS reviewed_by_name
  FROM public.advisory_note n
  JOIN public.advice_provider p ON p.id = n.provider_id AND p.deleted_at IS NULL
  LEFT JOIN public."user" u ON u.id = n.reviewed_by`;

export const presentStaffNote = (row: StaffNoteRow): AdvisoryNoteStaff => ({
  ...presentOwnNote(row),
  provider: {
    id: row.provider_id,
    display_name: row.provider_name,
    approval_active: row.approval_active,
  },
  reviewed_by_name: row.reviewed_by_name,
});

export const presentPublicNote = (row: NoteRow): AdvisoryNotePublic => ({
  id: row.id,
  title: row.title,
  topics: row.topics,
  language: row.language,
  body: row.body,
  published_at: (row.published_at ?? row.updated_at).toISOString(),
});

/**
 * The provider's STANDING, NOT SUSPENDED approval: the application id it rests
 * on, or null. Read from the provider row `p` locked by the caller.
 */
export async function activeApprovalOf(db: Db, providerId: string): Promise<string | null> {
  const [row] = await db.$queryRawUnsafe<{ application_id: string | null; active: boolean }[]>(
    `SELECT p.approved_application_id AS application_id, ${APPROVAL_ACTIVE_SQL} AS active
       FROM public.advice_provider p
      WHERE p.id = $1::uuid AND p.deleted_at IS NULL`,
    providerId,
  );
  return row?.active && row.application_id ? row.application_id : null;
}

/** One of the caller's own notes, locked, or null. */
export async function ownNote(db: Db, providerId: string, id: string): Promise<NoteRow | null> {
  const [row] = await db.$queryRawUnsafe<NoteRow[]>(
    `SELECT ${NOTE_COLUMNS} FROM public.advisory_note n
      WHERE n.id = $1::uuid AND n.provider_id = $2::uuid AND n.deleted_at IS NULL
      FOR UPDATE OF n`,
    id,
    providerId,
  );
  return row ?? null;
}

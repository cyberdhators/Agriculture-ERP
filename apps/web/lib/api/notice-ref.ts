import { NOTICE_REF_KINDS, type NoticeRefKind } from '@agri-erp/shared';

import type { AuditTx } from './audit';

/**
 * WHAT A STORED NOTICE POINTS AT (2026-11-01, live test). docs/DECISIONS.md,
 * "A stored notice opens the exact post or conversation".
 *
 * Migration 20261101100000_notification_ref gives public.notification two
 * nullable columns, ref_kind and ref_id. Until it is applied, a notice must
 * still be written and the lists must still load: asked once in a form that
 * cannot fail, and remembered only once the columns are there (a deployment
 * that runs ahead of the migration starts storing refs as soon as it lands).
 */

type Db = Pick<AuditTx, '$queryRawUnsafe'>;

let stored = false;

export async function noticeRefStored(db: Db): Promise<boolean> {
  if (stored) return true;
  const [row] = await db.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notification'
         AND column_name = 'ref_id') AS present`,
  );
  stored = row?.present === true;
  return stored;
}

/** The two columns for a SELECT; NULLs while the migration is not applied. */
export function noticeRefColumns(present: boolean, alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return present
    ? `${p}ref_kind, ${p}ref_id::text AS ref_id`
    : 'NULL::text AS ref_kind, NULL::text AS ref_id';
}

export interface NoticeRefRow {
  ref_kind: string | null;
  ref_id: string | null;
}

/** As every notifications API answers it: a known kind and its id, or both null. */
export function presentNoticeRef(row: NoticeRefRow): {
  ref_kind: NoticeRefKind | null;
  ref_id: string | null;
} {
  const kind = (NOTICE_REF_KINDS as readonly string[]).includes(row.ref_kind ?? '')
    ? (row.ref_kind as NoticeRefKind)
    : null;
  return kind && row.ref_id ? { ref_kind: kind, ref_id: row.ref_id } : { ref_kind: null, ref_id: null };
}

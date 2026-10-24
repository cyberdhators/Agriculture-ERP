import { ACCOUNT_NOTICES, type AccountNotice } from '../farmer-notices';
import { writeAudit, type AuditTx } from './audit';

/**
 * ONE IN-APP NOTICE TO ONE ACCOUNT (2026-10-26, CORWADO's acceptance test of
 * 24 October). docs/DECISIONS.md, "Notices for decisions, restores, new
 * conversations and advice updates".
 *
 * The recipient is an ACCOUNT, named by its sign-in id (or, for a farmer an
 * officer registered with no sign-in, by the farmer record). The notice goes
 * where that account reads notices, exactly as lib/api/buyers.ts writes them:
 * to its farmer record if it has one, otherwise to its buyer's organisation.
 * An account with neither (removed since) is sent nothing, and that is not an
 * error -- a notice is never a reason for the caller's change to fail.
 *
 * THE TEXT IS FIXED (lib/farmer-notices.ts ACCOUNT_NOTICES). This function
 * takes a notice's NAME, never a string, so no message, case text, staff
 * reason or name can reach a notification preview through it. Inside the
 * caller's audited transaction; audited as 'notification.created' with the
 * recipient's kind and the notice's name only.
 */

export type NoticeActor = {
  actorType: 'admin' | 'supervisor' | 'buyer' | 'farmer';
  actorId: string;
};

export type NoticeRecipient = { authUserId: string | null; farmerId?: string | null };

export async function notifyAccount(
  tx: AuditTx,
  recipient: NoticeRecipient,
  notice: AccountNotice,
  actor: NoticeActor,
): Promise<boolean> {
  const { title, body } = ACCOUNT_NOTICES[notice];
  const [target] = await tx.$queryRawUnsafe<
    { farmer_id: string | null; buyer_organization_id: string | null }[]
  >(
    `SELECT
       COALESCE(
         (SELECT f.id FROM public.farmer f
           WHERE f.id = $2::uuid AND f.deleted_at IS NULL),
         (SELECT f.id FROM public.farmer f
           WHERE $1::uuid IS NOT NULL AND f.auth_user_id = $1::uuid AND f.deleted_at IS NULL)
       ) AS farmer_id,
       (SELECT b.organization_id FROM public.buyer b
         WHERE $1::uuid IS NOT NULL AND b.auth_user_id = $1::uuid AND b.deleted_at IS NULL)
         AS buyer_organization_id`,
    recipient.authUserId,
    recipient.farmerId ?? null,
  );
  const farmerId = target?.farmer_id ?? null;
  const organizationId = farmerId ? null : (target?.buyer_organization_id ?? null);
  if (!farmerId && !organizationId) return false;

  const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.notification (farmer_id, buyer_organization_id, channel, title, body)
     VALUES ($1::uuid, $2::uuid, 'in_app', $3, $4) RETURNING id`,
    farmerId,
    organizationId,
    title,
    body,
  );
  await writeAudit(tx, {
    entityType: 'notification',
    entityId: row!.id,
    ...actor,
    action: 'notification.created',
    after: { recipient: farmerId ? 'farmer' : 'buyer_organization', notice },
  });
  return true;
}

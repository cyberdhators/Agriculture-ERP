import { ACCOUNT_NOTICES, type AccountNotice } from '../farmer-notices';
import { writeAudit, type AuditEntry, type AuditTx } from './audit';

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

export type NoticeActor = Pick<AuditEntry, 'actorType' | 'actorId'>;

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

// ---------------------------------------------------------------------------
// NEW CONVERSATIONS -- one notice per side, not one per message
// ---------------------------------------------------------------------------

const MESSAGE_NOTICE: Record<string, AccountNotice> = {
  listing: 'message_listing',
  buying_request: 'message_buying_request',
  service: 'message_service',
  advice_case: 'message_advice_case',
};

/**
 * Called after a message is stored. When it is the SENDER'S FIRST message in
 * the conversation -- the one that starts it, or the other person's first
 * reply -- the person it went to is sent one notice naming only the kind of
 * post. Every later message is left to the unread badge, so a conversation
 * makes at most two notices. The message's text is never read here.
 */
export async function noticeIfFirstMessage(
  tx: AuditTx,
  conversationId: string,
  sender: string,
  actor: NoticeActor,
): Promise<void> {
  const [row] = await tx.$queryRawUnsafe<
    {
      post_kind: string;
      owner_auth_user_id: string;
      starter_auth_user_id: string;
      sent: number;
    }[]
  >(
    `SELECT c.post_kind, c.owner_auth_user_id, c.starter_auth_user_id,
            (SELECT count(*) FROM public.message m
              WHERE m.conversation_id = c.id AND m.sender_auth_user_id = $2::uuid)::int AS sent
       FROM public.conversation c WHERE c.id = $1::uuid`,
    conversationId,
    sender,
  );
  const notice = row ? MESSAGE_NOTICE[row.post_kind] : undefined;
  if (!row || row.sent !== 1 || !notice) return;
  const to = row.owner_auth_user_id === sender ? row.starter_auth_user_id : row.owner_auth_user_id;
  if (to === sender) return;
  await notifyAccount(tx, { authUserId: to }, notice, actor);
}

// ---------------------------------------------------------------------------
// ADVICE CASES -- a change of status, or a referral proposed
// ---------------------------------------------------------------------------

/**
 * Tells the OTHER participant of an advice case that it changed: the
 * requester when the provider acts, the provider when the requester does.
 * Never the question, the outcome's wording or a message.
 */
export async function noticeCaseChanged(
  tx: AuditTx,
  advice: { requester_auth_user_id: string; provider_auth_user_id: string },
  actedAs: 'requester' | 'provider',
  actor: NoticeActor,
): Promise<void> {
  if (actedAs === 'provider') {
    await notifyAccount(
      tx,
      { authUserId: advice.requester_auth_user_id },
      'advice_request_updated',
      actor,
    );
  } else {
    await notifyAccount(
      tx,
      { authUserId: advice.provider_auth_user_id },
      'advice_work_updated',
      actor,
    );
  }
}

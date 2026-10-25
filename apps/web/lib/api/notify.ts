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
 * Called after a message is stored. When it is the SENDER'S SIDE'S FIRST
 * message in the conversation -- the one that starts it, or the other side's
 * first reply -- the other side is sent one notice naming only the kind of
 * post. Every later message is left to the unread badge, so a conversation
 * makes at most two rounds of notices. The message's text is never read here.
 *
 * 2026-10-27 (team access): a side may be an organisation's shared inbox.
 * Then the notice goes to its active members who may read the inbox
 * (administrators, and members holding inbox.read), at most twenty. `side`
 * is the sender's side; without it, it is read from the sign-in, which is
 * exact for every personal conversation.
 */
export async function noticeIfFirstMessage(
  tx: AuditTx,
  conversationId: string,
  sender: string,
  actor: NoticeActor,
  side?: 'owner' | 'starter',
): Promise<void> {
  const [row] = await tx.$queryRawUnsafe<
    {
      post_kind: string;
      owner_auth_user_id: string;
      starter_auth_user_id: string;
      owner_organization_id: string | null;
      starter_organization_id: string | null;
      side: 'owner' | 'starter';
      sent: number;
    }[]
  >(
    `SELECT c.post_kind, c.owner_auth_user_id, c.starter_auth_user_id,
            c.owner_organization_id, c.starter_organization_id, s.side,
            (SELECT count(*) FROM public.message m
              WHERE m.conversation_id = c.id
                AND COALESCE(m.sender_side,
                      CASE WHEN m.sender_auth_user_id = c.owner_auth_user_id
                           THEN 'owner' ELSE 'starter' END) = s.side)::int AS sent
       FROM public.conversation c
       CROSS JOIN LATERAL (SELECT COALESCE($3::text,
              CASE WHEN c.owner_auth_user_id = $2::uuid THEN 'owner' ELSE 'starter' END) AS side) s
      WHERE c.id = $1::uuid`,
    conversationId,
    sender,
    side ?? null,
  );
  const notice = row ? MESSAGE_NOTICE[row.post_kind] : undefined;
  if (!row || row.sent !== 1 || !notice) return;
  const otherOrganization =
    row.side === 'owner' ? row.starter_organization_id : row.owner_organization_id;
  if (otherOrganization) {
    const members = await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
      `SELECT auth_user_id FROM public.organization_member
        WHERE organization_id = $1::uuid AND status = 'active' AND auth_user_id <> $2::uuid
          AND (preset = 'administrator' OR $3 = ANY (permissions))
        ORDER BY joined_at LIMIT 20`,
      otherOrganization,
      sender,
      // 2026-10-28: an advice request reaches the members who handle advice,
      // not everyone who reads the organisation's inbox.
      row.post_kind === 'advice_case' ? 'advisory.handle' : 'inbox.read',
    );
    for (const member of members) {
      await notifyAccount(tx, { authUserId: member.auth_user_id }, notice, actor);
    }
    return;
  }
  const to = row.side === 'owner' ? row.starter_auth_user_id : row.owner_auth_user_id;
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
  advice: {
    requester_auth_user_id: string;
    provider_auth_user_id: string;
    /** 2026-10-28: an organisation's case, and the member handling it. */
    provider_organization_id?: string | null;
    assigned_auth_user_id?: string | null;
  },
  actedAs: 'requester' | 'provider',
  actor: NoticeActor,
): Promise<void> {
  if (actedAs === 'requester' && advice.provider_organization_id) {
    // An organisation's case: the member handling it, or -- while nobody is --
    // the members who handle advice. Never whoever set the profile up.
    const to = advice.assigned_auth_user_id
      ? [{ auth_user_id: advice.assigned_auth_user_id }]
      : await tx.$queryRawUnsafe<{ auth_user_id: string }[]>(
          `SELECT auth_user_id FROM public.organization_member
            WHERE organization_id = $1::uuid AND status = 'active'
              AND (preset = 'administrator' OR 'advisory.handle' = ANY (permissions))
            ORDER BY joined_at LIMIT 20`,
          advice.provider_organization_id,
        );
    for (const member of to) {
      await notifyAccount(tx, { authUserId: member.auth_user_id }, 'advice_work_updated', actor);
    }
    return;
  }
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

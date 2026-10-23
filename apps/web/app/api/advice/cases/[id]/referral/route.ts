import { randomUUID } from 'node:crypto';

import {
  ADVICE_ATTACHMENT_BUCKET,
  BUYER_ROLE,
  FARMER_ROLE,
  adviceAttachmentPath,
  adviceReferralDecideSchema,
  adviceReferralProposeSchema,
  type AdviceAttachmentContentType,
  type AdviceReferralAction,
} from '@agri-erp/shared';

import {
  PROVIDER_ACCOUNT_LIVE,
  REFERRAL_SELECT,
  caseAttachments,
  loadCase,
  presentCase,
  sideOf,
  type CaseRow,
  type ReferralRow,
} from '../../../../../../lib/api/advice';
import { audited, writeAudit, type AuditTx } from '../../../../../../lib/api/audit';
import { conflict, notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { actorOf, insertMessage, me } from '../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { copyStoredObject, removeStoredObject } from '../../../../../../lib/supabase/admin';

/**
 * /api/advice/cases/:id/referral -- referral WITH CONSENT (2026-10-25). The
 * specification: "Share case details and refer to another provider only with
 * appropriate consent." docs/DECISIONS.md, "Advice: photos and referral with
 * consent".
 *
 * POST: the case's PROVIDER proposes another published provider, chosen from
 * the directory, while the case is open or in progress. NOTHING is shared:
 * the other provider is not told, and sees nothing, unless the requester
 * accepts. One proposal waits at a time (`advice_referral_open`).
 *
 * PATCH { action }:
 *   accept    the REQUESTER agrees. In one audited transaction the case
 *             closes as 'referred', and a NEW case opens with the other
 *             provider carrying the topic and the question (its own
 *             conversation, the question as its first message) -- and the
 *             requester's own photos only if they ticked "share my photos
 *             too" (`share_attachments`, off by default), each copied to the
 *             new case's own folder. The new case is in-app only and shares
 *             no contact details: sharing those is a consent given to one
 *             provider, and is not carried to another.
 *   decline   the requester says no. Nothing was shared; the case goes on.
 *   withdraw  the provider who proposed it takes it back.
 * Repeating an answer already given returns the case as it is. Anyone who is
 * not one of the case's two participants gets 404.
 *
 * Audited with ids, statuses and the share choice only -- never the question.
 */

interface Target {
  id: string;
  auth_user_id: string;
  display_name: string;
  open: boolean;
}

async function target(db: Pick<AuditTx, '$queryRawUnsafe'>, providerId: string) {
  const [row] = await db.$queryRawUnsafe<Target[]>(
    `SELECT p.id, p.auth_user_id, p.display_name,
            (p.status = 'published' AND ${PROVIDER_ACCOUNT_LIVE}) AS open
       FROM public.advice_provider p
      WHERE p.id = $1::uuid AND p.deleted_at IS NULL`,
    providerId,
  );
  return row ?? null;
}

/** The provider a case may be referred to: published, live, and neither side of the case. */
function checkTarget(found: Target | null, current: CaseRow): Target {
  if (!found) throw notFound();
  if (
    found.id === current.provider_id ||
    found.auth_user_id === current.requester_auth_user_id ||
    found.auth_user_id === current.provider_auth_user_id
  ) {
    throw unprocessable('advice_referral_provider_invalid');
  }
  if (!found.open) throw unprocessable('advice_provider_not_published');
  return found;
}

async function waiting(db: Pick<AuditTx, '$queryRawUnsafe'>, caseId: string, lock = false) {
  const [row] = await db.$queryRawUnsafe<ReferralRow[]>(
    `${REFERRAL_SELECT}
      WHERE rf.from_case_id = $1::uuid AND rf.status = 'proposed' AND rf.deleted_at IS NULL
      ${lock ? 'FOR UPDATE OF rf' : ''}`,
    caseId,
  );
  return row ?? null;
}

/** The requester's own photos on the case, to copy when they chose to share them. */
interface Copy {
  fromId: string;
  newId: string;
  path: string;
  contentType: AdviceAttachmentContentType;
  byteSize: number;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceReferralProposeSchema,
    handler: async ({ auth, body, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const row = await audited(prisma, async (tx) => {
        const current = await loadCase(tx, id, reader, true);
        if (sideOf(current, reader) !== 'provider') {
          throw unprocessable('advice_case_not_yours_to_change');
        }
        if (current.status === 'closed') throw unprocessable('advice_case_closed');
        const already = await waiting(tx, current.id);
        if (already) {
          if (already.to_provider_id === body.to_provider_id) return current; // sent again
          throw conflict('advice_referral_open');
        }
        const to = checkTarget(await target(tx, body.to_provider_id), current);
        const [made] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.advice_referral (from_case_id, to_provider_id, proposed_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid)
           RETURNING id`,
          current.id,
          to.id,
          reader,
        );
        if (!made) throw notFound();
        await writeAudit(tx, {
          entityType: 'advice_referral',
          entityId: made.id,
          ...actorOf(auth),
          action: 'advice_referral.proposed',
          after: { status: 'proposed', from_case_id: current.id, to_provider_id: to.id },
        });
        return current;
      });
      return ok(await presentCase(prisma, row, reader, true));
    },
  },

  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceReferralDecideSchema,
    handler: async ({ auth, body, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const action: AdviceReferralAction = body.action;
      const before = await loadCase(prisma, id, reader);
      const side = sideOf(before, reader);
      const mustBe = body.action === 'withdraw' ? 'provider' : 'requester';
      if (side !== mustBe) throw unprocessable('advice_case_not_yours_to_change');

      // PHOTOS FIRST, OUTSIDE THE TRANSACTION. Storage is not the database:
      // the requester's photos are copied to the new case's folder before the
      // acceptance is written, so the rows written with it point at objects
      // that exist. If the acceptance then fails, the copies are removed.
      const newCaseId = randomUUID();
      const copies: Copy[] = [];
      const discardCopies = (keep: ReadonlySet<string> = new Set()) =>
        Promise.all(
          copies
            .filter((c) => !keep.has(c.newId))
            .map((c) => removeStoredObject(ADVICE_ATTACHMENT_BUCKET, c.path).catch(() => {})),
        );
      if (body.action === 'accept' && body.share_attachments && (await waiting(prisma, id))) {
        try {
          for (const a of await caseAttachments(prisma, before.id)) {
            if (a.uploaded_by !== reader) continue; // only the requester's own photos
            const newId = randomUUID();
            const path = adviceAttachmentPath(newCaseId, newId, a.content_type);
            await copyStoredObject(ADVICE_ATTACHMENT_BUCKET, a.storage_path, path);
            copies.push({
              fromId: a.id,
              newId,
              path,
              contentType: a.content_type,
              byteSize: a.byte_size,
            });
          }
        } catch (e) {
          await discardCopies();
          throw e;
        }
      }

      let row: CaseRow;
      try {
        row = await audited(prisma, async (tx) => {
          const current = await loadCase(tx, id, reader, true);
          const proposal = await waiting(tx, current.id, true);
          if (!proposal) {
            // An answer already given is returned as it stands.
            const [last] = await tx.$queryRawUnsafe<{ status: string }[]>(
              `SELECT status FROM public.advice_referral
                WHERE from_case_id = $1::uuid AND deleted_at IS NULL
                ORDER BY created_at DESC, id DESC LIMIT 1`,
              current.id,
            );
            const done: Record<AdviceReferralAction, string> = {
              accept: 'accepted',
              decline: 'declined',
              withdraw: 'withdrawn',
            };
            if (last?.status === done[action]) return current;
            throw unprocessable('advice_referral_none');
          }
          const referral = {
            entityType: 'advice_referral',
            entityId: proposal.id,
            ...actorOf(auth),
          };

          if (body.action !== 'accept') {
            const status = body.action === 'decline' ? 'declined' : 'withdrawn';
            await tx.$executeRawUnsafe(
              `UPDATE public.advice_referral
                  SET status = $2, decided_at = now(), updated_at = now()
                WHERE id = $1::uuid`,
              proposal.id,
              status,
            );
            await writeAudit(tx, {
              ...referral,
              action: body.action === 'decline' ? 'advice_referral.declined' : 'advice_referral.withdrawn',
              before: { status: 'proposed' },
              after: { status, from_case_id: current.id },
            });
            return current;
          }

          // accept
          if (current.status === 'closed') throw unprocessable('advice_case_closed');
          const to = checkTarget(await target(tx, proposal.to_provider_id), current);

          // 1. The new case, with the other provider: the topic and the question.
          await tx.$executeRawUnsafe(
            `INSERT INTO public.advice_case
               (id, provider_id, requester_auth_user_id, requester_name, topic, question,
                preferred_contact, share_details)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'in_app', false)`,
            newCaseId,
            to.id,
            current.requester_auth_user_id,
            current.requester_name,
            current.topic,
            current.question,
          );
          await writeAudit(tx, {
            entityType: 'advice_case',
            entityId: newCaseId,
            ...actorOf(auth),
            action: 'advice_case.created',
            after: {
              provider_id: to.id,
              topic: current.topic,
              status: 'open',
              preferred_contact: 'in_app',
              share_details: false,
              referred_from_case_id: current.id,
              referral_id: proposal.id,
            },
          });
          const [conversation] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.conversation
               (post_kind, post_id, post_title, owner_auth_user_id, owner_name,
                starter_auth_user_id, starter_name)
             VALUES ('advice_case', $1::uuid, $2, $3::uuid, $4, $5::uuid, $6)
             RETURNING id`,
            newCaseId,
            current.topic,
            to.auth_user_id,
            to.display_name,
            current.requester_auth_user_id,
            current.requester_name,
          );
          if (!conversation) throw notFound();
          await writeAudit(tx, {
            entityType: 'conversation',
            entityId: conversation.id,
            ...actorOf(auth),
            action: 'conversation.started',
            after: { post_kind: 'advice_case', post_id: newCaseId },
          });
          const { row: message } = await insertMessage(tx, {
            id: newCaseId,
            conversationId: conversation.id,
            sender: current.requester_auth_user_id,
            body: current.question,
          });
          await writeAudit(tx, {
            entityType: 'message',
            entityId: message.id,
            ...actorOf(auth),
            action: 'message.sent',
            after: { conversation_id: conversation.id },
          });

          // 2. The photos, only if the requester ticked the box, and only
          //    those still on the case (a photo removed meanwhile stays out).
          const kept = new Set((await caseAttachments(tx, current.id)).map((a) => a.id));
          for (const c of copies) {
            if (!kept.has(c.fromId)) continue;
            await tx.$executeRawUnsafe(
              `INSERT INTO public.advice_case_attachment
                 (id, case_id, uploaded_by, storage_path, content_type, byte_size, copied_from_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)`,
              c.newId,
              newCaseId,
              reader,
              c.path,
              c.contentType,
              c.byteSize,
              c.fromId,
            );
            await writeAudit(tx, {
              entityType: 'advice_case_attachment',
              entityId: c.newId,
              ...actorOf(auth),
              action: 'advice_attachment.added',
              after: {
                case_id: newCaseId,
                content_type: c.contentType,
                byte_size: c.byteSize,
                copied_from_id: c.fromId,
              },
            });
          }

          // 3. The referral, accepted, linking the two cases.
          await tx.$executeRawUnsafe(
            `UPDATE public.advice_referral
                SET status = 'accepted', to_case_id = $2::uuid, share_attachments = $3,
                    decided_at = now(), updated_at = now()
              WHERE id = $1::uuid`,
            proposal.id,
            newCaseId,
            body.share_attachments,
          );
          await writeAudit(tx, {
            ...referral,
            action: 'advice_referral.accepted',
            before: { status: 'proposed' },
            after: {
              status: 'accepted',
              from_case_id: current.id,
              to_case_id: newCaseId,
              to_provider_id: to.id,
              share_attachments: body.share_attachments,
            },
          });

          // 4. The earlier case closes as referred, on the proposer's word.
          await tx.$executeRawUnsafe(
            `UPDATE public.advice_case
                SET status = 'closed', outcome = 'referred', closed_at = now(),
                    closed_by = $2::uuid, updated_at = now()
              WHERE id = $1::uuid`,
            current.id,
            proposal.proposed_by,
          );
          await writeAudit(tx, {
            entityType: 'advice_case',
            entityId: current.id,
            ...actorOf(auth),
            action: 'advice_case.closed',
            before: { status: current.status },
            after: {
              status: 'closed',
              outcome: 'referred',
              closed_by_side: 'provider',
              referral_id: proposal.id,
            },
          });
          return loadCase(tx, current.id, reader);
        });
      } catch (e) {
        await discardCopies();
        throw e;
      }
      // A copy no row points at -- a retried accept that found nothing
      // waiting, or a photo removed meanwhile -- is shown to nobody: remove it.
      if (copies.length > 0) {
        const used = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.advice_case_attachment WHERE case_id = $1::uuid`,
          newCaseId,
        );
        await discardCopies(new Set(used.map((u) => u.id)));
      }
      return ok(await presentCase(prisma, row, reader, true));
    },
  },
});

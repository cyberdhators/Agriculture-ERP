import {
  type RejectionReason,
  type VerificationState,
  canTransition,
  daysWaiting,
} from '@agri-erp/shared';
import { type AuditTx, writeAudit } from './audit';
import { conflict, unprocessable } from './errors';
import { FARMER_COLUMNS, FARMER_FROM, type FarmerRow } from './farmers';
import { type Authenticated } from './require-role';

/**
 * The state machine (C-6.1), in one place. A route names a decision; this
 * module decides whether the record may take it, and performs the whole
 * transition — status, pointer, clock, verification event, audit event — in
 * the caller's audited transaction (C-6.6). No route writes
 * verification_status.
 */
export type Decision =
  | { readonly kind: 'verify' }
  | { readonly kind: 'reject'; readonly reasonCode: RejectionReason; readonly note?: string }
  | { readonly kind: 'merge'; readonly targetId: string; readonly note?: string }
  | { readonly kind: 'resubmit' };

const TARGET_STATE: Record<Decision['kind'], VerificationState> = {
  verify: 'verified',
  reject: 'rejected',
  merge: 'merged',
  resubmit: 'pending',
};

const AUDIT_ACTION = {
  verify: 'farmer.verified',
  reject: 'farmer.rejected',
  merge: 'farmer.merged',
  resubmit: 'farmer.resubmitted',
} as const;

interface TargetRow {
  id: string;
  state_id: string;
  verification_status: string;
  deleted_at: Date | null;
}

/**
 * C-6.4: the target must exist within the caller's scope, be neither the
 * source, nor merged, nor rejected, nor soft-deleted, and be in the source's
 * state — for every role, including an administrator.
 */
async function checkMergeTarget(
  tx: AuditTx,
  source: FarmerRow,
  targetId: string,
  auth: Authenticated,
): Promise<TargetRow> {
  const params: unknown[] = [targetId];
  const conditions = ['id = $1::uuid'];
  if (auth.scope.kind === 'state') {
    params.push(auth.scope.stateId);
    conditions.push(`state_id = $${params.length}`);
  }
  const [target] = await tx.$queryRawUnsafe<TargetRow[]>(
    `SELECT id, state_id, verification_status::text AS verification_status, deleted_at
     FROM public.farmer WHERE ${conditions.join(' AND ')}`,
    ...params,
  );
  if (!target) throw unprocessable('merge_target_not_found');
  if (
    target.id === source.id ||
    target.deleted_at !== null ||
    target.verification_status === 'merged' ||
    target.verification_status === 'rejected'
  ) {
    throw conflict('merge_target_not_eligible');
  }
  if (target.state_id !== source.state_id) throw conflict('merge_across_states');
  return target;
}

export async function transitionFarmer(
  tx: AuditTx,
  source: FarmerRow,
  decision: Decision,
  auth: Authenticated,
): Promise<FarmerRow> {
  const from = source.verification_status as VerificationState;
  const to = TARGET_STATE[decision.kind];
  if (!canTransition(from, to)) throw conflict('transition_not_allowed');

  const target =
    decision.kind === 'merge' ? await checkMergeTarget(tx, source, decision.targetId, auth) : null;
  const waited = daysWaiting(source.pending_since);

  // Optimistic: the row must still be in `from`. A concurrent decision loses
  // here rather than overwriting.
  const updated = await tx.$executeRawUnsafe(
    `UPDATE public.farmer
     SET verification_status = $3::public.verification_status,
         merged_into = COALESCE($4::uuid, merged_into),
         pending_since = CASE WHEN $5 THEN now() ELSE pending_since END
     WHERE id = $1::uuid AND deleted_at IS NULL AND verification_status = $2::public.verification_status`,
    source.id,
    from,
    to,
    target?.id ?? null,
    decision.kind === 'resubmit',
  );
  if (updated !== 1) throw conflict('transition_not_allowed');

  const isResubmit = decision.kind === 'resubmit';
  await tx.$executeRawUnsafe(
    `INSERT INTO public.verification_event
       (farmer_id, reviewer_id, officer_id, decision, merge_target_id, reason_code, note, days_waiting)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.verification_decision, $5::uuid, $6, $7, $8)`,
    source.id,
    isResubmit ? null : auth.principal.id,
    isResubmit ? auth.principal.id : null,
    isResubmit ? 'resubmitted' : to,
    target?.id ?? null,
    decision.kind === 'reject'
      ? decision.reasonCode
      : decision.kind === 'merge'
        ? 'duplicate'
        : null,
    'note' in decision && decision.note ? decision.note : null,
    waited,
  );

  // The note is never passed here (C-6.3); auditSafe would strip it anyway.
  await writeAudit(tx, {
    entityType: 'farmer',
    entityId: source.id,
    actorType: auth.role,
    actorId: auth.principal.id,
    action: AUDIT_ACTION[decision.kind],
    before: { verification_status: from },
    after: {
      verification_status: to,
      days_waiting: waited,
      ...(decision.kind === 'reject' ? { reason_code: decision.reasonCode } : {}),
      ...(target ? { merged_into: target.id } : {}),
    },
  });

  const [fresh] = await tx.$queryRawUnsafe<FarmerRow[]>(
    `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE f.id = $1::uuid`,
    source.id,
  );
  return fresh as FarmerRow;
}

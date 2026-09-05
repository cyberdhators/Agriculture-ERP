import { type AuditAction, type AuditActorType, auditSafe } from '@agri-erp/shared';
import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../db';

/**
 * writeAudit, and why it cannot be called outside a transaction. Unit B4.
 *
 * C-4.4: a change and its audit entry succeed or fail together. That is only
 * true if the entry is written INSIDE the transaction of the change. Two layers
 * make calling it anywhere else impossible rather than merely discouraged:
 *
 *   1. THE TYPE. writeAudit takes an `AuditTx`, which is a transaction client
 *      carrying a brand symbol. The only function that produces one is
 *      `audited()`, which opens the transaction and stamps the client. Passing
 *      the top-level `prisma` fails to compile: it has no brand.
 *
 *   2. THE RUNTIME. An interactive transaction client has no `$transaction`
 *      method; the top-level client does. writeAudit asserts the object it was
 *      handed has none, so a caller who casts past the type still fails at the
 *      first call. Both checks are proved by tests.
 */

const AUDIT_TX = Symbol.for('agri-erp.audit-tx');

/** How long a write transaction may sit idle before the server ends it. Exported for the test that proves it is set. */
export const IDLE_IN_TRANSACTION_TIMEOUT = '30s';

/** A transaction client that `audited()` has stamped. Nothing else can make one. */
export type AuditTx = Prisma.TransactionClient & { readonly [AUDIT_TX]: true };

export interface AuditEntry {
  readonly entityType: string;
  readonly entityId: string;
  readonly actorType: AuditActorType;
  /** Required unless actorType is 'system'. The database enforces the pair. */
  readonly actorId: string | null;
  readonly action: AuditAction;
  /** CHANGED FIELDS ONLY. Never a whole row. Stripped by auditSafe before it is stored. */
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly deviceId?: string | null;
}

/**
 * Runs `fn` inside one transaction and hands it a client that writeAudit will
 * accept. Every write that must be audited goes through here.
 *
 * The budget is wide because this link is slow (docs/PROJECT-STATE.md).
 */
export async function audited<T>(
  client: PrismaClient,
  fn: (tx: AuditTx) => Promise<T>,
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      // An abandoned transaction must never hold a lock for long. Found
      // 2026-09-05: a client that gives up on a transaction leaves the server
      // session "idle in transaction" through the pooler, this role has no
      // idle_in_transaction_session_timeout, and the farmer-number counter row
      // stayed locked for sixteen minutes. SET LOCAL is scoped to this
      // transaction, so nothing outside it changes.
      await tx.$executeRawUnsafe(
        `SET LOCAL idle_in_transaction_session_timeout = '${IDLE_IN_TRANSACTION_TIMEOUT}'`,
      );
      Object.defineProperty(tx, AUDIT_TX, { value: true, enumerable: false });
      return fn(tx as AuditTx);
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
}

/**
 * Appends one audit row inside the caller's transaction.
 *
 * Throws -- and therefore rolls the caller's change back -- if it was handed
 * anything other than a client from `audited()`.
 */
export async function writeAudit(tx: AuditTx, entry: AuditEntry): Promise<void> {
  if (!(AUDIT_TX in tx) || '$transaction' in tx) {
    throw new Error(
      'writeAudit must be called with the client from audited(). ' +
        'An audit row written outside the transaction of its change can record a change that never happened.',
    );
  }
  if (entry.actorType === 'system' ? entry.actorId !== null : !entry.actorId) {
    throw new Error(
      'writeAudit: actorId must be null for system and present for every other actor type.',
    );
  }

  await tx.$executeRawUnsafe(
    `INSERT INTO public.audit_event
       (entity_type, entity_id, actor_type, actor_id, action, before, after, device_id)
     VALUES ($1, $2, $3::public.audit_actor_type, $4::uuid, $5, $6::jsonb, $7::jsonb, $8)`,
    entry.entityType,
    entry.entityId,
    entry.actorType,
    entry.actorId,
    entry.action,
    JSON.stringify(auditSafe(entry.before)),
    JSON.stringify(auditSafe(entry.after)),
    entry.deviceId ?? null,
  );
}

/**
 * For the two writes that are HTTP calls to Supabase Auth and have no
 * transaction (C-4.4 note). The row records the OUTCOME after the call returned
 * -- `auth.disabled` on success, `auth.disable_failed` on failure -- in a
 * transaction of its own. A log that records an intention rather than an
 * outcome is worse than no log.
 */
export async function writeAuditOutcome(entry: AuditEntry): Promise<void> {
  await audited(prisma, (tx) => writeAudit(tx, entry));
}

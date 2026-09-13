import type { StampKind, SyncStatus } from '@/components/ui';
import { daysSince } from '@/lib/format';
import type { Role } from '@/lib/preview';

import {
  FARMERS,
  PREVIEW_OFFICER_ID,
  type Farmer,
  type FarmSyncStatus,
  type SyncRecord,
  type VerificationStatus,
} from '@/lib/fixtures/farmers';

/**
 * How a farmer's state reads on screen: the stamp shown, whether the wait has
 * been escalated, and who — under the preview role — is even allowed to see the
 * row. The rules are the reporting and authorization laws in one place so the
 * screens stay declarative.
 */

/** A pending farmer waiting longer than this is escalated. */
export const ESCALATE_AFTER_DAYS = 7;

/** Every non-admin preview role is scoped to this state. */
export const SCOPE_STATE = 'CE';

export function effectiveStatus(farmer: Farmer): 'merged' | VerificationStatus {
  return farmer.merged_into ? 'merged' : farmer.verification_status;
}

const STATUS_STAMP: Record<'merged' | VerificationStatus, StampKind> = {
  verified: 'verified',
  pending: 'pending',
  rejected: 'rejected',
  merged: 'merged',
};

export function statusStamp(farmer: Farmer): StampKind {
  return STATUS_STAMP[effectiveStatus(farmer)];
}

export const STATUS_LABEL: Record<'merged' | VerificationStatus, string> = {
  verified: 'Verified',
  pending: 'Pending',
  rejected: 'Rejected',
  merged: 'Merged',
};

/** Whole days a farmer has been on the register (basis for the wait). */
export function daysWaiting(farmer: Farmer, now?: Date): number {
  return daysSince(farmer.created_at.slice(0, 10), now);
}

export function isEscalated(farmer: Farmer, now?: Date): boolean {
  return (
    farmer.merged_into === null &&
    farmer.verification_status === 'pending' &&
    daysWaiting(farmer, now) > ESCALATE_AFTER_DAYS
  );
}

/* ---- Sync -------------------------------------------------------------- */

const SYNC_MAP: Record<FarmSyncStatus, SyncStatus> = {
  waiting: 'waiting',
  sending: 'sending',
  synced: 'synced',
  failed: 'failed',
};

export function syncStatusOf(records: readonly SyncRecord[]): SyncStatus {
  if (records.length === 0) return 'synced';
  // Worst-of, so a single failed device shows through.
  const order: SyncStatus[] = ['failed', 'sending', 'waiting', 'synced'];
  for (const status of order) {
    if (records.some((r) => SYNC_MAP[r.sync_status] === status)) return status;
  }
  return 'synced';
}

export const SYNC_REASON_LABEL: Record<string, string> = {
  no_network: 'No network',
  payload_too_large: 'Payload too large',
  auth_expired: 'Session expired',
  server_error: 'Server error',
  conflict: 'Conflict',
};

/* ---- Duplicates -------------------------------------------------------- */

export type DuplicateReason = 'phone' | 'name_payam';

export interface DuplicateMatch {
  farmer: Farmer;
  reason: DuplicateReason;
}

function normalName(farmer: Farmer): string {
  return `${farmer.given_name} ${farmer.family_name}`.trim().toLowerCase();
}

/**
 * Possible duplicates of a farmer: same phone, or same name within the same
 * payam. Warns; it never blocks — the survivor is a person's decision, not the
 * system's. Merged rows and the farmer itself are excluded.
 */
export function duplicatesOf(farmer: Farmer, pool: readonly Farmer[] = FARMERS): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const other of pool) {
    if (other.id === farmer.id) continue;
    if (other.merged_into) continue;
    if (other.phone === farmer.phone) {
      matches.push({ farmer: other, reason: 'phone' });
      continue;
    }
    if (normalName(other) === normalName(farmer) && other.payam_id === farmer.payam_id) {
      matches.push({ farmer: other, reason: 'name_payam' });
    }
  }
  return matches;
}

export function duplicateSentence(match: DuplicateMatch): string {
  const who = `${match.farmer.given_name} ${match.farmer.family_name} (${match.farmer.farmer_number})`;
  return match.reason === 'phone'
    ? `Possible duplicate — same phone as ${who}.`
    : `Possible duplicate — same name and payam as ${who}.`;
}

/* ---- Role scope -------------------------------------------------------- */

/** The officer whose caseload the "Field officer" preview role stands in for. */
export { PREVIEW_OFFICER_ID };

/**
 * The farmers a preview role may see. Admin sees everyone; supervisor and
 * read-only see their state; an officer sees only their own caseload within
 * their state. Merged rows are kept — they are part of the record — but the
 * out-of-state rows exist precisely to prove the scope holds.
 */
export function scopeFarmers(
  farmers: readonly Farmer[],
  role: Role,
  officerId: string = PREVIEW_OFFICER_ID,
): Farmer[] {
  switch (role) {
    case 'admin':
      return [...farmers];
    case 'supervisor':
    case 'read_only':
      return farmers.filter((f) => f.state_id === SCOPE_STATE);
    case 'officer':
      return farmers.filter(
        (f) => f.state_id === SCOPE_STATE && f.caseload_officer_id === officerId,
      );
    default:
      return [];
  }
}

/** Whether the role may take verify / merge / reject decisions. */
export function canReview(role: Role): boolean {
  return role === 'admin' || role === 'supervisor';
}

/** Whether the role may register a new farmer. */
export function canRegister(role: Role): boolean {
  return role === 'admin' || role === 'officer';
}

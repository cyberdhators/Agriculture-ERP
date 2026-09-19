import type { QueueItem } from '@/lib/farmers/verification';
import type { Summary } from '@/lib/reports/api';

/** Counts as the server computed them: in scope is verified + pending + rejected, never merged (C-6.8). */
export function kpisFrom(summary: Summary): {
  in_scope: number;
  verified: number;
  pending: number;
  rejected: number;
  merged: number;
} {
  const { verified, pending, rejected, merged } = summary.farmers;
  // `merged` is REPORTED but never added to in_scope: a merged record is the
  // same farmer as the one it was merged into, and counting it again would
  // inflate reach by exactly the number of duplicates the merge removed
  // (C-6.8). It is surfaced because "how many duplicates did we resolve" is a
  // question an administrator asks, not because it is a population.
  return { in_scope: verified + pending + rejected, verified, pending, rejected, merged };
}

export interface QueueRow {
  id: string;
  farmer_number: string;
  given_name: string;
  family_name: string;
  payam_id: string;
  registered_by: string | null;
  days: number;
  escalated: boolean;
}

/** Escalated first, then the longest wait — the order a reviewer works in. */
export function queueRows(items: readonly QueueItem[]): QueueRow[] {
  return [...items]
    .sort((a, b) => {
      if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
      return b.days_waiting - a.days_waiting;
    })
    .map((f) => ({
      id: f.id,
      farmer_number: f.farmer_number,
      given_name: f.given_name,
      family_name: f.family_name,
      payam_id: f.payam_id,
      registered_by: f.registered_by,
      days: f.days_waiting,
      escalated: f.escalated,
    }));
}

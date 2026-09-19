import { REPORT_REASONS, REPORT_STATUSES } from '@agri-erp/shared';

import type { StampKind } from '@/components/ui';

/**
 * Labels for the PROPOSED reason and status vocabularies.
 *
 * The backend owns these once it exists. Every lookup falls back to the raw
 * value rather than hiding a row: a report carrying a status this build has
 * never heard of must still appear in the queue, because an administrator
 * needs to see that it happened even when the screen cannot name it prettily.
 */
const REASON_LABELS: Record<string, string> = {
  prohibited_content: 'Prohibited content',
  misleading_listing: 'Misleading listing',
  counterfeit_or_fraud: 'Counterfeit or fraud',
  inappropriate_content: 'Inappropriate content',
  duplicate_or_spam: 'Duplicate or spam',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const reasonLabel = (key: string): string => REASON_LABELS[key] ?? key.replace(/_/g, ' ');

export const statusLabel = (key: string): string => STATUS_LABELS[key] ?? key.replace(/_/g, ' ');

/** Colour is secondary: the label carries the meaning on its own. */
export function statusTone(status: string): StampKind {
  if (status === 'resolved') return 'verified';
  if (status === 'new') return 'pending';
  return 'neutral';
}

export const KNOWN_REASONS: readonly string[] = REPORT_REASONS;
export const KNOWN_STATUSES: readonly string[] = REPORT_STATUSES;

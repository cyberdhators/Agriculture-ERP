import type { StampKind } from '@/components/ui';
import type { TKey } from '@/lib/i18n';
import type { VerificationStatus } from '@/lib/fixtures/farmers';

/** How a farmer's verification reads as a stamp, in the farmer's language. */
const STAMP: Record<VerificationStatus, StampKind> = {
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
};

export function verificationStamp(status: VerificationStatus): StampKind {
  return STAMP[status];
}

export const VERIFICATION_KEY: Record<VerificationStatus, TKey> = {
  pending: 'account.pending',
  verified: 'account.verified',
  rejected: 'account.rejected',
};

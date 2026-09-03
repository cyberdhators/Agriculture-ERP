import type { StampKind } from '@/components/ui';
import type { TKey } from '@/lib/i18n';
import type { Farmer, ListingStatus } from '@/lib/fixtures/farmers';

/**
 * How a produce listing's status reads on screen, and the one rule the farmer
 * flow enforces client-side: a listing can only be `listed` when the farmer is
 * verified (B12 point 5). Draft is always allowed; a pending farmer sees the
 * exact reason. Colour backs the word; the word carries the meaning.
 */

const STATUS_STAMP: Record<ListingStatus, StampKind> = {
  draft: 'neutral',
  listed: 'verified',
  withdrawn: 'merged',
  sold: 'info',
};

export function listingStamp(status: ListingStatus): StampKind {
  return STATUS_STAMP[status];
}

export const STATUS_KEY: Record<ListingStatus, TKey> = {
  draft: 'status.draft',
  listed: 'status.listed',
  withdrawn: 'status.withdrawn',
  sold: 'status.sold',
};

/** A farmer may publish (move a listing to `listed`) only once verified. */
export function canPublishListings(farmer: Pick<Farmer, 'verification_status'>): boolean {
  return farmer.verification_status === 'verified';
}

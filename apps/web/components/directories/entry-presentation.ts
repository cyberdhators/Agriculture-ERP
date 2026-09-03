import type { DirectoryEntryType } from '@agri-erp/shared';

import type { DirectoryEntryRow } from '@/lib/fixtures/p1';
import { STALE_AFTER_DAYS, daysSince, formatDate } from '@/lib/format';

export const TYPE_TONE: Record<DirectoryEntryType, 'leaf' | 'nile' | 'sorghum'> = {
  agro_dealer: 'leaf',
  input_supplier: 'nile',
  financial_service: 'sorghum',
};

/**
 * What the badge next to an entry says about its freshness. Wording follows
 * the design rule for states: what happened, then what to do.
 */
export function freshness(entry: DirectoryEntryRow): {
  tone: 'leaf' | 'sorghum';
  short: string;
  long: string;
} {
  const days = daysSince(entry.last_verified_at);
  if (days > STALE_AFTER_DAYS) {
    return {
      tone: 'sorghum',
      short: `Not checked for ${days} days`,
      long: `Last checked ${formatDate(entry.last_verified_at)}, over ${STALE_AFTER_DAYS} days ago. Confirm the details before sending a farmer here.`,
    };
  }
  return {
    tone: 'leaf',
    short: `Checked ${formatDate(entry.last_verified_at)}`,
    long: `Last checked ${formatDate(entry.last_verified_at)}, ${days} days ago.`,
  };
}

export function matchesQuery(entry: DirectoryEntryRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  const haystack = [
    entry.name,
    entry.description ?? '',
    entry.contact_name ?? '',
    entry.phone,
    entry.alt_phone ?? '',
    entry.physical_address ?? '',
    ...entry.services,
  ]
    .join(' ')
    .toLocaleLowerCase();
  return (
    haystack.includes(q) || entry.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\0')
  );
}

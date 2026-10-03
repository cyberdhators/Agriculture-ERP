'use client';

import Link from 'next/link';

import { UnavailableState } from '@/components/ui/data';
import { OfficerRecordVisit } from '@/components/officer/OfficerRecordVisit';
import { usePreview } from '@/lib/preview';

/**
 * `/farmers/:id/visits/new` — recording a visit.
 *
 * THIS IS AN OFFICER'S SCREEN BECAUSE THE ROUTE IS AN OFFICER'S ROUTE.
 * `POST /api/farmers/:id/visits` declares `roles: ['officer']`, and the visit
 * table's `officer_id` references the officer table, so the database itself
 * cannot record an administrator as having made a field visit. Showing anyone
 * else a form here would be showing them a form the server answers 403 to.
 *
 * So the others are told plainly that fieldwork is not theirs, rather than
 * being allowed to type a visit and lose it on submit.
 */
export function RecordVisitByRole({ farmerId }: { farmerId: string }) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (role === 'officer') return <OfficerRecordVisit farmerId={farmerId} />;
  return (
    <UnavailableState title="Only an extension officer records a visit">
      A visit is fieldwork, and the record names the officer who did it — so the server accepts one
      only from the farmer&apos;s own officer.{' '}
      <Link href={`/farmers/${farmerId}`}>Back to the farmer</Link>.
    </UnavailableState>
  );
}

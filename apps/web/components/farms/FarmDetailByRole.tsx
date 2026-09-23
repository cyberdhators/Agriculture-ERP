'use client';

import Link from 'next/link';

import { UnavailableState } from '@/components/ui/data';
import { OfficerFarmDetail } from '@/components/officer/OfficerFarmDetail';
import { usePreview } from '@/lib/preview';

/**
 * `/farms/:id` — one farm on its own page.
 *
 * The officer needs this: it is where a walk is checked afterwards, where
 * crops are corrected and where re-mapping starts. `GET /api/farms/:id`
 * accepts every role and scopes each one, so the branch changes nothing about
 * what may be read — only how it reads.
 *
 * Administrators and supervisors already review farms on the national map,
 * which is built around the geojson route that is theirs alone. Rebuilding
 * that as a per-farm page would be redesigning their workflow to no purpose,
 * so they are sent to the surface they already use.
 */
export function FarmDetailByRole({ farmId }: { farmId: string }) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (role === 'officer') return <OfficerFarmDetail farmId={farmId} />;
  return (
    <UnavailableState title="Open this farm from the map">
      Farms and maps shows every farm in your scope with its boundary and figures.{' '}
      <Link href="/farms">Go to farms and maps</Link>.
    </UnavailableState>
  );
}

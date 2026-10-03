'use client';

import Link from 'next/link';

import { UnavailableState } from '@/components/ui/data';
import { OfficerMapFarm } from '@/components/officer/OfficerMapFarm';
import { usePreview } from '@/lib/preview';

/**
 * `/farmers/:id/farms/new` — mapping a farm.
 *
 * AN OFFICER'S SCREEN BECAUSE IT IS AN OFFICER'S ROUTE.
 * `POST /api/farmers/:id/farms` declares `roles: ['officer']`, and the staging
 * suite proves an administrator is refused by the route AND by the schema.
 * Mapping is physical fieldwork: the boundary is what somebody walked, so the
 * system does not let a desk record one.
 *
 * Everyone else is told that plainly instead of being shown a walk screen that
 * would end in a 403.
 */
export function MapFarmByRole({ farmerId }: { farmerId: string }) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (role === 'officer') return <OfficerMapFarm farmerId={farmerId} />;
  return (
    <UnavailableState title="Only an extension officer maps a farm">
      A boundary is a record of land someone walked, and the server accepts one only from the
      farmer&apos;s own officer. <Link href={`/farmers/${farmerId}`}>Back to the farmer</Link>.
    </UnavailableState>
  );
}

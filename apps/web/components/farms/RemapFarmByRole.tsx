'use client';

import Link from 'next/link';

import { UnavailableState } from '@/components/ui/data';
import { OfficerRemapFarm } from '@/components/officer/OfficerRemapFarm';
import { usePreview } from '@/lib/preview';

/**
 * `/farms/:id/remap` — walking a farm's boundary again.
 *
 * `POST /api/farms/:id/boundaries` is `roles: ['officer']`. Re-mapping is the
 * same physical act as mapping, so the same rule holds: a boundary is a record
 * of land somebody walked and the server will not take one from a desk.
 */
export function RemapFarmByRole({ farmId }: { farmId: string }) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (role === 'officer') return <OfficerRemapFarm farmId={farmId} />;
  return (
    <UnavailableState title="Only an extension officer maps a farm">
      A boundary records land someone walked, and the server accepts one only from the farmer&apos;s
      own officer. <Link href="/farms">Back to farms and maps</Link>.
    </UnavailableState>
  );
}

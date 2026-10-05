'use client';

import { OfficerFarmerEdit } from '@/components/officer/OfficerFarmerEdit';
import { usePreview } from '@/lib/preview';

import { FarmerDossier } from './FarmerDossier';

/**
 * `/farmers/[id]/edit` — a route that did not exist until now.
 *
 * The officer detail screen linked here and nothing answered; that dead link
 * is what this fixes. An officer gets a correction form built for a phone.
 *
 * EVERY OTHER ROLE GETS THE DOSSIER, UNCHANGED, because that is where their
 * editing already lives: `FarmerDossier` holds the correction flow inline,
 * beside verify, reject, merge and reassign, and pulling it out into a separate
 * page would be redesigning the administrator's workflow to no purpose. The
 * address is simply an alias to the screen they already use.
 */
export function FarmerEditByRole({ id }: { id: string }) {
  const { role } = usePreview();
  return role === 'officer' ? <OfficerFarmerEdit id={id} /> : <FarmerDossier id={id} />;
}

'use client';

import { OfficerFarmerDetail } from '@/components/officer/OfficerFarmerDetail';
import { usePreview } from '@/lib/preview';

import { FarmerDossier } from './FarmerDossier';

/**
 * ONE ADDRESS, TWO SCREENS, CHOSEN BY ROLE -- the same split as `/farmers`.
 *
 * The dossier is 1,278 lines and holds an administrator's decisions: verify,
 * reject, merge, reassign, remove, each with its dialog and its audit
 * consequence. An officer holds one decision -- correct a rejected
 * registration -- and reads the record standing up. Threading a role through
 * that file would leave one component owning two products and the phone case
 * would be the one that rots.
 *
 * PRESENTATION, NOT AUTHORISATION. Both screens call
 * `GET /api/farmers/:id`, which runs `loadVisible` and puts the caller's scope
 * in the WHERE clause. Serving the dossier to an officer would be wrong for
 * them and would leak nothing; serving this to an administrator would withhold
 * decisions they hold. The branch is about fit, and the server is about access.
 */
export function FarmerDetailByRole({ id }: { id: string }) {
  const { role } = usePreview();
  return role === 'officer' ? <OfficerFarmerDetail id={id} /> : <FarmerDossier id={id} />;
}

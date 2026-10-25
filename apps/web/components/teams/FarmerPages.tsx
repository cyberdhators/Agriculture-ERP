'use client';

import { useFarmerSession } from '@/lib/farmer-session';

import { OrganisationTeam } from './OrganisationTeam';
import { Organisations } from './Organisations';

/** The farmer side's organisations pages, in the language the farmer chose. */
export function FarmerOrganisations() {
  const { language } = useFarmerSession();
  return <Organisations side="farmer" language={language === 'ar' ? 'ar' : 'en'} />;
}

export function FarmerOrganisationTeam({ id }: { id: string }) {
  const { language } = useFarmerSession();
  return <OrganisationTeam id={id} side="farmer" language={language === 'ar' ? 'ar' : 'en'} />;
}

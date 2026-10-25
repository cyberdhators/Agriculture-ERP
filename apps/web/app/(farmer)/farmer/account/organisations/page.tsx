import type { Metadata } from 'next';

import { FarmerOrganisations } from '@/components/teams/FarmerPages';

export const metadata: Metadata = { title: 'Organisations' };

/** 2026-10-27 (team access): the account's organisations and invitations. */
export default function Page() {
  return <FarmerOrganisations />;
}

import type { Metadata } from 'next';

import { OrganisationTeam } from '@/components/teams/OrganisationTeam';

export const metadata: Metadata = { title: 'Organisation' };

/** 2026-10-27 (team access): one organisation, for its members. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganisationTeam id={id} side="buyer" language="en" />;
}

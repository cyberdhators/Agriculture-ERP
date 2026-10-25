import type { Metadata } from 'next';

import { PublicOrganisation } from '@/components/teams/PublicOrganisation';

export const metadata: Metadata = { title: 'Organisation' };

/** 2026-10-27 (team access): an organisation's public profile, when published. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicOrganisation id={id} />;
}

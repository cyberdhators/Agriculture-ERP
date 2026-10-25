import type { Metadata } from 'next';

import { FarmerOrganisationAdvice } from '@/components/teams/FarmerPages';

export const metadata: Metadata = { title: 'Organisation advice' };

/** 2026-10-28: an organisation's shared advice inbox and advice profile. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerOrganisationAdvice id={id} />;
}

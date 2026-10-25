import type { Metadata } from 'next';

import { OrganisationAdvice } from '@/components/teams/OrganisationAdvice';

export const metadata: Metadata = { title: 'Organisation advice' };

/** 2026-10-28: an organisation's shared advice inbox and advice profile. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganisationAdvice id={id} side="buyer" language="en" />;
}

import type { Metadata } from 'next';

import { AdminOrganisations } from '@/components/teams/AdminOrganisations';

export const metadata: Metadata = { title: 'Organisations' };

/** 2026-10-27: organisational profiles, their teams, evidence-based recovery. */
export default function AdminOrganisationsPage() {
  return <AdminOrganisations />;
}

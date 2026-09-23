import type { Metadata } from 'next';

import { FarmerDetailByRole } from '@/components/farmers/FarmerDetailByRole';

export const metadata: Metadata = { title: 'Farmer dossier' };

export default async function FarmerDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerDetailByRole id={id} />;
}

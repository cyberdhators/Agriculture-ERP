import type { Metadata } from 'next';

import { FarmerDossier } from '@/components/farmers/FarmerDossier';

export const metadata: Metadata = { title: 'Farmer dossier' };

export default async function FarmerDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerDossier id={id} />;
}

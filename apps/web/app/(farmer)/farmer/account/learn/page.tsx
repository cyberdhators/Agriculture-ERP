import type { Metadata } from 'next';

import { FarmerLearn } from '@/components/farmer/FarmerLearn';

export const metadata: Metadata = { title: 'Learning materials' };

export default function FarmerLearnPage() {
  return <FarmerLearn />;
}

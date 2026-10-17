import type { Metadata } from 'next';

import { FarmerAssistant } from '@/components/farmer/FarmerAssistant';

export const metadata: Metadata = { title: 'AgriOne AI' };

export default function FarmerAssistantPage() {
  return <FarmerAssistant />;
}

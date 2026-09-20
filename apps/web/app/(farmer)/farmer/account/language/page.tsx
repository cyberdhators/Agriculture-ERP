import type { Metadata } from 'next';

import { FarmerLanguage } from '@/components/farmer/FarmerLanguage';

export const metadata: Metadata = { title: 'Language' };

export default function LanguagePage() {
  return <FarmerLanguage />;
}

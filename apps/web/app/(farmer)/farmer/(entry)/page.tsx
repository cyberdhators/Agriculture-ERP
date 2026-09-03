import type { Metadata } from 'next';

import { LanguagePicker } from '@/components/farmer/LanguagePicker';

export const metadata: Metadata = { title: 'AgriOne' };

export default function FarmerHomePage() {
  return <LanguagePicker />;
}

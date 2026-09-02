import type { Metadata } from 'next';

import { PlaceholderSection } from '@/components/portal/PlaceholderSection';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <PlaceholderSection
      title="Dashboard"
      unit="Built with the reporting unit (B9 / B11)"
      body="Requires-attention counts, programme reach and verified registrations by month, as on page 1 of the web design. Needs verified farmer records first; nothing to show until registration and verification exist."
    />
  );
}

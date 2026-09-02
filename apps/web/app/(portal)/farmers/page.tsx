import type { Metadata } from 'next';

import { PlaceholderSection } from '@/components/portal/PlaceholderSection';

export const metadata: Metadata = { title: 'Farmers' };

export default function FarmersPage() {
  return (
    <PlaceholderSection
      title="Farmers"
      unit="Built with the farmer registry units (B5 to B8)"
      body="Dense farmer list, farmer detail with the audit trail, registration form with duplicate warning, and the verification queue, as on pages 2 to 5 of the web design. Waits for the farmer table and requireRole."
    />
  );
}

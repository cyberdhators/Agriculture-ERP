import type { Metadata } from 'next';

import { StaffSecurity } from '@/components/admin/StaffSecurity';

export const metadata: Metadata = { title: 'Your sign-in security' };

export default function StaffSignInSecurityPage() {
  return <StaffSecurity />;
}

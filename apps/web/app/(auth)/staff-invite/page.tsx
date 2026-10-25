import type { Metadata } from 'next';

import { StaffInviteAccept } from '@/components/auth/StaffInviteAccept';

export const metadata: Metadata = { title: 'Join AgriOne staff' };

export default function StaffInvitePage() {
  return <StaffInviteAccept />;
}

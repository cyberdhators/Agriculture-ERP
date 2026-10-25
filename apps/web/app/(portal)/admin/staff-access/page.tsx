import type { Metadata } from 'next';

import { StaffAccess } from '@/components/admin/StaffAccess';
import { StaffInvitations } from '@/components/admin/StaffInvitations';

export const metadata: Metadata = { title: 'Staff and permissions' };

export default function AdminStaffAccessPage() {
  return (
    <>
      <StaffAccess />
      {/* 2026-10-28: invite staff by email; they choose their own password. */}
      <div style={{ marginTop: 'var(--s-5)' }}>
        <StaffInvitations />
      </div>
    </>
  );
}

import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/LoginForm';
import { safeNext } from '@/lib/auth/paths';

export const metadata: Metadata = { title: 'Staff sign in' };

/** The staff sign-in (2026-10-09): administrators, supervisors, read-only staff, officers. */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} audience="staff" />;
}

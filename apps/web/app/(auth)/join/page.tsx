import type { Metadata } from 'next';

import { JoinChooser } from '@/components/auth/JoinChooser';
import { safeNext } from '@/lib/auth/paths';

export const metadata: Metadata = { title: 'Sign in or register' };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <JoinChooser next={safeNext(next)} />;
}

import type { Metadata } from 'next';

import { ProfilePage } from '@/components/profiles/ProfilePage';

export const metadata: Metadata = { title: 'Profile' };

export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  return <ProfilePage kind={kind} id={id} />;
}

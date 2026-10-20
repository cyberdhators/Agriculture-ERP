import type { Metadata } from 'next';

import { PublicProfilePage } from '@/components/public-profile/PublicProfilePage';

export const metadata: Metadata = { title: 'Profile' };

/** 2026-10-23: a published public profile, by its public id (public profiles v2). */
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <PublicProfilePage publicId={publicId} />;
}

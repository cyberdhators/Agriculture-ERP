'use client';

import { POST_KINDS, type PostKind } from '@agri-erp/shared';

import { EmptyState } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';

import { PublicProfile } from './PublicProfile';

/** /market/profile/:kind/:id -- in the farmer's language when one is signed in. */
export function ProfilePage({ kind, id }: { kind: string; id: string }) {
  const { language } = useFarmerSession();
  if (!(POST_KINDS as readonly string[]).includes(kind)) {
    return (
      <EmptyState
        title={language === 'ar' ? 'هذا الملف غير متاح.' : 'This profile is not available.'}
      />
    );
  }
  return <PublicProfile kind={kind as PostKind} id={id} language={language} />;
}

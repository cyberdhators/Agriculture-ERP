'use client';

import { useSearchParams } from 'next/navigation';

import { AccountActivities } from '@/components/account/AccountActivities';
import { useFarmerSession } from '@/lib/farmer-session';

/** The farmer side of "who you are, what you do" (2026-10-19). */
export function FarmerAbout() {
  const { language } = useFarmerSession();
  // After sign-up the step can be skipped and goes on to the dashboard.
  const next = useSearchParams().get('next') ?? undefined;
  return (
    <AccountActivities
      language={language === 'ar' ? 'ar' : 'en'}
      next={next?.startsWith('/') && !next.startsWith('//') ? next : undefined}
    />
  );
}

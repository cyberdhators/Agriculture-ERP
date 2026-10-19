'use client';

import { useEffect, useState } from 'react';

import { farmerApi, FarmerApiError, useFarmerSession } from '@/lib/farmer-session';
import { offlineNow } from '@/lib/offline/net';

import { PageHead } from './AccountShell';

/**
 * BUY WITH THE SAME ACCOUNT (2026-10-19; CORWADO: "one account, many
 * activities"). Makes this account's buyer profile the first time -- from the
 * farmer's own name and phone, no second sign-up -- then opens the buyer side.
 * Every later visit finds the profile already there and goes straight on.
 */
export function StartBuying() {
  const { language } = useFarmerSession();
  const [problem, setProblem] = useState<string | null>(null);
  const ar = language === 'ar';

  useEffect(() => {
    if (offlineNow()) {
      setProblem(ar ? 'الشراء يحتاج إلى إشارة.' : 'Buying needs signal.');
      return;
    }
    farmerApi('/api/farmer/buying', { method: 'POST', body: JSON.stringify({}) })
      .then(() => window.location.assign('/buyer/marketplace'))
      .catch((e: unknown) =>
        setProblem(
          e instanceof FarmerApiError
            ? e.message
            : ar
              ? 'تعذّر فتح الشراء. حاول مرة أخرى.'
              : 'Buying could not be opened. Please try again.',
        ),
      );
  }, [ar]);

  return (
    <>
      <PageHead title={ar ? 'شراء' : 'Buy'} />
      <p role="status">
        {problem ?? (ar ? 'جارٍ فتح السوق للشراء…' : 'Opening the marketplace for buying…')}
      </p>
    </>
  );
}

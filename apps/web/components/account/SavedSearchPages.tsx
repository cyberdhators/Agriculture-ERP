'use client';

import { useBuyer } from '@/components/buyer/BuyerShell';
import { PageHead } from '@/components/farmer/AccountShell';
import { PageHeader } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { SavedSearchList } from './SavedSearches';

/**
 * "SAVED SEARCHES" IN EACH SHELL (2026-11-03). The same list -- one per
 * sign-in -- in the phone account's shell and in the email account's shell,
 * each in the language the person chose.
 */

export function FarmerSavedSearches() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;
  return (
    <>
      <PageHead title={t('saved.title', language)} />
      <SavedSearchList lang={language} />
    </>
  );
}

export function BuyerSavedSearches() {
  const { language } = useBuyer();
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('saved.title', language)} />
      <SavedSearchList lang={language} />
    </div>
  );
}

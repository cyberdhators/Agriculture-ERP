'use client';

import { PageHeader } from '@/components/ui';
import { SCOPE_STATE } from '@/lib/farmers/presentation';
import { STATE_NAMES } from '@/lib/fixtures/farmers';
import { t } from '@/lib/i18n';
import { usePreview } from '@/lib/preview';

import { Market } from './Market';
import { MarketDetail } from './MarketDetail';

/** The marketplace inside the staff portal, scoped by the signed-in role. */
export function StaffMarket() {
  const { role } = usePreview();
  const scopeName = role === 'admin' ? 'All states' : STATE_NAMES[SCOPE_STATE];
  return (
    <>
      <PageHeader
        eyebrow={`${t('market.title', 'en')} · ${scopeName}`}
        title={t('market.title', 'en')}
        subtitle={t('market.lead', 'en')}
      />
      <Market mode="staff" role={role} lang="en" detailHref={(id) => `/market/${id}`} />
    </>
  );
}

export function StaffMarketDetail({ id }: { id: string }) {
  const { role } = usePreview();
  return <MarketDetail id={id} mode="staff" role={role} lang="en" backHref="/market" />;
}

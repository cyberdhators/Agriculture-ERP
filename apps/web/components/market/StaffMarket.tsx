'use client';

import { PageHeader } from '@/components/ui';
import { SCOPE_STATE } from '@/lib/farmers/presentation';
import { useFarmerSession } from '@/lib/farmer-session';
import { STATE_NAMES } from '@/lib/fixtures/farmers';
import { t } from '@/lib/i18n';
import { usePreview } from '@/lib/preview';

import { Market } from './Market';
import { MarketDetail } from './MarketDetail';

/** The marketplace inside the staff portal, scoped by the signed-in role. */
export function StaffMarket() {
  const { role } = usePreview();
  const { language } = useFarmerSession();
  const scopeName = role === 'admin' ? 'All states' : STATE_NAMES[SCOPE_STATE];
  return (
    <>
      <PageHeader
        eyebrow={`${t('market.title', language)} · ${scopeName}`}
        title={t('market.title', language)}
        subtitle={t('market.lead', language)}
      />
      <Market mode="staff" role={role} lang={language} detailHref={(id) => `/market/${id}`} />
    </>
  );
}

export function StaffMarketDetail({ id }: { id: string }) {
  const { role } = usePreview();
  const { language } = useFarmerSession();
  return <MarketDetail id={id} mode="staff" role={role} lang={language} backHref="/market" />;
}

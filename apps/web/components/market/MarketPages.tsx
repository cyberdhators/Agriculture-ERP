'use client';

import { PageHead } from '@/components/farmer/AccountShell';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { Market } from './Market';
import { MarketDetail } from './MarketDetail';
import { StaffMarket, StaffMarketDetail } from './StaffMarket';

/** /market — the farmer's marketplace in their language, or the staff browse. */
export function MarketPage() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return <StaffMarket />;
  return (
    <>
      <PageHead title={t('market.title', language)} lead={t('market.lead', language)} />
      <Market mode="public" role="read_only" lang={language} detailHref={(id) => `/market/${id}`} />
    </>
  );
}

export function MarketDetailPage({ id }: { id: string }) {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return <StaffMarketDetail id={id} />;
  return <MarketDetail id={id} mode="public" role="read_only" lang={language} backHref="/market" />;
}

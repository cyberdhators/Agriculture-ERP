'use client';

import { MarketSections } from '@/components/market-posts/MarketSections';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';
import { usePreview } from '@/lib/preview';

import { Market } from './Market';
import { MarketDetail } from './MarketDetail';
import { MarketWelcome } from './Welcome';

/** The marketplace inside the staff portal, scoped by the signed-in role. */
export function StaffMarket() {
  const { role, me, hydrated } = usePreview();
  const { language, farmer, hydrated: farmerHydrated } = useFarmerSession();
  // 2026-10-31 (delight): a welcome for visitors only -- once both sessions
  // have been read and neither is signed in, so staff never see it flash.
  const visitor = hydrated && farmerHydrated && !me && !farmer;
  return (
    <>
      {visitor ? <MarketWelcome language={language} /> : null}
      <MarketSections current="produce" lang={language} />
      {/* 2026-10-31: the section tabs above name the page; the title is for
          screen readers and the browser tab. */}
      <h1 className="visually-hidden">{t('market.title', language)}</h1>
      <Market mode="staff" role={role} lang={language} detailHref={(id) => `/market/${id}`} />
    </>
  );
}

export function StaffMarketDetail({ id }: { id: string }) {
  const { role } = usePreview();
  const { language } = useFarmerSession();
  return <MarketDetail id={id} mode="staff" role={role} lang={language} backHref="/market" />;
}

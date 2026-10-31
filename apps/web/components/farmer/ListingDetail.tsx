'use client';

import { useEffect, useState } from 'react';

import { lifecycleStage } from '@agri-erp/shared';

import { BackLink, ProductPage } from '@/components/listings/ProductPage';
import { LifecycleActions, type ActionInput } from '@/components/market-posts/LifecycleActions';
import { ButtonLink, Notice } from '@/components/ui';
import { Celebrate } from '@/components/ui/Celebrate';
import { farmerPayamName, type ProduceListing } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { UNIT_KEY, formatQuantity, remainingQuantity } from '@/lib/farmers/listings';
import type { SellerInfo } from '@/lib/listings/api-client';
import { recordSale } from '@/lib/market-posts/api';
import { todayLocal } from '@/lib/market-posts/presentation';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';

/**
 * The farmer's own product page — the listing exactly as a buyer will see it
 * on the marketplace, with Edit in the head and, LISTINGS LANE (2026-10-19),
 * its lifecycle: publish, pause, resume, renew, record a sale, mark completed,
 * withdraw. Status changes and renewals go through the same save as an edit,
 * so they work without signal (the phone's outbox sends them later). A sale is
 * never queued -- a retry would count it twice -- so it needs signal.
 */
export function ListingDetail({ listingId }: { listingId: string }) {
  // 2026-10-31: opened straight after publishing (?published=1 from the form):
  // celebrate once, then drop the flag so a refresh does not repeat it.
  const [justPublished, setJustPublished] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('published') === '1') {
      setJustPublished(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  const { farmer, language, listingById, listingsFor, saveListing, refresh, isPending } =
    useFarmerSession();
  const [queued, setQueued] = useState(false);
  if (!farmer) return null;

  const listing = listingById(listingId);
  if (!listing || listing.farmer_id !== farmer.id) {
    return (
      <>
        <PageHead title={t('listings.title', language)} />
        <Notice kind="error">
          <p className="small">{t('listingForm.notFound', language)}</p>
        </Notice>
        <BackLink href="/farmer/account/listings">{t('detail.back', language)}</BackLink>
      </>
    );
  }

  const live = listingsFor(farmer.id).filter((l) => l.status === 'listed').length;
  const sellerInfo: SellerInfo = {
    id: farmer.id,
    payam_id: farmer.payam_id,
    payam_name: farmerPayamName(farmer.payam_id),
    created_at: farmer.created_at,
  };
  const stage = lifecycleStage(listing.status, listing.available_until, todayLocal());
  const unit = (u: ProduceListing['unit']) => t(UNIT_KEY[u], language);
  const remaining = remainingQuantity(listing);
  // What the buyer sees is what is left.
  const shown: ProduceListing = { ...listing, quantity: remaining };

  async function act(input: ActionInput) {
    if (!listing) return;
    if (input.action === 'record_sale') {
      await recordSale(listing.id, { quantity: input.quantity, close: input.close });
      await refresh();
      return;
    }
    const next: ProduceListing =
      input.action === 'renew'
        ? { ...listing, available_until: input.date }
        : {
            ...listing,
            status:
              input.action === 'pause'
                ? 'paused'
                : input.action === 'withdraw'
                  ? 'withdrawn'
                  : input.action === 'complete'
                    ? 'completed'
                    : 'listed',
          };
    const saved = await saveListing(next);
    setQueued(Boolean((saved as { pending?: boolean }).pending));
  }

  return (
    <>
      <BackLink href="/farmer/account/listings">{t('detail.back', language)}</BackLink>
      {justPublished ? (
        <Celebrate
          compact
          art="basket"
          title={language === 'ar' ? 'منتجك الآن في السوق' : 'Your produce is on the market'}
          body={
            language === 'ar'
              ? 'يمكن للمشترين أن يجدوه الآن ويرسلوا إليك طلباً.'
              : 'Buyers can find it now and send you a request.'
          }
        >
          <ButtonLink href={`/market/${listing.id}`} variant="secondary" size="small">
            {language === 'ar' ? 'شاهده كما يراه المشترون' : 'See it as buyers do'}
          </ButtonLink>
        </Celebrate>
      ) : null}
      {queued || isPending(listing.id) ? (
        <Notice kind="info">
          <p className="small">{t('lifecycle.queued', language)}</p>
        </Notice>
      ) : null}
      <LifecycleActions
        stage={stage}
        lang={language}
        onAction={act}
        endLabel={t('listingForm.availableUntil', language)}
        endsOn={listing.available_until}
        sale={{
          remaining,
          remainingLabel: formatQuantity({ quantity: remaining, unit: listing.unit }, unit),
        }}
        saleNeedsSignal={typeof navigator !== 'undefined' && !navigator.onLine}
      />
      <ProductPage
        contact={false}
        listing={shown}
        seller={sellerInfo}
        sellerListingCount={live}
        lang={language}
        kicker={t('detail.previewNote', language)}
        actions={
          <ButtonLink href={`/farmer/account/listings/${listing.id}/edit`}>
            {t('listings.edit', language)}
          </ButtonLink>
        }
      />
    </>
  );
}

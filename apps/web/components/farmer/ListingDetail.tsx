'use client';

import { BackLink, ProductPage } from '@/components/listings/ProductPage';
import { ButtonLink, Notice } from '@/components/ui';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import type { SellerInfo } from '@/lib/listings/api-client';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';

/**
 * The farmer's own product page — the listing exactly as a buyer will see it
 * on the marketplace, with Edit in the head.
 */
export function ListingDetail({ listingId }: { listingId: string }) {
  const { farmer, language, listingById, listingsFor } = useFarmerSession();
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
    verification_status: farmer.verification_status,
    payam_id: farmer.payam_id,
    payam_name: farmerPayamName(farmer.payam_id),
    created_at: farmer.created_at,
  };

  return (
    <>
      <BackLink href="/farmer/account/listings">{t('detail.back', language)}</BackLink>
      <ProductPage
        contact={false}
        listing={listing}
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

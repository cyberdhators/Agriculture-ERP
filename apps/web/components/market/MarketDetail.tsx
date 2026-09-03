'use client';

import { useMemo, useState } from 'react';

import { BackLink, ProductPage } from '@/components/listings/ProductPage';
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui';
import { farmerById, farmsForFarmer } from '@/lib/fixtures/farmers';
import { t, type Language } from '@/lib/i18n';
import type { Role } from '@/lib/preview';

import { useMarketModeration } from './moderation';
import { liveCount, marketRows, type MarketMode } from './marketplace';
import styles from '@/components/listings/listings.module.css';

/**
 * A product page on the marketplace, for buyers and staff alike. Admins and
 * supervisors additionally get the one moderation action: withdraw with a
 * reason, which is recorded against the listing and shown to the farmer.
 */
export function MarketDetail({
  id,
  mode,
  role,
  lang,
  backHref,
}: {
  id: string;
  mode: MarketMode;
  role: Role;
  lang: Language;
  backHref: string;
}) {
  const { overrides, reasons, withdraw } = useMarketModeration();
  const rows = useMemo(() => marketRows(mode, role, overrides), [mode, role, overrides]);
  const row = rows.find((r) => r.listing.id === id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  if (!row) {
    return (
      <>
        <BackLink href={backHref}>{t('market.title', lang)}</BackLink>
        <Notice kind="info">
          <p className="small">{t('market.notFound', lang)}</p>
        </Notice>
      </>
    );
  }

  const { listing } = row;
  const seller = farmerById(listing.farmer_id)!;
  const canModerate =
    mode === 'staff' && (role === 'admin' || role === 'supervisor') && listing.status === 'listed';
  const withdrawnReason = reasons.get(listing.id);

  function confirm() {
    if (reason.trim().length < 3) {
      setError(t('market.withdrawReasonError', lang));
      return;
    }
    withdraw(listing, reason.trim());
    setOpen(false);
  }

  return (
    <>
      <BackLink href={backHref}>{t('market.title', lang)}</BackLink>
      {withdrawnReason ? (
        <Notice kind="warn" title={t('market.withdrawnBy', lang)}>
          <p className="small" dir="auto">
            {withdrawnReason}
          </p>
        </Notice>
      ) : null}
      <ProductPage
        listing={listing}
        seller={seller}
        sellerListingCount={liveCount(rows, seller.id)}
        farm={farmsForFarmer(seller.id)[0]}
        lang={lang}
        actions={
          canModerate ? (
            <div className={styles.moderation}>
              <span className={styles.moderationTitle}>{t('market.status', lang)}</span>
              <Button variant="danger" onClick={() => setOpen(true)}>
                {t('market.withdraw', lang)}
              </Button>
            </div>
          ) : undefined
        }
      />

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('market.withdrawTitle', lang)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('listingForm.cancel', lang)}
            </Button>
            <Button variant="danger" onClick={confirm}>
              {t('market.withdraw', lang)}
            </Button>
          </>
        }
      >
        <p className="small">{t('market.withdrawBody', lang)}</p>
        <Field label={t('market.withdrawReason', lang)} error={error}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}

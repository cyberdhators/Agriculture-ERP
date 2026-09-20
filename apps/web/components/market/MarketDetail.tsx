'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ListingCard } from '@/components/listings/ListingCard';
import { ProductPage } from '@/components/listings/ProductPage';
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui';
import { CATEGORY_KEY } from '@/lib/farmers/listings';
import { t, type Language } from '@/lib/i18n';
import { fetchListing, toListing } from '@/lib/listings/api-client';
import type { ProduceListing } from '@/lib/fixtures/farmers';
import type { Role } from '@/lib/preview';

import { useMarketModeration } from './moderation';
import {
  liveCount,
  loadMarketRows,
  moreFromSeller,
  similarRows,
  type MarketMode,
  type MarketRow,
} from './marketplace';
import styles from '@/components/listings/listings.module.css';

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
  const [listing, setListing] = useState<ProduceListing | null>(null);
  const [allRows, setAllRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const detailHref = (lid: string) => `${backHref}/${lid}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    Promise.all([fetchListing(id), loadMarketRows()])
      .then(([detail, rows]) => {
        if (cancelled) return;
        setListing(toListing(detail));
        setAllRows(rows);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const row = useMemo(() => {
    if (!listing) return null;
    const found = allRows.find((r) => r.listing.id === id);
    if (found) {
      const override = overrides.get(found.listing.id);
      return override ? { ...found, listing: override } : found;
    }
    return null;
  }, [allRows, id, listing, overrides]);

  if (loading) {
    return (
      <>
        <nav className={styles.breadcrumb} aria-label={t('market.breadcrumb', lang)}>
          <Link href={backHref}>{t('market.title', lang)}</Link>
        </nav>
        <p className="muted" style={{ padding: 'var(--s-6)' }}>
          {t('market.loading', lang)}
        </p>
      </>
    );
  }

  if (notFound || !row) {
    return (
      <>
        <nav className={styles.breadcrumb} aria-label={t('market.breadcrumb', lang)}>
          <Link href={backHref}>{t('market.title', lang)}</Link>
        </nav>
        <Notice kind="info">
          <p className="small">{t('market.notFound', lang)}</p>
        </Notice>
      </>
    );
  }

  const { listing: currentListing, seller } = row;
  const canModerate =
    mode === 'staff' &&
    (role === 'admin' || role === 'supervisor') &&
    currentListing.status === 'listed';
  const withdrawnReason = reasons.get(currentListing.id);
  const more = moreFromSeller(allRows, seller.id, currentListing.id);
  const similar = similarRows(allRows, currentListing.category, currentListing.id);

  function confirm() {
    if (reason.trim().length < 3) {
      setError(t('market.withdrawReasonError', lang));
      return;
    }
    withdraw(currentListing, reason.trim());
    setOpen(false);
  }

  const breadcrumb = (
    <nav className={styles.breadcrumb} aria-label={t('market.breadcrumb', lang)}>
      <Link href={backHref}>{t('market.title', lang)}</Link>
      <span className={styles.breadcrumbSep} aria-hidden>
        ›
      </span>
      <span>{t(CATEGORY_KEY[currentListing.category], lang)}</span>
      <span className={styles.breadcrumbSep} aria-hidden>
        ›
      </span>
      <span className={styles.breadcrumbCurrent} dir="auto">
        {currentListing.title}
      </span>
    </nav>
  );

  const relatedBlock = (title: string, list: MarketRow[]) =>
    list.length > 0 ? (
      <section className={styles.relatedRow}>
        <div className={styles.ruledHead}>
          <h2>{title}</h2>
          <span className={styles.ruledCount}>{list.length}</span>
        </div>
        <div className={styles.featured}>
          {list.map(({ listing: l, seller: s }) => (
            <ListingCard key={l.id} listing={l} seller={s} lang={lang} href={detailHref(l.id)} />
          ))}
        </div>
      </section>
    ) : null;

  return (
    <>
      {withdrawnReason ? (
        <Notice kind="warn" title={t('market.withdrawnBy', lang)}>
          <p className="small" dir="auto">
            {withdrawnReason}
          </p>
        </Notice>
      ) : null}

      <ProductPage
        listing={currentListing}
        seller={seller}
        sellerListingCount={liveCount(allRows, seller.id)}
        lang={lang}
        breadcrumb={breadcrumb}
        sellerListingsHref={backHref}
        moderate={
          canModerate ? (
            <section id="moderate" className={styles.moderation}>
              <span className={styles.moderationTitle}>{t('market.moderate', lang)}</span>
              <p className={styles.moderationBody}>{t('market.moderateNote', lang)}</p>
              <Button variant="danger" onClick={() => setOpen(true)}>
                {t('market.withdraw', lang)}
              </Button>
            </section>
          ) : undefined
        }
        related={
          <>
            {relatedBlock(t('market.moreFromSeller', lang), more)}
            {relatedBlock(
              `${t('market.similar', lang)} ${t(CATEGORY_KEY[currentListing.category], lang)}`,
              similar,
            )}
          </>
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

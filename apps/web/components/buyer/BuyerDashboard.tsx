'use client';

import { useEffect, useState } from 'react';

import { getSummary, type BuyerSummary } from '@/lib/buyer/api';
import { useCart } from '@/lib/buyer/cart';
import { categoryLabelOf, showsStandingStamp, verificationMessage } from '@/lib/buyer/labels';
import { t } from '@/lib/i18n';

import { ShortcutHub } from '../account/ShortcutHub';
import { ButtonLink, Notice, PageHeader } from '../ui';
import { CardSkeleton, ChartCard, StatCard, StatGrid } from '../ui/data';
import { useBuyer } from './BuyerShell';
import styles from './buyer.module.css';

/**
 * THE BUYER DASHBOARD (C-14B.5, C-14B.19).
 *
 * Every figure is from GET /api/buyer/summary, which counts in the database.
 * Where a figure cannot be sourced -- the marketplace, for an account whose
 * standing does not allow browsing -- the card says "Not measured" and why,
 * rather than printing a zero that would read as a fact.
 *
 * The charts are the kit's plain-HTML bars: each value is printed beside its
 * bar, so the numbers are read, not inferred from a picture.
 */
export function BuyerDashboard() {
  const { profile, language } = useBuyer();
  const [summary, setSummary] = useState<BuyerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getSummary()
      .then((s) => live && setSummary(s))
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : t('buyer.dash.notLoaded', language)),
      );
    return () => {
      live = false;
    };
  }, [language]);

  const standing = profile.verification.status;
  const kpis = summary?.kpis;
  const cart = useCart();

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={profile.organization.name}
        title={t('buyer.dash.title', language)}
        subtitle={t('buyer.dash.welcome', language).replace('{name}', profile.person.given_name)}
        actions={
          profile.verification.capabilities.browse ? (
            <ButtonLink href="/buyer/marketplace">{t('buyer.dash.browse', language)}</ButtonLink>
          ) : null
        }
      />

      {/* 2026-10-31: an organisation's verification is a badge; an individual has none. */}
      {standing !== 'verified' &&
      standing !== 'not_required' &&
      showsStandingStamp(profile.organization.account_type, standing) ? (
        <Notice
          kind={standing === 'suspended' ? 'error' : 'info'}
          title={t('buyer.dash.standingTitle', language)}
        >
          <p>{verificationMessage(standing, language)}</p>
          {profile.verification.note ? (
            <p className="small">
              {t('buyer.dash.teamNote', language)}{' '}
              <span dir="auto">{profile.verification.note}</span>
            </p>
          ) : null}
        </Notice>
      ) : null}

      {/* 2026-10-28: one home for every ordinary function (infographic no. 4). */}
      <ShortcutHub shell="buyer" language={language} />

      {error ? (
        <Notice kind="error" title={t('buyer.dash.loadFailed', language)}>
          {error}
        </Notice>
      ) : !kpis || !summary ? (
        <CardSkeleton count={6} />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label={t('buyer.dash.requestsSent', language)}
              value={kpis.active_purchase_requests}
              note={t('buyer.dash.requestsSentNote', language)}
            />
            <StatCard
              label={t('buyer.dash.available', language)}
              value={kpis.available_products}
              note={t('buyer.dash.availableNote', language)}
              unmeasuredBecause={t('buyer.dash.availableUnmeasured', language)}
              unmeasuredLabel={t('buyer.dash.notMeasured', language)}
            />
            <StatCard
              label={t('buyer.dash.inCart', language)}
              value={cart.length}
              note={
                cart.length > 0
                  ? t('buyer.dash.inCartNote', language)
                  : t('buyer.dash.inCartEmpty', language)
              }
              attention={cart.length > 0}
            />
          </StatGrid>

          <div className={styles.grid2}>
            {summary.supply ? (
              <ChartCard
                title={t('buyer.dash.supply', language)}
                note={t('buyer.dash.supplyNote', language)}
                data={summary.supply.by_category.map((r) => ({
                  key: r.category,
                  label: categoryLabelOf(r.category, language),
                  value: r.listings,
                }))}
                empty={t('buyer.dash.noSupply', language)}
              />
            ) : null}

            {summary.supply ? (
              <ChartCard
                title={t('buyer.dash.where', language)}
                note={t('buyer.dash.whereNote', language)}
                data={summary.supply.by_state.map((r) => ({
                  key: r.state_id,
                  label: r.state,
                  value: r.listings,
                }))}
                empty={t('buyer.dash.noSupply', language)}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

import { getSummary, type BuyerSummary } from '@/lib/buyer/api';
import { useCart } from '@/lib/buyer/cart';
import { CATEGORY_LABELS, VERIFICATION_MESSAGES, labelOf } from '@/lib/buyer/labels';

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
  const { profile } = useBuyer();
  const [summary, setSummary] = useState<BuyerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getSummary()
      .then((s) => live && setSummary(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Not loaded.'));
    return () => {
      live = false;
    };
  }, []);

  const standing = profile.verification.status;
  const kpis = summary?.kpis;
  const cart = useCart();

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={profile.organization.name}
        title="Dashboard"
        subtitle={`Welcome, ${profile.person.given_name}.`}
        actions={
          profile.verification.capabilities.browse ? (
            <ButtonLink href="/buyer/marketplace">Browse the marketplace</ButtonLink>
          ) : null
        }
      />

      {standing !== 'verified' && standing !== 'not_required' ? (
        <Notice
          kind={standing === 'rejected' || standing === 'suspended' ? 'error' : 'info'}
          title="Account status"
        >
          <p>{VERIFICATION_MESSAGES[standing]}</p>
          {profile.verification.note ? (
            <p className="small">Note from the AgriOne team: {profile.verification.note}</p>
          ) : null}
        </Notice>
      ) : null}

      {error ? (
        <Notice kind="error" title="The dashboard could not be loaded">
          {error}
        </Notice>
      ) : !kpis || !summary ? (
        <CardSkeleton count={6} />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Requests sent"
              value={kpis.active_purchase_requests}
              note="Waiting for, or answered by, the farmer"
            />
            <StatCard
              label="Available products"
              value={kpis.available_products}
              note="Listed in the marketplace now"
              unmeasuredBecause="The marketplace is closed to this account at its current standing."
            />
            <StatCard
              label="In your cart"
              value={cart.length}
              note={
                cart.length > 0
                  ? 'Not yet sent to the farmers'
                  : 'Add products from the marketplace'
              }
              attention={cart.length > 0}
            />
          </StatGrid>

          <div className={styles.grid2}>
            {summary.supply ? (
              <ChartCard
                title="Supply available now"
                note="Listings in the marketplace, by category"
                data={summary.supply.by_category.map((r) => ({
                  key: r.category,
                  label: labelOf(CATEGORY_LABELS, r.category),
                  value: r.listings,
                }))}
                empty="No produce is listed at the moment."
              />
            ) : null}

            {summary.supply ? (
              <ChartCard
                title="Where supply is"
                note="Listings in the marketplace, by state"
                data={summary.supply.by_state.map((r) => ({
                  key: r.state_id,
                  label: r.state,
                  value: r.listings,
                }))}
                empty="No produce is listed at the moment."
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

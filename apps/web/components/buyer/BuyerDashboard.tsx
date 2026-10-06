'use client';

import { useEffect, useState } from 'react';

import { getSummary, type BuyerSummary } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  ORDER_STATUS_LABELS,
  VERIFICATION_MESSAGES,
  formatMonth,
  formatQuantity,
  formatSsp,
  labelOf,
} from '@/lib/buyer/labels';

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
  const months = summary?.procurement.purchases_by_month ?? [];
  const monthMax = months.reduce((m, r) => Math.max(m, r.total_ssp), 0);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={profile.organization.name}
        title="Procurement dashboard"
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
            <p className="small">Note from CORWADO: {profile.verification.note}</p>
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
              label="Active purchase requests"
              value={kpis.active_purchase_requests}
              note={`${kpis.draft_purchase_requests} draft${kpis.draft_purchase_requests === 1 ? '' : 's'} not yet sent`}
            />
            <StatCard
              label="Available products"
              value={kpis.available_products}
              note="Listed in the marketplace now"
              unmeasuredBecause="The marketplace is closed to this account at its current standing."
            />
            <StatCard
              label="Pending orders"
              value={kpis.pending_orders}
              note="Arranged, awaiting confirmation"
              attention={kpis.pending_orders > 0}
            />
            <StatCard
              label="Confirmed orders"
              value={kpis.orders_in_progress}
              note="Confirmed through in transit"
            />
            <StatCard
              label="Completed purchases"
              value={kpis.completed_purchases}
              note="Delivered or completed"
            />
            <StatCard
              label="Total quantity purchased"
              value={
                kpis.total_quantity_purchased.length === 0
                  ? 0
                  : kpis.total_quantity_purchased
                      .map((q) => formatQuantity(q.quantity, q.unit))
                      .join(' · ')
              }
              note="Delivered or completed, per unit — never summed across units"
            />
          </StatGrid>

          <div className={styles.grid2}>
            <ChartCard
              title="Purchases over time"
              note="Value of orders placed each month, last 12 months, excluding cancelled"
            >
              <div
                className={styles.months}
                role="img"
                aria-label={months
                  .map(
                    (m) => `${formatMonth(m.month)}: ${formatSsp(m.total_ssp)}, ${m.orders} orders`,
                  )
                  .join('; ')}
              >
                {months.map((m) => (
                  <div key={m.month} className={styles.monthCol}>
                    <span
                      className={`${styles.monthBar} ${m.total_ssp === 0 ? styles.monthBarEmpty : ''}`}
                      style={{
                        blockSize:
                          monthMax === 0 ? '1px' : `${Math.round((m.total_ssp / monthMax) * 100)}%`,
                      }}
                      title={`${formatMonth(m.month)}: ${formatSsp(m.total_ssp)}`}
                    />
                    <span className={styles.monthLabel}>{formatMonth(m.month).slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </ChartCard>

            <ChartCard
              title="Orders by status"
              note="Every order your organisation has, by where it stands"
              data={summary.procurement.orders_by_status.map((r) => ({
                key: r.status,
                label: labelOf(ORDER_STATUS_LABELS, r.status),
                value: r.n,
                pending: r.status === 'pending',
              }))}
              empty="No orders yet. Orders appear here once CORWADO arranges one from your requests."
            />

            <ChartCard
              title="Categories purchased"
              note="Number of orders per product category, excluding cancelled"
              data={summary.procurement.categories_purchased.map((r) => ({
                key: r.category,
                label: `${labelOf(CATEGORY_LABELS, r.category)} — ${formatSsp(r.total_ssp)}`,
                value: r.orders,
              }))}
              empty="Nothing purchased yet."
            />

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

'use client';

import { useMemo } from 'react';

import { EmptyState, KpiStrip, PageHeader, Stamp } from '@/components/ui';
import { listingStamp } from '@/lib/farmers/listings';
import { scopeFarmers, SCOPE_STATE } from '@/lib/farmers/presentation';
import {
  FARMERS,
  LISTINGS,
  STATE_NAMES,
  farmerPayamName,
  type ListingStatus,
} from '@/lib/fixtures/farmers';
import { CROP_LABELS, formatPhone, pluralise } from '@/lib/format';
import { usePreview } from '@/lib/preview';

import screens from '@/components/screens.module.css';

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Draft',
  listed: 'Listed',
  withdrawn: 'Withdrawn',
  sold: 'Sold',
};

/**
 * Market information (deliverable q): every produce listing on the register,
 * joined to the farmer who offers it and scoped to what the preview role may
 * see — the same authorization law the farmers register follows. Read-only
 * here; matching buyers to sellers is the officer's job in the field.
 */
export function Market() {
  const { role, hydrated } = usePreview();

  const rows = useMemo(() => {
    const inScope = new Set(scopeFarmers(FARMERS, role).map((f) => f.id));
    return LISTINGS.filter((l) => inScope.has(l.farmer_id))
      .map((l) => ({ listing: l, farmer: FARMERS.find((f) => f.id === l.farmer_id)! }))
      .filter((r) => r.farmer)
      .sort((a, b) => b.listing.updated_at.localeCompare(a.listing.updated_at));
  }, [role]);

  const listed = rows.filter((r) => r.listing.status === 'listed').length;
  const scopeName = role === 'admin' ? 'All states' : STATE_NAMES[SCOPE_STATE];

  return (
    <>
      <PageHeader
        eyebrow={`Market · ${scopeName}`}
        title="Market information"
        subtitle="Produce farmers are offering, with quantity, price and where to find it. Scoped to your caseload; listed produce comes only from verified farmers."
      />

      <div style={{ marginBottom: 'var(--s-6)' }}>
        <KpiStrip
          label="Market totals"
          items={[
            { label: 'Listings', value: rows.length },
            { label: 'Listed now', value: listed, accent: true },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No produce in scope"
          body="No farmer in your caseload has offered produce yet. Farmers add produce from their own account once verified."
        />
      ) : (
        <div className={screens.tableWrap}>
          <table className={screens.table}>
            <thead>
              <tr>
                <th scope="col">Farmer</th>
                <th scope="col">Crop</th>
                <th scope="col">Quantity</th>
                <th scope="col">Price</th>
                <th scope="col">Payam</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ listing, farmer }) => (
                <tr key={listing.id}>
                  <td>
                    <span dir="auto">
                      {farmer.given_name} {farmer.family_name}
                    </span>
                    <br />
                    <span className="mono small muted">{formatPhone(farmer.phone)}</span>
                  </td>
                  <td>{CROP_LABELS[listing.crop]}</td>
                  <td className={`${screens.tdNum} mono`}>
                    {listing.quantity_kg.toLocaleString()} kg
                  </td>
                  <td className={`${screens.tdNowrap} mono`}>
                    {listing.price_ssp_per_kg !== null ? (
                      `${listing.price_ssp_per_kg.toLocaleString()} SSP/kg`
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className={screens.tdNowrap}>{farmerPayamName(farmer.payam_id)}</td>
                  <td>
                    <Stamp kind={listingStamp(listing.status)}>
                      {STATUS_LABEL[listing.status]}
                    </Stamp>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hydrated ? (
        <p className={screens.resultLine} aria-live="polite">
          Showing {pluralise(rows.length, 'listing')} in scope
        </p>
      ) : null}
    </>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BuyerApiError, getListing, type MarketListing } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  GRADE_LABELS,
  UNIT_LABELS,
  formatQuantity,
  formatSsp,
  labelOf,
} from '@/lib/buyer/labels';

import { Card, CardBody, CardHeader, DefinitionList, EmptyState, PageHeader, Stamp } from '../ui';
import { LoadingState } from '../ui/data';
import { RequestForm } from './RequestForm';
import styles from './buyer.module.css';

/**
 * ONE PRODUCT, AS A BUYER MAY SEE IT (C-14B.10).
 *
 * The supplier block is the whole of what the route returns about the
 * seller: a trading name, whether the farmer is verified, and the payam,
 * county and state. The purchase request is raised beside it.
 */
export function BuyerProductDetail({ id }: { id: string }) {
  const [listing, setListing] = useState<MarketListing | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'closed' | 'error'>(
    'loading',
  );

  useEffect(() => {
    let live = true;
    getListing(id)
      .then((l) => {
        if (!live) return;
        setListing(l);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!live) return;
        const status = e instanceof BuyerApiError ? e.status : 0;
        setState(status === 404 ? 'missing' : status === 403 ? 'closed' : 'error');
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (state === 'loading') return <LoadingState label="Loading the product" rows={5} />;
  if (state !== 'ready' || !listing) {
    return (
      <EmptyState
        error={state === 'error'}
        title={
          state === 'missing'
            ? 'This product is no longer listed'
            : state === 'closed'
              ? 'The marketplace is closed to this account'
              : 'This product could not be loaded'
        }
        body={
          state === 'missing'
            ? 'It may have sold, been withdrawn, or never existed. Go back to the marketplace to see what is listed now.'
            : 'Go back to the marketplace and try again.'
        }
        actions={<Link href="/buyer/marketplace">Back to the marketplace</Link>}
      />
    );
  }

  return (
    <div className={styles.page}>
      <Link href="/buyer/marketplace" className="small">
        ← Marketplace
      </Link>
      <PageHeader
        eyebrow={labelOf(CATEGORY_LABELS, listing.category)}
        title={listing.title}
        subtitle={listing.description || undefined}
      />

      <div className={styles.twoCol}>
        <Card>
          <CardHeader
            title="Request to purchase"
            subtitle="Tell CORWADO how much you need and where."
          />
          <CardBody>
            <RequestForm listing={listing} />
          </CardBody>
        </Card>

        <div className={styles.page}>
          <Card>
            <CardHeader title="Product" />
            <CardBody>
              <DefinitionList
                items={[
                  { term: 'Product', value: listing.product_name },
                  {
                    term: 'Available',
                    value: formatQuantity(listing.available_quantity, listing.unit),
                  },
                  {
                    term: 'Indicative price',
                    value: `${formatSsp(listing.indicative_price_ssp)} per ${labelOf(UNIT_LABELS, listing.price_per)}${listing.negotiable ? ' · negotiable' : ''}`,
                  },
                  {
                    term: 'Minimum order',
                    value:
                      listing.min_order_quantity === null
                        ? 'None stated'
                        : formatQuantity(listing.min_order_quantity, listing.unit),
                  },
                  { term: 'Quality', value: labelOf(GRADE_LABELS, listing.quality_grade) },
                  {
                    term: 'Availability',
                    value: listing.available_until
                      ? `${listing.available_from} to ${listing.available_until}`
                      : `From ${listing.available_from}`,
                  },
                  { term: 'Production period', value: listing.production_period ?? 'Not stated' },
                  {
                    term: 'Delivery',
                    value: listing.delivery_available ? 'Supplier can deliver' : 'Collection only',
                  },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Supplier" />
            <CardBody>
              <DefinitionList
                items={[
                  {
                    term: 'Trading name',
                    value: <span dir="auto">{listing.supplier.trading_name}</span>,
                  },
                  {
                    term: 'Standing',
                    value: listing.supplier.verified ? (
                      <Stamp kind="verified">Verified farmer</Stamp>
                    ) : (
                      <Stamp kind="pending">Not yet verified</Stamp>
                    ),
                  },
                  {
                    term: 'Location',
                    value: `${listing.location.payam}, ${listing.location.county}, ${listing.location.state}`,
                  },
                ]}
              />
              <p className={styles.muted}>
                Supplier contact details are not shared. CORWADO introduces buyers and suppliers
                once a request is accepted.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

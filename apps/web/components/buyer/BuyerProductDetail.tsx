'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { LISTING_UNITS } from '@agri-erp/shared';

import { BuyerApiError, getListing, type MarketListing } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  GRADE_LABELS,
  UNIT_LABELS,
  formatQuantity,
  formatSsp,
  labelOf,
} from '@/lib/buyer/labels';
import { addToCart, useCart } from '@/lib/buyer/cart';
import { formatPhone } from '@/lib/format';

import {
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Stamp,
} from '../ui';
import { LoadingState } from '../ui/data';
import styles from './buyer.module.css';

/**
 * ONE PRODUCT, AS A BUYER MAY SEE IT (C-14B.10).
 *
 * The supplier block is what the route returns about the seller: a trading
 * name, whether the farmer is verified, and the payam, county and state --
 * and, once this buyer has sent a request for the product, the farmer's phone
 * (B14: buyer and farmer deal directly). Products go into the cart, and the
 * cart sends one request to each farmer.
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
            title="Buy from this farmer"
            subtitle="Add it to your cart. You can add products from other farmers and send them all together."
          />
          <CardBody>
            <AddToCart listing={listing} />
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
              {listing.farmer_phone ? (
                <div className={styles.actions}>
                  <ButtonLink href={`tel:${listing.farmer_phone}`}>
                    Call {formatPhone(listing.farmer_phone)}
                  </ButtonLink>
                  <ButtonLink
                    variant="secondary"
                    href={`https://wa.me/${listing.farmer_phone.replace(/\D/g, '')}`}
                  >
                    WhatsApp
                  </ButtonLink>
                </div>
              ) : (
                <p className={styles.muted}>
                  The farmer&apos;s phone number is shown here once you send them a request.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Quantity and unit for this product, into the cart (B14). */
function AddToCart({ listing }: { listing: MarketListing }) {
  const cart = useCart();
  const inCart = cart.find((l) => l.listing_id === listing.id);
  const [quantity, setQuantity] = useState(
    String(inCart?.quantity ?? listing.min_order_quantity ?? ''),
  );
  const [unit, setUnit] = useState(inCart?.unit ?? listing.unit);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const q = Number(quantity);
    if (quantity.trim() === '' || !Number.isFinite(q) || q <= 0) {
      setError('Enter how much you want, as a number greater than zero.');
      return;
    }
    if (
      listing.min_order_quantity !== null &&
      unit === listing.unit &&
      q < listing.min_order_quantity
    ) {
      setError(
        `The farmer's minimum order is ${formatQuantity(listing.min_order_quantity, listing.unit)}.`,
      );
      return;
    }
    const ok = addToCart({
      listing_id: listing.id,
      title: listing.title,
      product_name: listing.product_name,
      trading_name: listing.supplier.trading_name,
      location: `${listing.location.payam}, ${listing.location.state}`,
      quantity: q,
      unit,
      price_ssp: listing.indicative_price_ssp,
      price_per: listing.price_per,
    });
    if (!ok) {
      setError('Your cart is full. Send it first, then add more.');
      return;
    }
    setError(null);
    setAdded(true);
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-label="Add to cart">
      {added || inCart ? (
        <Notice kind="success" title={added ? 'Added to your cart' : 'In your cart'}>
          <Link href="/buyer/cart">Go to the cart ({cart.length})</Link> or{' '}
          <Link href="/buyer/marketplace">keep shopping</Link>.
        </Notice>
      ) : null}
      <div className={styles.formGrid}>
        <Field
          label="Quantity"
          error={error ?? undefined}
          hint={
            listing.min_order_quantity
              ? `Minimum order ${formatQuantity(listing.min_order_quantity, listing.unit)}`
              : `Available ${formatQuantity(listing.available_quantity, listing.unit)}`
          }
        >
          {(ids) => (
            <Input
              {...ids}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setAdded(false);
              }}
            />
          )}
        </Field>
        <Field label="Unit">
          {(ids) => (
            <Select {...ids} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {LISTING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className={styles.actions}>
        <Button type="submit">{inCart ? 'Update cart' : 'Add to cart'}</Button>
      </div>
    </form>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { LISTING_UNITS } from '@agri-erp/shared';

import { BuyerApiError, getListing, type MarketListing } from '@/lib/buyer/api';
import { categoryLabelOf, formatSsp, unitLabel } from '@/lib/buyer/labels';
import { addToCart, useCart } from '@/lib/buyer/cart';
import { formatPhone } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

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
} from '../ui';
import { MessageButton } from '../messages/MessageButton';
import { ProfileLink } from '../profiles/PublicProfile';
import { LoadingState } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { gradeIn, perUnitIn, quantityIn } from './Timeline';
import styles from './buyer.module.css';
import { DirArrow } from '@/components/ui/icons';

/**
 * ONE PRODUCT, AS A BUYER MAY SEE IT (C-14B.10).
 *
 * The supplier block is what the route returns about the seller: a trading
 * name and the payam, county and state (2026-10-31: no farmer verification) --
 * and, once this buyer has sent a request for the product, the farmer's phone
 * (B14: buyer and farmer deal directly). Products go into the cart, and the
 * cart sends one request to each farmer.
 */
export function BuyerProductDetail({ id }: { id: string }) {
  const { language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
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

  if (state === 'loading') return <LoadingState label={w('buyer.product.loading')} rows={5} />;
  if (state !== 'ready' || !listing) {
    return (
      <EmptyState
        error={state === 'error'}
        title={w(
          state === 'missing'
            ? 'buyer.product.missing'
            : state === 'closed'
              ? 'buyer.mkt.closed'
              : 'buyer.product.loadFailed',
        )}
        body={w(state === 'missing' ? 'buyer.product.missingBody' : 'buyer.product.failedBody')}
        actions={<Link href="/buyer/marketplace">{w('buyer.product.back')}</Link>}
      />
    );
  }

  return (
    <div className={styles.page}>
      <Link href="/buyer/marketplace" className="small">
        <DirArrow back /> {w('buyer.nav.marketplace')}
      </Link>
      <PageHeader
        eyebrow={categoryLabelOf(listing.category, language)}
        title={listing.title}
        subtitle={listing.description || undefined}
      />

      <div className={styles.twoCol}>
        <Card>
          {/* 2026-10-31: the title alone; the cart says the rest. */}
          <CardHeader title={w('buyer.product.buy')} />
          <CardBody>
            <AddToCart listing={listing} language={language} />
          </CardBody>
        </Card>

        <div className={styles.page}>
          <Card>
            <CardHeader title={w('buyer.w.details')} />
            <CardBody>
              <DefinitionList
                items={[
                  { term: w('buyer.w.product'), value: listing.product_name },
                  {
                    term: w('buyer.product.available'),
                    value: quantityIn(listing.available_quantity, listing.unit, language),
                  },
                  {
                    term: w('buyer.product.price'),
                    value: `${formatSsp(listing.indicative_price_ssp)} ${perUnitIn(listing.price_per, language)}${listing.negotiable ? ` · ${w('buyer.product.negotiable')}` : ''}`,
                  },
                  {
                    term: w('buyer.product.minOrder'),
                    value:
                      listing.min_order_quantity === null
                        ? w('buyer.product.noneStated')
                        : quantityIn(listing.min_order_quantity, listing.unit, language),
                  },
                  {
                    term: w('buyer.product.quality'),
                    value: gradeIn(listing.quality_grade, language),
                  },
                  {
                    term: w('buyer.product.availability'),
                    value: listing.available_until
                      ? w('buyer.product.fromTo')
                          .replace('{from}', listing.available_from)
                          .replace('{until}', listing.available_until)
                      : w('buyer.product.from').replace('{from}', listing.available_from),
                  },
                  {
                    term: w('buyer.product.period'),
                    value: listing.production_period ?? w('buyer.product.notStated'),
                  },
                  {
                    term: w('buyer.cart.delivery'),
                    value: w(
                      listing.delivery_available
                        ? 'buyer.product.canDeliver'
                        : 'buyer.product.collect',
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={w('buyer.w.supplier')} />
            <CardBody>
              <DefinitionList
                items={[
                  {
                    term: w('buyer.product.tradingName'),
                    value: <span dir="auto">{listing.supplier.trading_name}</span>,
                  },
                  {
                    term: w('buyer.product.location'),
                    value: `${listing.location.payam}, ${listing.location.county}, ${listing.location.state}`,
                  },
                ]}
              />
              {listing.farmer_phone ? (
                <div className={styles.actions}>
                  <ButtonLink href={`tel:${listing.farmer_phone}`}>
                    {w('buyer.w.call')} <span dir="ltr">{formatPhone(listing.farmer_phone)}</span>
                  </ButtonLink>
                  <ButtonLink
                    variant="secondary"
                    href={`https://wa.me/${listing.farmer_phone.replace(/\D/g, '')}`}
                  >
                    {w('buyer.w.whatsapp')}
                  </ButtonLink>
                </div>
              ) : (
                <p className={styles.muted}>
                  {w(
                    listing.phone_on_request === false
                      ? 'buyer.w.prefersMessages'
                      : 'buyer.product.phoneLater',
                  )}
                </p>
              )}
              <MessageButton
                postKind="listing"
                postId={listing.id}
                allowed={listing.messages_allowed !== false}
                language={language}
              />
              <ProfileLink kind="listing" id={listing.id} language={language} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Quantity and unit for this product, into the cart (B14). */
function AddToCart({ listing, language }: { listing: MarketListing; language: Language }) {
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
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
      setError(w('buyer.product.enterQuantity'));
      return;
    }
    if (
      listing.min_order_quantity !== null &&
      unit === listing.unit &&
      q < listing.min_order_quantity
    ) {
      setError(
        w('buyer.product.belowMin').replace(
          '{quantity}',
          quantityIn(listing.min_order_quantity, listing.unit, language),
        ),
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
      setError(w('buyer.product.cartFull'));
      return;
    }
    setError(null);
    setAdded(true);
  };

  return (
    <form
      className={styles.form}
      onSubmit={onSubmit}
      noValidate
      aria-label={w('buyer.product.add')}
    >
      {added || inCart ? (
        <Notice kind="success" title={w(added ? 'buyer.product.added' : 'buyer.product.inCart')}>
          <Link href="/buyer/cart">
            {w('buyer.product.goCart').replace('{n}', String(cart.length))}
          </Link>{' '}
          {w('buyer.product.or')}{' '}
          <Link href="/buyer/marketplace">{w('buyer.product.keepShopping')}</Link>.
        </Notice>
      ) : null}
      <div className={styles.formGrid}>
        <Field
          label={w('buyer.w.quantity')}
          error={error ?? undefined}
          hint={
            listing.min_order_quantity
              ? `${w('buyer.product.minOrder')} ${quantityIn(listing.min_order_quantity, listing.unit, language)}`
              : `${w('buyer.product.available')} ${quantityIn(listing.available_quantity, listing.unit, language)}`
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
        <Field label={w('buyer.w.unit')}>
          {(ids) => (
            <Select {...ids} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {LISTING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u, language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className={styles.actions}>
        <Button type="submit">{w(inCart ? 'buyer.product.update' : 'buyer.product.add')}</Button>
      </div>
    </form>
  );
}

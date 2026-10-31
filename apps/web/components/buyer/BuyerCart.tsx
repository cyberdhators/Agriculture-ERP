'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { LISTING_UNITS, cartCheckoutSchema, zodErrorToApiError } from '@agri-erp/shared';

import { BuyerApiError, checkoutCart } from '@/lib/buyer/api';
import { clearCart, removeFromCart, updateCartLine, useCart } from '@/lib/buyer/cart';
import { formatSsp, unitLabel } from '@/lib/buyer/labels';
import { t, tCount } from '@/lib/i18n';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
} from '../ui';
import { useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import { perUnitIn } from './Timeline';
import styles from './buyer.module.css';

/**
 * THE CART (B14). Products from any number of farmers, sent together: each
 * line becomes its own request to the farmer who listed it, each farmer is
 * alerted, and the buyer is given each farmer's phone number on the request.
 */
export function BuyerCart() {
  const lines = useCart();
  const router = useRouter();
  const toast = useToast();
  const { profile, language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const canSend = profile.verification.capabilities.request;

  const [delivery, setDelivery] = useState(profile.procurement.delivery_locations[0] ?? '');
  const [requiredBy, setRequiredBy] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lines.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader title={w('buyer.nav.cart')} />
        <EmptyState
          art="cart"
          title={w('buyer.cart.emptyTitle')}
          body={w('buyer.cart.emptyBody')}
          actions={<Link href="/buyer/marketplace">{w('buyer.cart.goMarket')}</Link>}
        />
      </div>
    );
  }

  const farmers = new Set(lines.map((l) => l.trading_name)).size;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const body = {
      items: lines.map((l) => ({
        listing_id: l.listing_id,
        quantity: l.quantity,
        unit: l.unit,
        ...(l.notes?.trim() ? { notes: l.notes } : {}),
      })),
      delivery_location: delivery,
      ...(requiredBy ? { required_by: requiredBy } : {}),
    };
    const parsed = cartCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const sent = await checkoutCart(parsed.data);
      clearCart();
      toast.show({
        kind: 'success',
        title: tCount('buyer.cart.sent', sent.length, language),
        body: w('buyer.cart.sentBody'),
      });
      router.push('/buyer/purchase-requests');
    } catch (error) {
      if (error instanceof BuyerApiError) {
        setErrors(error.fields);
        setFailure(error.message);
      } else {
        setFailure(w('buyer.cart.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title={w('buyer.nav.cart')}
        subtitle={w('buyer.cart.summary')
          .replace('{products}', tCount('buyer.cart.products', lines.length, language))
          .replace('{farmers}', tCount('buyer.cart.farmers', farmers, language))}
      />

      {failure ? (
        <Notice kind="error" title={w('buyer.w.notSent')}>
          {failure}
        </Notice>
      ) : null}
      {!canSend ? (
        <Notice kind="info" title={w('buyer.cart.cannotSend')}>
          {w('buyer.cart.contactCorwado')}
        </Notice>
      ) : null}

      <form className={styles.page} onSubmit={(e) => void onSubmit(e)} noValidate>
        {lines.map((line, i) => (
          <Card key={line.listing_id}>
            {/* 2026-10-31: Remove sits on the line's header, not on a row of its own. */}
            <CardHeader
              title={line.title}
              subtitle={`${line.trading_name} · ${line.location} · ${formatSsp(line.price_ssp)} ${perUnitIn(line.price_per, language)}`}
              actions={
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => removeFromCart(line.listing_id)}
                >
                  {w('buyer.w.remove')}
                </Button>
              }
            />
            <CardBody>
              <div className={styles.formGrid}>
                <Field label={w('buyer.w.quantity')} error={errors[`items.${i}.quantity`]}>
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="decimal"
                      value={Number.isNaN(line.quantity) ? '' : String(line.quantity)}
                      onChange={(e) =>
                        updateCartLine(line.listing_id, {
                          quantity:
                            e.target.value.trim() === '' ? Number.NaN : Number(e.target.value),
                        })
                      }
                    />
                  )}
                </Field>
                <Field label={w('buyer.w.unit')} error={errors[`items.${i}.unit`]}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={line.unit}
                      onChange={(e) => updateCartLine(line.listing_id, { unit: e.target.value })}
                    >
                      {LISTING_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {unitLabel(u, language)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className={styles.formGridFull}>
                  <Field
                    label={w('buyer.cart.noteToFarmer')}
                    optional
                    error={errors[`items.${i}.notes`]}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        value={line.notes ?? ''}
                        onChange={(e) => updateCartLine(line.listing_id, { notes: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader title={w('buyer.cart.delivery')} />
          <CardBody>
            <div className={styles.formGrid}>
              <Field
                label={w('buyer.w.deliverTo')}
                error={errors.delivery_location}
                hint={w('buyer.w.deliverToHint')}
              >
                {(ids) => (
                  <Input {...ids} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
                )}
              </Field>
              <Field label={w('buyer.w.neededBy')} optional error={errors.required_by}>
                {(ids) => (
                  <Input
                    {...ids}
                    type="date"
                    value={requiredBy}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setRequiredBy(e.target.value)}
                  />
                )}
              </Field>
            </div>
            {errors.items ? <p className={styles.muted}>{errors.items}</p> : null}
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => clearCart()} disabled={busy}>
                {w('buyer.cart.empty')}
              </Button>
              {canSend ? (
                <Button type="submit" disabled={busy}>
                  {busy ? w('buyer.w.sending') : tCount('buyer.cart.send', lines.length, language)}
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { LISTING_UNITS, cartCheckoutSchema, zodErrorToApiError } from '@agri-erp/shared';

import { BuyerApiError, checkoutCart } from '@/lib/buyer/api';
import { clearCart, removeFromCart, updateCartLine, useCart } from '@/lib/buyer/cart';
import { UNIT_LABELS, formatSsp, labelOf } from '@/lib/buyer/labels';

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
  const { profile } = useBuyer();
  const canSend = profile.verification.capabilities.request;

  const [delivery, setDelivery] = useState(profile.procurement.delivery_locations[0] ?? '');
  const [requiredBy, setRequiredBy] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lines.length === 0) {
    return (
      <div className={styles.page}>
        <PageHeader title="Cart" />
        <EmptyState
          title="Your cart is empty"
          body="Add products from the marketplace, then send them to the farmers together."
          actions={<Link href="/buyer/marketplace">Go to the marketplace</Link>}
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
        title: `${sent.length} request${sent.length === 1 ? '' : 's'} sent`,
        body: 'Each farmer has been alerted. Their phone numbers are on your requests.',
      });
      router.push('/buyer/purchase-requests');
    } catch (error) {
      if (error instanceof BuyerApiError) {
        setErrors(error.fields);
        setFailure(error.message);
      } else {
        setFailure('The cart could not be sent.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Cart"
        subtitle={`${lines.length} product${lines.length === 1 ? '' : 's'} from ${farmers} farmer${farmers === 1 ? '' : 's'}`}
      />

      {failure ? (
        <Notice kind="error" title="Not sent">
          {failure}
        </Notice>
      ) : null}
      {!canSend ? (
        <Notice kind="info" title="Your account must be approved first">
          Business accounts are reviewed before they can send requests. You can keep products in the
          cart meanwhile.
        </Notice>
      ) : null}

      <form className={styles.page} onSubmit={(e) => void onSubmit(e)} noValidate>
        {lines.map((line, i) => (
          <Card key={line.listing_id}>
            <CardHeader
              title={line.title}
              subtitle={`${line.trading_name} · ${line.location} · ${formatSsp(line.price_ssp)} per ${labelOf(UNIT_LABELS, line.price_per)}`}
            />
            <CardBody>
              <div className={styles.formGrid}>
                <Field label="Quantity" error={errors[`items.${i}.quantity`]}>
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
                <Field label="Unit" error={errors[`items.${i}.unit`]}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={line.unit}
                      onChange={(e) => updateCartLine(line.listing_id, { unit: e.target.value })}
                    >
                      {LISTING_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className={styles.formGridFull}>
                  <Field label="Note to the farmer" optional error={errors[`items.${i}.notes`]}>
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
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => removeFromCart(line.listing_id)}>
                  Remove
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader title="Delivery" />
          <CardBody>
            <div className={styles.formGrid}>
              <Field
                label="Deliver to"
                error={errors.delivery_location}
                hint="A town or market, e.g. Juba"
              >
                {(ids) => (
                  <Input {...ids} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
                )}
              </Field>
              <Field label="Needed by" optional error={errors.required_by}>
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
                Empty the cart
              </Button>
              {canSend ? (
                <Button type="submit" disabled={busy}>
                  {busy
                    ? 'Sending…'
                    : `Send ${lines.length} request${lines.length === 1 ? '' : 's'}`}
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

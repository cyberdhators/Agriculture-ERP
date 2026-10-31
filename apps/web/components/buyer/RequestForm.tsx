'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import {
  LISTING_CATEGORIES,
  LISTING_UNITS,
  purchaseRequestInputSchema,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { BuyerApiError, createRequest, type MarketListing } from '@/lib/buyer/api';
import { categoryLabel, unitLabel } from '@/lib/buyer/labels';
import { t } from '@/lib/i18n';

import { Button, Field, Input, Notice, Select, Textarea } from '../ui';
import { useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import styles from './buyer.module.css';

/**
 * A NEW PURCHASE REQUEST (C-14B.11).
 *
 * Validated here by the same shared schema the route runs, so the form and the
 * server cannot disagree; the server's own field reasons are shown if it
 * refuses anyway. Raised from a listing, the product and category are the
 * listing's and are not editable -- the route stores the listing's, so letting
 * them be typed would only let the form claim something the record will not.
 *
 * "Send" is offered only to a verified organisation; anyone in good standing
 * may save a draft. The route enforces both; the form only explains them.
 */
export function RequestForm({ listing }: { listing?: MarketListing }) {
  const router = useRouter();
  const toast = useToast();
  const { profile, language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const canSend = profile.verification.capabilities.request;

  const [form, setForm] = useState({
    category: listing?.category ?? 'crop',
    product_name: listing?.product_name ?? '',
    quantity: listing?.min_order_quantity ? String(listing.min_order_quantity) : '',
    unit: listing?.unit ?? 'kg',
    delivery_location: profile.procurement.delivery_locations[0] ?? '',
    required_by: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const submit = async (send: boolean) => {
    setFailure(null);
    const body = {
      ...(listing ? { listing_id: listing.id } : {}),
      category: form.category,
      product_name: form.product_name,
      quantity: form.quantity.trim() === '' ? Number.NaN : Number(form.quantity),
      unit: form.unit,
      delivery_location: form.delivery_location,
      ...(form.required_by ? { required_by: form.required_by } : {}),
      ...(form.notes.trim() ? { notes: form.notes } : {}),
      submit: send,
    };
    const parsed = purchaseRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const created = await createRequest(parsed.data);
      toast.show({
        kind: 'success',
        title: w(send ? 'buyer.form.sentTitle' : 'buyer.form.draftTitle'),
        body: w(send ? 'buyer.form.sentBody' : 'buyer.form.draftBody'),
      });
      router.push(`/buyer/purchase-requests/${created.id}`);
    } catch (error) {
      if (error instanceof BuyerApiError) {
        setErrors(error.fields);
        setFailure(error.message);
      } else {
        setFailure(w('buyer.form.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(canSend);
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-label={w('buyer.form.aria')}>
      {!canSend ? (
        <Notice kind="info" title={w('buyer.form.draftsOnly')}>
          {w('buyer.form.draftsOnlyBody')}
        </Notice>
      ) : null}
      {failure ? (
        <Notice kind="error" title={w('buyer.w.notSaved')}>
          {failure}
        </Notice>
      ) : null}

      <div className={styles.formGrid}>
        <Field label={w('buyer.w.category')} error={errors.category}>
          {(ids) => (
            <Select
              {...ids}
              value={form.category}
              disabled={Boolean(listing)}
              onChange={(e) => set('category')(e.target.value)}
            >
              {LISTING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c, language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w('buyer.w.product')} error={errors.product_name}>
          {(ids) => (
            <Input
              {...ids}
              value={form.product_name}
              readOnly={Boolean(listing)}
              placeholder={w('buyer.form.productPlaceholder')}
              onChange={(e) => set('product_name')(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={w('buyer.w.quantity')}
          error={errors.quantity}
          hint={
            listing?.min_order_quantity
              ? w('buyer.form.minHint').replace('{n}', String(listing.min_order_quantity))
              : undefined
          }
        >
          {(ids) => (
            <Input
              {...ids}
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => set('quantity')(e.target.value)}
            />
          )}
        </Field>
        <Field label={w('buyer.w.unit')} error={errors.unit}>
          {(ids) => (
            <Select {...ids} value={form.unit} onChange={(e) => set('unit')(e.target.value)}>
              {LISTING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u, language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={w('buyer.w.deliverTo')}
          error={errors.delivery_location}
          hint={w('buyer.w.deliverToHint')}
        >
          {(ids) => (
            <Input
              {...ids}
              value={form.delivery_location}
              onChange={(e) => set('delivery_location')(e.target.value)}
            />
          )}
        </Field>
        <Field label={w('buyer.w.neededBy')} optional error={errors.required_by}>
          {(ids) => (
            <Input
              {...ids}
              type="date"
              value={form.required_by}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => set('required_by')(e.target.value)}
            />
          )}
        </Field>
        <div className={styles.formGridFull}>
          <Field
            label={w('buyer.w.notes')}
            optional
            error={errors.notes}
            hint={w('buyer.form.notesHint')}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                value={form.notes}
                onChange={(e) => set('notes')(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => void submit(false)}>
          {w('buyer.form.saveDraft')}
        </Button>
        {canSend ? (
          <Button type="submit" disabled={busy}>
            {busy ? w('buyer.w.sending') : w('buyer.form.send')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

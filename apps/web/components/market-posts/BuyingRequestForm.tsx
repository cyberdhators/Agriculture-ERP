'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LISTING_CATEGORIES, LISTING_UNITS, buyingRequestSchema } from '@agri-erp/shared';

import css from '@/components/account/settings.module.css';
import { Button, Field, Input, Notice, PrefixedInput, Select, Textarea } from '@/components/ui';
import { CATEGORY_KEY, UNIT_KEY } from '@/lib/farmers/listings';
import { t, type Language } from '@/lib/i18n';
import {
  MarketPostError,
  createBuyingRequest,
  listStates,
  myBuyingRequests,
  newId,
  updateBuyingRequest,
  type BuyingRequest,
} from '@/lib/market-posts/api';
import { renewalDefault } from '@/lib/market-posts/presentation';
import { offered, useArchivedLists } from '@/lib/settings/client';

import { BuyingRequestDetailBody } from './MarketRequests';
import { SwitchRow } from './bits';
import styles from './market-posts.module.css';
import { PageLoading } from '@/components/ui/data';

interface Values {
  display_name: string;
  category: string;
  product_name: string;
  quantity: string;
  unit: string;
  state_id: string;
  location: string;
  needed_by: string;
  price_ssp: string;
  price_per: string;
  negotiable: boolean;
  delivery_terms: string;
  description: string;
  contact_phone: string;
  show_phone: boolean;
}

const EMPTY: Values = {
  display_name: '',
  category: '',
  product_name: '',
  quantity: '',
  unit: '',
  state_id: '',
  location: '',
  needed_by: '',
  price_ssp: '',
  price_per: '',
  negotiable: true,
  delivery_terms: '',
  description: '',
  contact_phone: '',
  show_phone: false,
};

const fromRequest = (r: BuyingRequest): Values => ({
  display_name: r.display_name,
  category: r.category,
  product_name: r.product_name,
  quantity: String(r.quantity),
  unit: r.unit,
  state_id: r.state_id,
  location: r.location,
  needed_by: r.needed_by,
  price_ssp: r.price_ssp === null ? '' : String(r.price_ssp),
  price_per: r.price_per ?? '',
  negotiable: r.negotiable,
  delivery_terms: r.delivery_terms ?? '',
  description: r.description ?? '',
  contact_phone: (r.contact_phone ?? '').replace(/^\+211/, ''),
  show_phone: r.show_phone ?? false,
});

/**
 * LISTINGS LANE (2026-10-19). Post or edit a buying request: "I need X of Y
 * in Z by date". Used by a farmer and by a buyer alike -- who posted it is
 * decided by the server from the signed-in account. Checked here with the same
 * shared schema the route uses, so the two cannot disagree. Needs signal: a
 * buying request is not kept on the phone.
 */
export function BuyingRequestForm({
  lang,
  id,
  listHref,
  defaultName = '',
  defaultStateId = '',
  posterType = 'farmer',
}: {
  lang: Language;
  id?: string;
  listHref: string;
  defaultName?: string;
  defaultStateId?: string;
  /** Who is posting, for the preview's badge only; the server decides. */
  posterType?: 'farmer' | 'buyer';
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    ...EMPTY,
    display_name: defaultName,
    state_id: defaultStateId,
    needed_by: renewalDefault(),
  });
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  /** 2026-10-28 (user journeys): showing the post as the market will, before it is saved. */
  const [previewing, setPreviewing] = useState(false);
  // 2026-10-27 (settings phase 2): archived categories and units.
  const archivedLists = useArchivedLists();

  useEffect(() => {
    listStates()
      .then(setStates)
      .catch(() => setStates([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    myBuyingRequests()
      .then((mine) => {
        const found = mine.find((r) => r.id === id);
        if (found) setValues(fromRequest(found));
        else setFailure(t('requests.notFound', lang));
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id, lang]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  function body(status?: 'draft' | 'active') {
    const out: Record<string, unknown> = {
      display_name: values.display_name,
      category: values.category,
      product_name: values.product_name,
      quantity: values.quantity === '' ? undefined : Number(values.quantity),
      unit: values.unit,
      state_id: values.state_id,
      location: values.location,
      needed_by: values.needed_by,
      price_ssp: values.price_ssp === '' ? null : Number(values.price_ssp),
      price_per: values.price_ssp === '' ? null : values.price_per || null,
      negotiable: values.negotiable,
      delivery_terms: values.delivery_terms,
      description: values.description,
    };
    out.show_phone = values.show_phone;
    if (values.contact_phone.trim() !== '') out.contact_phone = values.contact_phone;
    if (status) out.status = status;
    return out;
  }

  /** The shared schema's verdict on the form as it stands; errors shown. */
  function check(payload: Record<string, unknown>): boolean {
    const result = buyingRequestSchema.safeParse(payload);
    if (result.success) return true;
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return false;
  }

  function openPreview() {
    setFailure(null);
    if (!check(body('active'))) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  async function submit(status?: 'draft' | 'active') {
    setFailure(null);
    const payload = body(status);
    if (!id && !check(payload)) {
      setPreviewing(false);
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFailure(t('requests.needsSignal', lang));
      return;
    }
    setBusy(true);
    try {
      if (id) await updateBuyingRequest(id, payload);
      else await createBuyingRequest({ id: newId(), ...payload });
      router.push(listHref);
    } catch (e) {
      if (e instanceof MarketPostError) {
        setErrors(e.fields);
        setFailure(e.message);
      } else setFailure(t('lifecycle.failed', lang));
      setPreviewing(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoading label={t('market.loading', lang)} />;

  const err = (key: keyof Values) => errors[key] || undefined;
  // 2026-10-27: archived units are not offered for a new request.
  const unitOptions = offered(
    LISTING_UNITS,
    archivedLists?.archived_units,
    values.unit,
    values.price_per,
  ).map((u) => (
    <option key={u} value={u}>
      {t(UNIT_KEY[u], lang)}
    </option>
  ));

  if (previewing) {
    const row: BuyingRequest = {
      id: id ?? 'preview',
      poster_type: posterType,
      display_name: values.display_name,
      verified_organisation: false,
      category: values.category,
      product_name: values.product_name,
      quantity: Number(values.quantity),
      unit: values.unit,
      state_id: values.state_id,
      state_name: states.find((s) => s.id === values.state_id)?.name ?? '',
      location: values.location,
      needed_by: values.needed_by,
      price_ssp: values.price_ssp === '' ? null : Number(values.price_ssp),
      price_per: values.price_ssp === '' ? null : values.price_per || null,
      negotiable: values.negotiable,
      delivery_terms: values.delivery_terms.trim() || null,
      description: values.description.trim() || null,
      phone_shared: values.show_phone,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return (
      <section className={styles.formStack} aria-label={t('posts.previewTitle', lang)}>
        <Notice kind="info" title={t('posts.previewTitle', lang)}>
          <p className="small">{t(id ? 'posts.previewSaved' : 'posts.previewLead', lang)}</p>
        </Notice>
        {failure ? (
          <Notice kind="error">
            <p className="small">{failure}</p>
          </Notice>
        ) : null}
        <div className={styles.detail}>
          <BuyingRequestDetailBody row={row} lang={lang} preview />
        </div>
        <div className={css.actions}>
          {id ? (
            <Button disabled={busy} onClick={() => void submit()}>
              {t('listingForm.save', lang)}
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void submit('active')}>
                {t('lifecycle.publish', lang)}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void submit('draft')}>
                {t('listingForm.saveDraft', lang)}
              </Button>
            </>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setPreviewing(false)}>
            {t('posts.previewEdit', lang)}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
      className={styles.formStack}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(id ? undefined : 'active');
      }}
    >
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {/* 2026-10-31 (the owner's phone screenshots: fields loose on the grey
          ground under a two-sentence lead): the same fields, in the same
          order, grouped on white cards -- what is needed, where and when, the
          price, more about it, and the contact. */}
      <section className={css.formCard}>
        <div className={styles.formGrid}>
          <div className={styles.span2}>
            <Field
              label={t('requests.displayName', lang)}
              hint={t('requests.displayNameHint', lang)}
              error={err('display_name')}
            >
              {(ids) => (
                <Input
                  {...ids}
                  dir="auto"
                  maxLength={120}
                  value={values.display_name}
                  onChange={(e) => set('display_name', e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={t('listingForm.category', lang)} error={err('category')}>
            {(ids) => (
              <Select
                {...ids}
                value={values.category}
                onChange={(e) => set('category', e.target.value)}
              >
                <option value="">{t('register.select', lang)}</option>
                {offered(
                  LISTING_CATEGORIES,
                  archivedLists?.archived_categories,
                  values.category,
                ).map((c) => (
                  <option key={c} value={c}>
                    {t(CATEGORY_KEY[c], lang)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('requests.product', lang)} error={err('product_name')}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={values.product_name}
                onChange={(e) => set('product_name', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('requests.quantity', lang)} error={err('quantity')}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                className="mono"
                value={values.quantity}
                onChange={(e) => set('quantity', e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('listingForm.unit', lang)} error={err('unit')}>
            {(ids) => (
              <Select {...ids} value={values.unit} onChange={(e) => set('unit', e.target.value)}>
                <option value="">{t('register.select', lang)}</option>
                {unitOptions}
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className={css.formCard}>
        <div className={styles.formGrid}>
          <Field label={t('requests.state', lang)} error={err('state_id')}>
            {(ids) => (
              <Select
                {...ids}
                value={values.state_id}
                onChange={(e) => set('state_id', e.target.value)}
              >
                <option value="">{t('register.select', lang)}</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('requests.location', lang)}
            hint={t('requests.locationHint', lang)}
            error={err('location')}
          >
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={values.location}
                onChange={(e) => set('location', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('requests.neededBy', lang)} error={err('needed_by')}>
            {(ids) => (
              <Input
                {...ids}
                type="date"
                className="mono"
                value={values.needed_by}
                onChange={(e) => set('needed_by', e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      <section className={css.formCard}>
        <div className={styles.formGrid}>
          <Field label={t('requests.price', lang)} optional error={err('price_ssp')}>
            {(ids) => (
              <PrefixedInput
                {...ids}
                prefix={t('listings.ssp', lang)}
                inputMode="numeric"
                className="mono"
                value={values.price_ssp}
                onChange={(e) => set('price_ssp', e.target.value.replace(/[^\d]/g, ''))}
              />
            )}
          </Field>
          <Field label={t('listingForm.pricePer', lang)} optional error={err('price_per')}>
            {(ids) => (
              <Select
                {...ids}
                value={values.price_per}
                disabled={values.price_ssp === ''}
                onChange={(e) => set('price_per', e.target.value)}
              >
                <option value="">{t('register.select', lang)}</option>
                {unitOptions}
              </Select>
            )}
          </Field>
        </div>
        <SwitchRow
          label={t('listingForm.negotiable', lang)}
          checked={values.negotiable}
          onChange={(on) => set('negotiable', on)}
        />
      </section>

      <section className={css.formCard}>
        <Field
          label={t('requests.deliveryTerms', lang)}
          hint={t('requests.deliveryHint', lang)}
          optional
          error={err('delivery_terms')}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              dir="auto"
              value={values.delivery_terms}
              onChange={(e) => set('delivery_terms', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('requests.details', lang)} optional error={err('description')}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              dir="auto"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
      </section>

      <section className={css.formCard}>
        <Field
          label={t('listingForm.contactPhone', lang)}
          hint={t('requests.phoneHint', lang)}
          optional
          error={err('contact_phone')}
        >
          {(ids) => (
            <PrefixedInput
              {...ids}
              prefix="+211"
              inputMode="tel"
              className="mono"
              dir="ltr"
              value={values.contact_phone}
              onChange={(e) => set('contact_phone', e.target.value)}
            />
          )}
        </Field>
        <SwitchRow
          label={t('posts.showPhone', lang)}
          hint={t('posts.showPhoneHint', lang)}
          checked={values.show_phone}
          onChange={(on) => set('show_phone', on)}
        />
      </section>

      {/* The one primary action first: full width on a phone. */}
      <div className={css.actions}>
        {id ? (
          <Button type="submit" disabled={busy}>
            {t('listingForm.save', lang)}
          </Button>
        ) : (
          <>
            <Button type="submit" disabled={busy}>
              {t('lifecycle.publish', lang)}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void submit('draft')}>
              {t('listingForm.saveDraft', lang)}
            </Button>
          </>
        )}
        <Button variant="ghost" disabled={busy} onClick={openPreview}>
          {t('posts.preview', lang)}
        </Button>
        <Link href={listHref} className="small">
          {t('listingForm.cancel', lang)}
        </Link>
      </div>
    </form>
  );
}

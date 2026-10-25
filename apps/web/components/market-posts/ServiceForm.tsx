'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  SERVICE_PRICE_UNITS,
  SERVICE_TYPES,
  buyerServiceListingSchema,
  farmerServiceListingSchema,
  type ServicePosterType,
} from '@agri-erp/shared';

import {
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  PrefixedInput,
  Select,
  Textarea,
} from '@/components/ui';
import { t, type Language } from '@/lib/i18n';
import {
  MarketPostError,
  createService,
  listStates,
  myServices,
  newId,
  updateService,
  type ServiceListing,
} from '@/lib/market-posts/api';
import { PRICE_UNIT_KEY, SERVICE_TYPE_KEY, todayLocal } from '@/lib/market-posts/presentation';

import { ServiceDetailBody } from './MarketServices';
import styles from './market-posts.module.css';

interface Values {
  trading_name: string;
  service_type: string;
  title: string;
  description: string;
  location: string;
  state_id: string;
  available_from: string;
  available_until: string;
  availability_note: string;
  price_ssp: string;
  price_unit: string;
  negotiable: boolean;
  contact_phone: string;
  show_phone: boolean;
}

const fromService = (s: ServiceListing): Values => ({
  trading_name: s.trading_name,
  service_type: s.service_type,
  title: s.title,
  description: s.description,
  location: s.location,
  state_id: s.state_id,
  available_from: s.available_from,
  available_until: s.available_until ?? '',
  availability_note: s.availability_note ?? '',
  price_ssp: s.price_ssp === null ? '' : String(s.price_ssp),
  price_unit: s.price_unit ?? '',
  negotiable: s.negotiable,
  contact_phone: (s.contact_phone ?? '').replace(/^\+211/, ''),
  show_phone: s.show_phone ?? false,
});

/**
 * LISTINGS LANE (2026-10-19). Offer or edit a service: tractor hire,
 * transport, processing, storage or other -- a type, a description, a general
 * location, when it is available, and a price or "negotiable". The owner is
 * the session's account. A farmer's payam and state are the farmer record's;
 * a buyer account (2026-10-26: an institute, college, research body, advisory
 * organisation or adviser) chooses its state here. The same shared schemas as
 * the route. Needs signal.
 */
export function ServiceForm({
  lang,
  id,
  listHref,
  defaultName = '',
  defaultLocation = '',
  poster = 'farmer',
  defaultStateId = '',
  farmerNeedsState = false,
  payamName = null,
}: {
  lang: Language;
  id?: string;
  listHref: string;
  defaultName?: string;
  defaultLocation?: string;
  /** Who is offering it: a buyer account also chooses a state. */
  poster?: ServicePosterType;
  defaultStateId?: string;
  /**
   * 2026-10-28 (user journeys): a phone account whose record has no location
   * yet names a state for a NEW service, as an email account does (the route
   * applies the buyer's rule to it). An existing service keeps its state.
   */
  farmerNeedsState?: boolean;
  /** The farmer record's payam, for the preview only. */
  payamName?: string | null;
}) {
  const choosesState = poster === 'buyer' || (farmerNeedsState && !id);
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    trading_name: defaultName,
    service_type: '',
    title: '',
    description: '',
    location: defaultLocation,
    state_id: defaultStateId,
    available_from: todayLocal(),
    available_until: '',
    availability_note: '',
    price_ssp: '',
    price_unit: '',
    negotiable: false,
    contact_phone: '',
    show_phone: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  /** 2026-10-28 (user journeys): showing the post as the market will, before it is saved. */
  const [previewing, setPreviewing] = useState(false);

  // Read for the state picker, and for the preview's state name.
  useEffect(() => {
    listStates()
      .then(setStates)
      .catch(() => setStates([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    myServices()
      .then((mine) => {
        const found = mine.find((s) => s.id === id);
        if (found) setValues(fromService(found));
        else setFailure(t('svc.mineNotFound', lang));
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
      trading_name: values.trading_name,
      service_type: values.service_type,
      title: values.title,
      description: values.description,
      location: values.location,
      available_from: values.available_from,
      available_until: values.available_until === '' ? null : values.available_until,
      availability_note: values.availability_note,
      price_ssp: values.price_ssp === '' ? null : Number(values.price_ssp),
      price_unit: values.price_ssp === '' ? null : values.price_unit || null,
      negotiable: values.negotiable,
    };
    if (choosesState) out.state_id = values.state_id;
    out.show_phone = values.show_phone;
    if (values.contact_phone.trim() !== '') out.contact_phone = values.contact_phone;
    if (status) out.status = status;
    return out;
  }

  /** The shared schema's verdict on the form as it stands; errors shown. */
  function check(payload: Record<string, unknown>): boolean {
    const schema = choosesState ? buyerServiceListingSchema : farmerServiceListingSchema;
    const result = schema.safeParse(payload);
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
    // An edit is checked as a whole new post would be, so the preview is complete.
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
      if (id) await updateService(id, payload);
      else await createService({ id: newId(), ...payload });
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

  if (loading) return <p className="muted">{t('market.loading', lang)}</p>;
  const err = (key: keyof Values) => errors[key] || undefined;

  if (previewing) {
    const now = new Date().toISOString();
    const row: ServiceListing = {
      id: id ?? 'preview',
      poster_type: poster,
      trading_name: values.trading_name,
      poster_verified: false,
      farmer_verified: false,
      service_type: values.service_type,
      title: values.title,
      description: values.description,
      location: values.location,
      payam_name: poster === 'farmer' && !choosesState ? payamName : null,
      state_id: values.state_id,
      state_name: states.find((s) => s.id === values.state_id)?.name ?? '',
      available_from: values.available_from,
      available_until: values.available_until === '' ? null : values.available_until,
      availability_note: values.availability_note.trim() || null,
      price_ssp: values.price_ssp === '' ? null : Number(values.price_ssp),
      price_unit: values.price_ssp === '' ? null : values.price_unit || null,
      negotiable: values.negotiable,
      phone_shared: values.show_phone,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    return (
      <section aria-label={t('posts.previewTitle', lang)}>
        <Notice kind="info" title={t('posts.previewTitle', lang)}>
          <p className="small">{t(id ? 'posts.previewSaved' : 'posts.previewLead', lang)}</p>
        </Notice>
        {failure ? (
          <Notice kind="error">
            <p className="small">{failure}</p>
          </Notice>
        ) : null}
        <div className={styles.detail}>
          <ServiceDetailBody row={row} lang={lang} preview />
        </div>
        <div className={styles.formActions}>
          <Button variant="ghost" disabled={busy} onClick={() => setPreviewing(false)}>
            {t('posts.previewEdit', lang)}
          </Button>
          {id ? (
            <Button disabled={busy} onClick={() => void submit()}>
              {t('listingForm.save', lang)}
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void submit('draft')}>
                {t('listingForm.saveDraft', lang)}
              </Button>
              <Button disabled={busy} onClick={() => void submit('active')}>
                {t('lifecycle.publish', lang)}
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
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
      <div className={styles.formGrid}>
        <div className={styles.span2}>
          <Field
            label={t('listingForm.tradingName', lang)}
            hint={t('listingForm.tradingNameHint', lang)}
            error={err('trading_name')}
          >
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                maxLength={120}
                value={values.trading_name}
                onChange={(e) => set('trading_name', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('svc.type', lang)} error={err('service_type')}>
          {(ids) => (
            <Select
              {...ids}
              value={values.service_type}
              onChange={(e) => set('service_type', e.target.value)}
            >
              <option value="">{t('register.select', lang)}</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(SERVICE_TYPE_KEY[s], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('listingForm.title', lang)} error={err('title')}>
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={200}
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
            />
          )}
        </Field>
        <div className={styles.span2}>
          <Field label={t('listingForm.description', lang)} error={err('description')}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={4}
                dir="auto"
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={styles.span2}>
          <Field
            label={t('svc.location', lang)}
            hint={t('svc.locationHint', lang)}
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
        </div>
        {choosesState ? (
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
        ) : null}
        <Field label={t('listingForm.availableFrom', lang)} error={err('available_from')}>
          {(ids) => (
            <Input
              {...ids}
              type="date"
              className="mono"
              value={values.available_from}
              onChange={(e) => set('available_from', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('listingForm.availableUntil', lang)}
          hint={t('listingForm.untilDefault', lang)}
          optional
          error={err('available_until')}
        >
          {(ids) => (
            <Input
              {...ids}
              type="date"
              className="mono"
              min={values.available_from}
              value={values.available_until}
              onChange={(e) => set('available_until', e.target.value)}
            />
          )}
        </Field>
        <div className={styles.span2}>
          <Field
            label={t('svc.availability', lang)}
            hint={t('svc.availabilityHint', lang)}
            optional
            error={err('availability_note')}
          >
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={values.availability_note}
                onChange={(e) => set('availability_note', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('listingForm.price', lang)}
          hint={t('svc.priceHint', lang)}
          error={err('price_ssp')}
        >
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
        <Field label={t('svc.priceFor', lang)} optional error={err('price_unit')}>
          {(ids) => (
            <Select
              {...ids}
              value={values.price_unit}
              disabled={values.price_ssp === ''}
              onChange={(e) => set('price_unit', e.target.value)}
            >
              <option value="">{t('register.select', lang)}</option>
              {SERVICE_PRICE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(PRICE_UNIT_KEY[u], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className={styles.span2}>
          <Checkbox
            label={t('listingForm.negotiable', lang)}
            checked={values.negotiable}
            onChange={(e) => set('negotiable', e.target.checked)}
          />
        </div>
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
              value={values.contact_phone}
              onChange={(e) => set('contact_phone', e.target.value)}
            />
          )}
        </Field>
        <div>
          <Checkbox
            label={t('posts.showPhone', lang)}
            checked={values.show_phone}
            onChange={(e) => set('show_phone', e.target.checked)}
          />
          <p className="small muted">{t('posts.showPhoneHint', lang)}</p>
        </div>
      </div>

      <div className={styles.formActions}>
        <Link href={listHref} className="small">
          {t('listingForm.cancel', lang)}
        </Link>
        <Button variant="ghost" disabled={busy} onClick={openPreview}>
          {t('posts.preview', lang)}
        </Button>
        {id ? (
          <Button type="submit" disabled={busy}>
            {t('listingForm.save', lang)}
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void submit('draft')}>
              {t('listingForm.saveDraft', lang)}
            </Button>
            <Button type="submit" disabled={busy}>
              {t('lifecycle.publish', lang)}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

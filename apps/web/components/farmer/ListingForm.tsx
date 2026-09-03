'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CROPS, type Crop } from '@agri-erp/shared';

import { Button, Field, Input, Notice, Textarea } from '@/components/ui';
import { canPublishListings } from '@/lib/farmers/listings';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';
import { CROP_LABELS } from '@/lib/format';
import type { ListingStatus, ProduceListing } from '@/lib/fixtures/farmers';

import styles from './farmer.module.css';

const TODAY = '2026-09-02';

interface FormState {
  crop: Crop | '';
  quantity_kg: string;
  price_ssp_per_kg: string;
  available_from: string;
  available_until: string;
  notes: string;
}

type FieldErrors = Partial<Record<'crop' | 'quantity_kg' | 'available_from', string>>;

/**
 * Add or edit one produce listing (B12 point 5). Crop is a five-tile choice,
 * quantity and dates are required, price and the end date are optional, the
 * photo is preview-only (upload happens later). A verified farmer can list;
 * a pending farmer can only save a draft and is told exactly why.
 */
export function ListingForm({ listingId }: { listingId?: string }) {
  const { hydrated, farmer, language, listingById, saveListing, newListingId } = useFarmerSession();
  const router = useRouter();

  const existing = listingId ? listingById(listingId) : undefined;
  const isEdit = Boolean(listingId);

  const [form, setForm] = useState<FormState>({
    crop: '',
    quantity_kg: '',
    price_ssp_per_kg: '',
    available_from: TODAY,
    available_until: '',
    notes: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const seeded = useRef(false);

  // Seed the form from an existing listing once it is available.
  useEffect(() => {
    if (existing && !seeded.current) {
      seeded.current = true;
      setForm({
        crop: existing.crop,
        quantity_kg: String(existing.quantity_kg),
        price_ssp_per_kg: existing.price_ssp_per_kg?.toString() ?? '',
        available_from: existing.available_from,
        available_until: existing.available_until ?? '',
        notes: existing.notes,
      });
    }
  }, [existing]);

  // A chosen photo is previewed from a local object URL and never uploaded.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    if (hydrated && !farmer) router.replace('/farmer/login');
  }, [hydrated, farmer, router]);

  const verified = useMemo(() => (farmer ? canPublishListings(farmer) : false), [farmer]);

  if (!hydrated || !farmer) return null;
  if (isEdit && !existing) {
    return (
      <div className={styles.sheet}>
        <Notice kind="error">
          <p className="small">This listing could not be found.</p>
        </Notice>
        <p className={styles.linkRow}>
          <Link href="/farmer/account/listings">← {t('listings.title', language)}</Link>
        </p>
      </div>
    );
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const next: FieldErrors = {};
    if (form.crop === '') next.crop = t('error.crop', language);
    const kg = Number(form.quantity_kg);
    if (form.quantity_kg.trim() === '' || !Number.isFinite(kg) || kg <= 0)
      next.quantity_kg = t('error.quantity', language);
    if (form.available_from.trim() === '') next.available_from = t('error.availableFrom', language);
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function build(status: ListingStatus): ProduceListing {
    const now = new Date().toISOString();
    const price = form.price_ssp_per_kg.trim() === '' ? null : Number(form.price_ssp_per_kg);
    return {
      id: existing?.id ?? newListingId(),
      farmer_id: farmer!.id,
      crop: form.crop as Crop,
      quantity_kg: Number(form.quantity_kg),
      price_ssp_per_kg: price !== null && Number.isFinite(price) ? price : null,
      available_from: form.available_from,
      available_until: form.available_until.trim() === '' ? null : form.available_until,
      notes: form.notes.trim(),
      photo_storage_path: existing?.photo_storage_path ?? null,
      status,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
  }

  function persist(status: ListingStatus) {
    if (!validate()) return;
    saveListing(build(status));
    router.push('/farmer/account/listings');
  }

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (!file) {
      setPhotoName(null);
      setPhotoUrl(null);
      return;
    }
    setPhotoName(file.name);
    setPhotoUrl(URL.createObjectURL(file));
  }

  const status = existing?.status;

  return (
    <div className={styles.sheet}>
      <p className={styles.eyebrow}>{t('listings.title', language)}</p>
      <h1 className={styles.h1}>
        {isEdit ? t('listingForm.editTitle', language) : t('listingForm.newTitle', language)}
      </h1>

      {!verified ? (
        <Notice kind="warn" title={t('account.pending', language)}>
          <p className="small">{t('listingForm.pendingReason', language)}</p>
        </Notice>
      ) : null}

      <div className={styles.stack}>
        <Field label={t('listingForm.cropLabel', language)} error={errors.crop}>
          {() => (
            <div
              className={styles.cropTiles}
              role="radiogroup"
              aria-label={t('listingForm.cropLabel', language)}
            >
              {CROPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={form.crop === c}
                  className={`${styles.cropTile} ${form.crop === c ? styles.cropTileSelected : ''}`}
                  onClick={() => set('crop', c)}
                >
                  {CROP_LABELS[c]}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label={t('listingForm.quantityLabel', language)} error={errors.quantity_kg}>
          {(ids) => (
            <Input
              {...ids}
              inputMode="numeric"
              className="mono"
              placeholder="0"
              value={form.quantity_kg}
              onChange={(e) => set('quantity_kg', e.target.value.replace(/[^\d]/g, ''))}
            />
          )}
        </Field>

        <Field label={t('listingForm.priceLabel', language)} optional>
          {(ids) => (
            <div className={styles.priceRow}>
              <Input
                {...ids}
                inputMode="numeric"
                className="mono"
                placeholder="0"
                value={form.price_ssp_per_kg}
                onChange={(e) => set('price_ssp_per_kg', e.target.value.replace(/[^\d]/g, ''))}
              />
              <span className={styles.priceUnit}>{t('listings.perKg', language)}</span>
            </div>
          )}
        </Field>

        <Field label={t('listingForm.availableFrom', language)} error={errors.available_from}>
          {(ids) => (
            <Input
              {...ids}
              type="date"
              className="mono"
              value={form.available_from}
              onChange={(e) => set('available_from', e.target.value)}
            />
          )}
        </Field>

        <Field label={t('listingForm.availableUntil', language)} optional>
          {(ids) => (
            <Input
              {...ids}
              type="date"
              className="mono"
              value={form.available_until}
              onChange={(e) => set('available_until', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('listingForm.notes', language)}
          hint={t('listingForm.notesHint', language)}
          optional
        >
          {(ids) => (
            <Textarea
              {...ids}
              dir="auto"
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('listingForm.photo', language)}
          hint={t('listingForm.photoHint', language)}
          optional
        >
          {(ids) => (
            <>
              <Input {...ids} type="file" accept="image/*" onChange={onPhoto} />
              {photoUrl ? <img src={photoUrl} alt="" className={styles.photoPreview} /> : null}
              {photoName ? (
                <p className={styles.photoName}>
                  {t('listingForm.photoChosen', language)}: {photoName}
                </p>
              ) : null}
            </>
          )}
        </Field>
      </div>

      {/* Actions depend on verification and current status. */}
      <div className={styles.actions}>
        {!isEdit || status === 'draft' ? (
          <>
            {verified ? (
              <Button
                variant="primary"
                className={styles.blockButton}
                onClick={() => persist('listed')}
              >
                {t('listingForm.list', language)}
              </Button>
            ) : null}
            <Button
              variant={verified ? 'secondary' : 'primary'}
              className={styles.blockButton}
              onClick={() => persist('draft')}
            >
              {t('listingForm.saveDraft', language)}
            </Button>
          </>
        ) : null}

        {status === 'listed' ? (
          <>
            <Button
              variant="primary"
              className={styles.blockButton}
              onClick={() => persist('sold')}
            >
              {t('listingForm.markSold', language)}
            </Button>
            <Button
              variant="secondary"
              className={styles.blockButton}
              onClick={() => persist('listed')}
            >
              {t('listingForm.save', language)}
            </Button>
            <Button
              variant="danger"
              className={styles.blockButton}
              onClick={() => persist('withdrawn')}
            >
              {t('listingForm.withdraw', language)}
            </Button>
          </>
        ) : null}

        {status === 'withdrawn' ? (
          <>
            {verified ? (
              <Button
                variant="primary"
                className={styles.blockButton}
                onClick={() => persist('listed')}
              >
                {t('listingForm.relist', language)}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              className={styles.blockButton}
              onClick={() => persist('withdrawn')}
            >
              {t('listingForm.save', language)}
            </Button>
          </>
        ) : null}

        {status === 'sold' ? (
          <Button
            variant="secondary"
            className={styles.blockButton}
            onClick={() => persist('sold')}
          >
            {t('listingForm.save', language)}
          </Button>
        ) : null}

        <Link
          href="/farmer/account/listings"
          className={styles.textLink}
          style={{ textAlign: 'center' }}
        >
          {t('listingForm.cancel', language)}
        </Link>
      </div>
    </div>
  );
}

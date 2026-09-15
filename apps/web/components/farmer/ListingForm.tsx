'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { Photo } from '@/components/listings/Photo';
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
import {
  LISTING_CATEGORIES,
  LISTING_DESCRIPTION_MAX,
  LISTING_MAX_PHOTOS,
  LISTING_UNITS,
  farmerPayamName,
  type ListingStatus,
  type ProduceListing,
} from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import {
  CATEGORY_KEY,
  UNIT_KEY,
  canPublishListings,
  emptyListingValues,
  listingToValues,
  validateListing,
  type ListingErrors,
  type ListingField,
  type ListingFormValues,
} from '@/lib/farmers/listings';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * New and edit listing, one desktop form on two columns: the photo panel on
 * the left (drop or choose up to five, reorder, the first is the cover), the
 * fields on the right in three ruled sections mirroring B12 point 5 field for
 * field, and a sticky action bar: Save draft / List it, or for a live listing
 * Save changes / Mark as sold / Withdraw. "List it" is disabled with the exact
 * reason until the farmer is verified. Chosen photos are previewed from local
 * object URLs; the upload itself lands with the storage route.
 */
export function ListingForm({ listingId }: { listingId?: string }) {
  const { farmer, language, listingById, listingsFor, saveListing, newListingId } =
    useFarmerSession();
  const router = useRouter();

  const existing = listingId ? listingById(listingId) : undefined;
  const own = existing && farmer && existing.farmer_id === farmer.id ? existing : undefined;
  const isEdit = Boolean(listingId);

  const [values, setValues] = useState<ListingFormValues>(() =>
    own
      ? listingToValues(own)
      : {
          ...emptyListingValues(farmer?.phone.replace(/^\+211/, '') ?? '', TODAY),
          // Keep one trading identity across listings: the last one used.
          trading_name: farmer ? (listingsFor(farmer.id)[0]?.trading_name ?? '') : '',
        },
  );
  const [errors, setErrors] = useState<ListingErrors>({});
  const [photos, setPhotos] = useState<string[]>(() => own?.photo_storage_paths ?? []);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState<'draft' | null>(null);
  const seeded = useRef(Boolean(own));
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (own && !seeded.current) {
      seeded.current = true;
      setValues(listingToValues(own));
      setPhotos(own.photo_storage_paths);
    }
  }, [own]);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => {
    return () => {
      photosRef.current.filter((p) => p.startsWith('blob:')).forEach((p) => URL.revokeObjectURL(p));
    };
  }, []);

  const verified = useMemo(() => (farmer ? canPublishListings(farmer) : false), [farmer]);

  if (!farmer) return null;
  if (isEdit && !own) {
    return (
      <>
        <PageHead title={t('listingForm.editTitle', language)} />
        <Notice kind="error">
          <p className="small">{t('listingForm.notFound', language)}</p>
        </Notice>
        <p className={styles.linkRow}>
          <Link href="/farmer/account/listings">← {t('listings.title', language)}</Link>
        </p>
      </>
    );
  }

  function set<K extends ListingField>(key: K, value: ListingFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function blur(key: ListingField) {
    const result = validateListing(
      values,
      farmer ? { given_name: farmer.given_name, family_name: farmer.family_name } : null,
    );
    if (!result.ok && result.errors[key])
      setErrors((prev) => ({ ...prev, [key]: result.errors[key] }));
  }

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    setPhotos((prev) => {
      const room = LISTING_MAX_PHOTOS - prev.length;
      return [...prev, ...files.slice(0, Math.max(room, 0)).map((f) => URL.createObjectURL(f))];
    });
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function move(index: number, to: number) {
    setPhotos((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  function remove(index: number) {
    setPhotos((prev) => {
      const item = prev[index];
      if (item?.startsWith('blob:')) URL.revokeObjectURL(item);
      return prev.filter((_, i) => i !== index);
    });
  }

  function persist(status: ListingStatus) {
    const result = validateListing(
      values,
      farmer ? { given_name: farmer.given_name, family_name: farmer.family_name } : null,
    );
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) document.getElementById(`listing-${first}`)?.focus();
      return;
    }
    const now = new Date().toISOString();
    const listing: ProduceListing = {
      id: own?.id ?? newListingId(),
      farmer_id: farmer!.id,
      ...result.values,
      photo_storage_paths: photos,
      status,
      created_at: own?.created_at ?? now,
      updated_at: now,
    };
    saveListing(listing);
    if (status === 'draft' && !verified) {
      setSaved('draft');
    }
    router.push(`/farmer/account/listings/${listing.id}`);
  }

  const status = own?.status ?? 'draft';
  const full = photos.length >= LISTING_MAX_PHOTOS;
  const err = (key: ListingField) => (errors[key] ? t(errors[key]!, language) : undefined);
  const unitOptions = LISTING_UNITS.map((u) => (
    <option key={u} value={u}>
      {t(UNIT_KEY[u], language)}
    </option>
  ));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        persist(status === 'draft' ? 'draft' : status);
      }}
      noValidate
    >
      <PageHead
        title={isEdit ? t('listingForm.editTitle', language) : t('listingForm.newTitle', language)}
        lead={t('listingForm.lead', language)}
        actions={
          own ? (
            <Link href={`/farmer/account/listings/${own.id}`} className="small">
              {t('listingForm.preview', language)}
            </Link>
          ) : null
        }
      />

      {saved === 'draft' ? (
        <Notice kind="success">
          <p className="small">{t('listingForm.pendingSavedDraft', language)}</p>
        </Notice>
      ) : null}

      <div className={styles.formLayout}>
        {/* Photos */}
        <aside className={styles.photoPanel}>
          <Field
            label={t('listingForm.photos', language)}
            hint={t('listingForm.photosHint', language)}
          >
            {(ids) => (
              <label
                className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!full) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input
                  {...ids}
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={full}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                {full ? (
                  <span className="small">{t('listingForm.photosFull', language)}</span>
                ) : (
                  <span>
                    {t('listingForm.photosDrop', language)}{' '}
                    <span className={styles.textLink}>
                      {t('listingForm.photosChoose', language)}
                    </span>
                  </span>
                )}
                <span className="small muted mono">
                  {photos.length} / {LISTING_MAX_PHOTOS}
                </span>
              </label>
            )}
          </Field>

          {photos.length > 0 ? (
            <ul className={styles.photoList}>
              {photos.map((src, i) => (
                <li key={src} className={styles.photoItem}>
                  <Photo
                    src={src}
                    category={values.category === '' ? 'other' : values.category}
                    lang={language}
                    alt={`${t('detail.photoOf', language)} ${i + 1}`}
                    tag={i === 0 ? t('listings.cover', language) : undefined}
                  />
                  <div className={styles.photoItemActions}>
                    {i > 0 ? (
                      <Button size="small" variant="ghost" onClick={() => move(i, 0)}>
                        {t('listingForm.photoMakeCover', language)}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      {t('listingForm.photoMoveUp', language)}
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={i === photos.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      {t('listingForm.photoMoveDown', language)}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => remove(i)}>
                      {t('listingForm.photoRemove', language)}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        {/* Fields */}
        <div>
          <section className={styles.fieldSection}>
            <h2>{t('listingForm.sectionProduct', language)}</h2>
            <div className={styles.fieldGrid}>
              <div className={styles.span2}>
                <Field
                  label={t('listingForm.tradingName', language)}
                  hint={t('listingForm.tradingNameHint', language)}
                  error={err('trading_name')}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      id="listing-trading_name"
                      value={values.trading_name}
                      maxLength={60}
                      dir="auto"
                      placeholder={t('listingForm.tradingNamePlaceholder', language)}
                      onChange={(e) => set('trading_name', e.target.value)}
                      onBlur={() => blur('trading_name')}
                    />
                  )}
                </Field>
              </div>
              <div className={styles.span2}>
                <Field
                  label={t('listingForm.title', language)}
                  hint={t('listingForm.titleHint', language)}
                  error={err('title')}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      id="listing-title"
                      value={values.title}
                      maxLength={120}
                      dir="auto"
                      onChange={(e) => set('title', e.target.value)}
                      onBlur={() => blur('title')}
                    />
                  )}
                </Field>
              </div>
              <Field label={t('listingForm.category', language)} error={err('category')}>
                {(ids) => (
                  <Select
                    {...ids}
                    id="listing-category"
                    value={values.category}
                    onChange={(e) =>
                      set('category', e.target.value as ListingFormValues['category'])
                    }
                    onBlur={() => blur('category')}
                  >
                    <option value="">{t('register.select', language)}</option>
                    {LISTING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(CATEGORY_KEY[c], language)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('listingForm.productName', language)}
                hint={t('listingForm.productHint', language)}
                error={err('product_name')}
              >
                {(ids) => (
                  <Input
                    {...ids}
                    id="listing-product_name"
                    value={values.product_name}
                    dir="auto"
                    onChange={(e) => set('product_name', e.target.value)}
                    onBlur={() => blur('product_name')}
                  />
                )}
              </Field>
              <div className={styles.span2}>
                <Field
                  label={t('listingForm.description', language)}
                  hint={`${t('listingForm.descriptionHint', language)} ${values.description.length} / ${LISTING_DESCRIPTION_MAX}`}
                  error={err('description')}
                >
                  {(ids) => (
                    <Textarea
                      {...ids}
                      id="listing-description"
                      rows={5}
                      value={values.description}
                      dir="auto"
                      onChange={(e) => set('description', e.target.value)}
                      onBlur={() => blur('description')}
                    />
                  )}
                </Field>
              </div>
            </div>
          </section>

          <section className={styles.fieldSection}>
            <h2>{t('listingForm.sectionPrice', language)}</h2>
            <div className={styles.fieldGrid}>
              <Field label={t('listingForm.quantity', language)} error={err('quantity')}>
                {(ids) => (
                  <Input
                    {...ids}
                    id="listing-quantity"
                    inputMode="decimal"
                    className="mono"
                    value={values.quantity}
                    onChange={(e) => set('quantity', e.target.value.replace(/[^\d.]/g, ''))}
                    onBlur={() => blur('quantity')}
                  />
                )}
              </Field>
              <Field label={t('listingForm.unit', language)} error={err('unit')}>
                {(ids) => (
                  <Select
                    {...ids}
                    id="listing-unit"
                    value={values.unit}
                    onChange={(e) => {
                      const unit = e.target.value as ListingFormValues['unit'];
                      set('unit', unit);
                      if (values.price_per === '') set('price_per', unit);
                    }}
                    onBlur={() => blur('unit')}
                  >
                    <option value="">{t('register.select', language)}</option>
                    {unitOptions}
                  </Select>
                )}
              </Field>
              <Field label={t('listingForm.price', language)} error={err('price_ssp')}>
                {(ids) => (
                  <PrefixedInput
                    {...ids}
                    id="listing-price_ssp"
                    prefix={t('listings.ssp', language)}
                    inputMode="numeric"
                    className="mono"
                    value={values.price_ssp}
                    onChange={(e) => set('price_ssp', e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={() => blur('price_ssp')}
                  />
                )}
              </Field>
              <Field label={t('listingForm.pricePer', language)} error={err('price_per')}>
                {(ids) => (
                  <Select
                    {...ids}
                    id="listing-price_per"
                    value={values.price_per}
                    onChange={(e) =>
                      set('price_per', e.target.value as ListingFormValues['price_per'])
                    }
                    onBlur={() => blur('price_per')}
                  >
                    <option value="">{t('register.select', language)}</option>
                    {unitOptions}
                  </Select>
                )}
              </Field>
              <div className={styles.span2}>
                <Checkbox
                  label={t('listingForm.negotiable', language)}
                  checked={values.negotiable}
                  onChange={(e) => set('negotiable', e.target.checked)}
                />
              </div>
            </div>
          </section>

          <section className={styles.fieldSection}>
            <h2>{t('listingForm.sectionAvailability', language)}</h2>
            <div className={styles.fieldGrid}>
              <Field label={t('listingForm.availableFrom', language)} error={err('available_from')}>
                {(ids) => (
                  <Input
                    {...ids}
                    id="listing-available_from"
                    type="date"
                    className="mono"
                    value={values.available_from}
                    onChange={(e) => set('available_from', e.target.value)}
                    onBlur={() => blur('available_from')}
                  />
                )}
              </Field>
              <Field
                label={t('listingForm.availableUntil', language)}
                optional
                error={err('available_until')}
              >
                {(ids) => (
                  <Input
                    {...ids}
                    id="listing-available_until"
                    type="date"
                    className="mono"
                    min={values.available_from}
                    value={values.available_until}
                    onChange={(e) => set('available_until', e.target.value)}
                    onBlur={() => blur('available_until')}
                  />
                )}
              </Field>
              <Field
                label={t('listingForm.harvestSeason', language)}
                hint={t('listingForm.harvestHint', language)}
                optional
              >
                {(ids) => (
                  <Input
                    {...ids}
                    value={values.harvest_season}
                    onChange={(e) => set('harvest_season', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('listingForm.location', language)}
                hint={t('listingForm.locationHint', language)}
              >
                {(ids) => <Input {...ids} value={farmerPayamName(farmer.payam_id)} readOnly />}
              </Field>
              <div className={styles.span2}>
                <Field
                  label={t('listingForm.pickupNotes', language)}
                  hint={t('listingForm.pickupHint', language)}
                  optional
                >
                  {(ids) => (
                    <Textarea
                      {...ids}
                      rows={2}
                      value={values.pickup_notes}
                      dir="auto"
                      onChange={(e) => set('pickup_notes', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field
                label={t('listingForm.contactPhone', language)}
                hint={t('listingForm.contactHint', language)}
                error={err('contact_phone')}
              >
                {(ids) => (
                  <PrefixedInput
                    {...ids}
                    id="listing-contact_phone"
                    prefix="+211"
                    inputMode="tel"
                    className="mono"
                    value={values.contact_phone}
                    onChange={(e) => set('contact_phone', e.target.value)}
                    onBlur={() => blur('contact_phone')}
                  />
                )}
              </Field>
              <div className={styles.checkRow}>
                <Checkbox
                  label={t('listingForm.delivery', language)}
                  checked={values.delivery_available}
                  onChange={(e) => set('delivery_available', e.target.checked)}
                />
              </div>
            </div>
          </section>

          <div className={styles.actionBar}>
            <Link href="/farmer/account/listings" className={styles.textLink}>
              {t('listingForm.cancel', language)}
            </Link>
            <span className="spacer" style={{ flex: 1 }} />
            {!verified ? (
              <span className={styles.actionNote}>{t('listingForm.pendingReason', language)}</span>
            ) : null}

            {status === 'draft' ? (
              <>
                <Button variant="secondary" onClick={() => persist('draft')}>
                  {t('listingForm.saveDraft', language)}
                </Button>
                <Button variant="primary" disabled={!verified} onClick={() => persist('listed')}>
                  {t('listingForm.list', language)}
                </Button>
              </>
            ) : null}

            {status === 'listed' ? (
              <>
                <Button variant="danger" onClick={() => persist('withdrawn')}>
                  {t('listingForm.withdraw', language)}
                </Button>
                <Button variant="secondary" onClick={() => persist('sold')}>
                  {t('listingForm.markSold', language)}
                </Button>
                <Button variant="primary" onClick={() => persist('listed')}>
                  {t('listingForm.save', language)}
                </Button>
              </>
            ) : null}

            {status === 'withdrawn' || status === 'sold' ? (
              <>
                <Button variant="secondary" onClick={() => persist(status)}>
                  {t('listingForm.save', language)}
                </Button>
                <Button variant="primary" disabled={!verified} onClick={() => persist('listed')}>
                  {t('listingForm.relist', language)}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}

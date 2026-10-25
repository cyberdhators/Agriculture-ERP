'use client';

import {
  BUYER_ORGANIZATION_TYPES,
  LISTING_CATEGORIES,
  LISTING_UNITS,
  PAYMENT_PREFERENCES,
} from '@agri-erp/shared';

import {
  categoryLabel,
  monthLabels,
  orgTypeLabel,
  paymentLabel,
  unitLabel,
} from '@/lib/buyer/labels';
import { t, type Language } from '@/lib/i18n';

import { Checkbox, Field, Input, Select, Textarea } from '../ui';
import styles from './buyer.module.css';

/**
 * THE ORGANISATION AND PROCUREMENT FIELDS, shared by registration and the
 * profile so the two can never ask for different things. Values are held as
 * form strings; `toOrganizationBody` turns them into the shapes the shared
 * schemas validate.
 */

export interface OrgForm {
  organization_name: string;
  organization_type: string;
  registration_number: string;
  tax_id: string;
  country_code: string;
  state_id: string;
  county_id: string;
  city: string;
  address: string;
  website: string;
  description: string;
  interested_categories: string[];
  interested_products: string;
  preferred_state_ids: string[];
  min_quantity: string;
  max_quantity: string;
  preferred_unit: string;
  delivery_locations: string;
  purchasing_months: number[];
  payment_preferences: string[];
}

export const EMPTY_ORG: OrgForm = {
  organization_name: '',
  organization_type: 'trader',
  registration_number: '',
  tax_id: '',
  country_code: 'SS',
  state_id: '',
  county_id: '',
  city: '',
  address: '',
  website: '',
  description: '',
  interested_categories: [],
  interested_products: '',
  preferred_state_ids: [],
  min_quantity: '',
  max_quantity: '',
  preferred_unit: '',
  delivery_locations: '',
  purchasing_months: [],
  payment_preferences: [],
};

const list = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const num = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/**
 * The organisation and procurement half of a request body. For an individual
 * the organisation name and type are left out: the route names the account
 * after the person.
 */
export function toOrganizationBody(form: OrgForm, includeLocation: boolean, individual = false) {
  return {
    ...(individual
      ? {}
      : { organization_name: form.organization_name, organization_type: form.organization_type }),
    registration_number: form.registration_number,
    tax_id: form.tax_id,
    country_code: form.country_code,
    ...(includeLocation
      ? { state_id: form.state_id || null, county_id: form.county_id || null }
      : {}),
    city: form.city,
    address: form.address,
    website: form.website,
    description: form.description,
    interested_categories: form.interested_categories,
    interested_products: list(form.interested_products),
    preferred_state_ids: form.preferred_state_ids,
    min_quantity: num(form.min_quantity),
    max_quantity: num(form.max_quantity),
    preferred_unit: form.preferred_unit || null,
    delivery_locations: list(form.delivery_locations),
    purchasing_months: form.purchasing_months,
    payment_preferences: form.payment_preferences,
  };
}

const toggle = <T,>(items: readonly T[], item: T): T[] =>
  items.includes(item) ? items.filter((i) => i !== item) : [...items, item];

export function ProcurementFields({
  form,
  onChange,
  errors,
  states,
  counties,
  individual = false,
  language = 'en',
}: {
  /** 2026-10-29: sign-up and the profile speak the buyer's language. */
  language?: Language;
  form: OrgForm;
  onChange: (next: OrgForm) => void;
  errors: Record<string, string>;
  /** An individual buyer has no organisation to describe; only what they buy. */
  individual?: boolean;
  /** Absent on registration: the applicant has no session to read locations with. */
  states?: { id: string; name: string }[];
  counties?: { id: string; name: string; state_id: string }[];
}) {
  const set = <K extends keyof OrgForm>(key: K, value: OrgForm[K]) =>
    onChange({ ...form, [key]: value });
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const optional = w('common.optional');

  return (
    <>
      {individual ? null : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{w('buyer.pf.organisation')}</legend>
          <div className={styles.formGrid}>
            <Field label={w('buyer.pf.orgName')} error={errors.organization_name}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.organization_name}
                  onChange={(e) => set('organization_name', e.target.value)}
                  autoComplete="organization"
                />
              )}
            </Field>
            <Field label={w('buyer.pf.orgType')} error={errors.organization_type}>
              {(ids) => (
                <Select
                  {...ids}
                  value={form.organization_type}
                  onChange={(e) => set('organization_type', e.target.value)}
                >
                  {BUYER_ORGANIZATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {orgTypeLabel(type, language)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={w('buyer.pf.regNo')}
              optional={optional}
              error={errors.registration_number}
            >
              {(ids) => (
                <Input
                  {...ids}
                  value={form.registration_number}
                  onChange={(e) => set('registration_number', e.target.value)}
                />
              )}
            </Field>
            <Field label={w('buyer.pf.taxId')} optional={optional} error={errors.tax_id}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.tax_id}
                  onChange={(e) => set('tax_id', e.target.value)}
                />
              )}
            </Field>
            <Field
              label={w('buyer.pf.country')}
              hint={w('buyer.pf.countryHint')}
              error={errors.country_code}
            >
              {(ids) => (
                <Input
                  {...ids}
                  maxLength={2}
                  value={form.country_code}
                  onChange={(e) => set('country_code', e.target.value.toUpperCase())}
                />
              )}
            </Field>
            {states ? (
              <Field label={w('buyer.pf.state')} optional={optional} error={errors.state_id}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={form.state_id}
                    onChange={(e) => onChange({ ...form, state_id: e.target.value, county_id: '' })}
                  >
                    <option value="">{w('buyer.pf.stateNone')}</option>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {states && counties ? (
              <Field label={w('buyer.pf.county')} optional={optional} error={errors.county_id}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={form.county_id}
                    disabled={!form.state_id}
                    onChange={(e) => set('county_id', e.target.value)}
                  >
                    <option value="">{w('buyer.pf.countyNone')}</option>
                    {counties
                      .filter((c) => c.state_id === form.state_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label={w('buyer.pf.city')} optional={optional} error={errors.city}>
              {(ids) => (
                <Input {...ids} value={form.city} onChange={(e) => set('city', e.target.value)} />
              )}
            </Field>
            <Field label={w('buyer.pf.address')} optional={optional} error={errors.address}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.address}
                  autoComplete="street-address"
                  onChange={(e) => set('address', e.target.value)}
                />
              )}
            </Field>
            <Field label={w('buyer.pf.website')} optional={optional} error={errors.website}>
              {(ids) => (
                <Input
                  {...ids}
                  type="url"
                  placeholder="https://"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              )}
            </Field>
            <div className={styles.formGridFull}>
              <Field label={w('buyer.pf.about')} optional={optional} error={errors.description}>
                {(ids) => (
                  <Textarea
                    {...ids}
                    rows={3}
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>
        </fieldset>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{w('buyer.pf.whatYouBuy')}</legend>
        <div role="group" aria-label={w('buyer.pf.categoriesAria')}>
          <p className={styles.muted}>{w('buyer.pf.categories')}</p>
          <div className={styles.checkGrid}>
            {LISTING_CATEGORIES.map((c) => (
              <Checkbox
                key={c}
                label={categoryLabel(c, language)}
                checked={form.interested_categories.includes(c)}
                onChange={() => set('interested_categories', toggle(form.interested_categories, c))}
              />
            ))}
          </div>
        </div>
        <div className={styles.formGrid}>
          <Field
            label={w('buyer.pf.products')}
            optional={optional}
            hint={w('buyer.pf.productsHint')}
            error={errors.interested_products}
          >
            {(ids) => (
              <Input
                {...ids}
                value={form.interested_products}
                onChange={(e) => set('interested_products', e.target.value)}
              />
            )}
          </Field>
          <Field label={w('buyer.pf.unit')} optional={optional} error={errors.preferred_unit}>
            {(ids) => (
              <Select
                {...ids}
                value={form.preferred_unit}
                onChange={(e) => set('preferred_unit', e.target.value)}
              >
                <option value="">{w('buyer.pf.unitNone')}</option>
                {LISTING_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u, language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={w('buyer.pf.min')} optional={optional} error={errors.min_quantity}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={form.min_quantity}
                onChange={(e) => set('min_quantity', e.target.value)}
              />
            )}
          </Field>
          <Field label={w('buyer.pf.max')} optional={optional} error={errors.max_quantity}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={form.max_quantity}
                onChange={(e) => set('max_quantity', e.target.value)}
              />
            )}
          </Field>
          <div className={styles.formGridFull}>
            <Field
              label={w('buyer.pf.delivery')}
              optional={optional}
              hint={w('buyer.pf.deliveryHint')}
              error={errors.delivery_locations}
            >
              {(ids) => (
                <Input
                  {...ids}
                  value={form.delivery_locations}
                  onChange={(e) => set('delivery_locations', e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
        {states ? (
          <div role="group" aria-label={w('buyer.pf.areas')}>
            <p className={styles.muted}>{w('buyer.pf.areas')}</p>
            <div className={styles.checkGrid}>
              {states.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.name}
                  checked={form.preferred_state_ids.includes(s.id)}
                  onChange={() =>
                    set('preferred_state_ids', toggle(form.preferred_state_ids, s.id))
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
        <div role="group" aria-label={w('buyer.pf.months')}>
          <p className={styles.muted}>{w('buyer.pf.months')}</p>
          <div className={styles.checkGrid}>
            {monthLabels(language).map((m, i) => (
              <Checkbox
                key={i}
                label={m}
                checked={form.purchasing_months.includes(i + 1)}
                onChange={() => set('purchasing_months', toggle(form.purchasing_months, i + 1))}
              />
            ))}
          </div>
        </div>
        <div role="group" aria-label={w('buyer.pf.pay')}>
          <p className={styles.muted}>{w('buyer.pf.payNote')}</p>
          <div className={styles.checkGrid}>
            {PAYMENT_PREFERENCES.map((p) => (
              <Checkbox
                key={p}
                label={paymentLabel(p, language)}
                checked={form.payment_preferences.includes(p)}
                onChange={() => set('payment_preferences', toggle(form.payment_preferences, p))}
              />
            ))}
          </div>
        </div>
      </fieldset>
    </>
  );
}

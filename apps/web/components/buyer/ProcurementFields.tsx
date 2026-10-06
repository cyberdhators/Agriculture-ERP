'use client';

import {
  BUYER_ORGANIZATION_TYPES,
  LISTING_CATEGORIES,
  LISTING_UNITS,
  PAYMENT_PREFERENCES,
} from '@agri-erp/shared';

import {
  CATEGORY_LABELS,
  MONTH_LABELS,
  ORG_TYPE_LABELS,
  PAYMENT_LABELS,
  UNIT_LABELS,
} from '@/lib/buyer/labels';

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
}: {
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

  return (
    <>
      {individual ? null : (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Organisation</legend>
          <div className={styles.formGrid}>
            <Field label="Organisation name" error={errors.organization_name}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.organization_name}
                  onChange={(e) => set('organization_name', e.target.value)}
                  autoComplete="organization"
                />
              )}
            </Field>
            <Field label="Organisation type" error={errors.organization_type}>
              {(ids) => (
                <Select
                  {...ids}
                  value={form.organization_type}
                  onChange={(e) => set('organization_type', e.target.value)}
                >
                  {BUYER_ORGANIZATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ORG_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Business registration number" optional error={errors.registration_number}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.registration_number}
                  onChange={(e) => set('registration_number', e.target.value)}
                />
              )}
            </Field>
            <Field label="Tax identification number" optional error={errors.tax_id}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.tax_id}
                  onChange={(e) => set('tax_id', e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Country"
              hint="Two-letter code, e.g. SS, KE, UG"
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
              <Field label="State" optional error={errors.state_id}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={form.state_id}
                    onChange={(e) => onChange({ ...form, state_id: e.target.value, county_id: '' })}
                  >
                    <option value="">Not in South Sudan / not stated</option>
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
              <Field label="County" optional error={errors.county_id}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={form.county_id}
                    disabled={!form.state_id}
                    onChange={(e) => set('county_id', e.target.value)}
                  >
                    <option value="">Not stated</option>
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
            <Field label="City" optional error={errors.city}>
              {(ids) => (
                <Input {...ids} value={form.city} onChange={(e) => set('city', e.target.value)} />
              )}
            </Field>
            <Field label="Physical address" optional error={errors.address}>
              {(ids) => (
                <Input
                  {...ids}
                  value={form.address}
                  autoComplete="street-address"
                  onChange={(e) => set('address', e.target.value)}
                />
              )}
            </Field>
            <Field label="Website" optional error={errors.website}>
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
              <Field label="About the organisation" optional error={errors.description}>
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
        <legend className={styles.legend}>What you buy</legend>
        <div role="group" aria-label="Product categories you buy">
          <p className={styles.muted}>Product categories</p>
          <div className={styles.checkGrid}>
            {LISTING_CATEGORIES.map((c) => (
              <Checkbox
                key={c}
                label={CATEGORY_LABELS[c]}
                checked={form.interested_categories.includes(c)}
                onChange={() => set('interested_categories', toggle(form.interested_categories, c))}
              />
            ))}
          </div>
        </div>
        <div className={styles.formGrid}>
          <Field
            label="Products"
            optional
            hint="Separate with commas: maize, sorghum, sesame"
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
          <Field label="Preferred unit" optional error={errors.preferred_unit}>
            {(ids) => (
              <Select
                {...ids}
                value={form.preferred_unit}
                onChange={(e) => set('preferred_unit', e.target.value)}
              >
                <option value="">No preference</option>
                {LISTING_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Minimum quantity per order" optional error={errors.min_quantity}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={form.min_quantity}
                onChange={(e) => set('min_quantity', e.target.value)}
              />
            )}
          </Field>
          <Field label="Maximum quantity per order" optional error={errors.max_quantity}>
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
              label="Delivery locations"
              optional
              hint="Separate with commas: Juba, Nimule"
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
          <div role="group" aria-label="Preferred production areas">
            <p className={styles.muted}>Preferred production areas</p>
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
        <div role="group" aria-label="Months you usually buy">
          <p className={styles.muted}>Months you usually buy</p>
          <div className={styles.checkGrid}>
            {MONTH_LABELS.map((m, i) => (
              <Checkbox
                key={m}
                label={m}
                checked={form.purchasing_months.includes(i + 1)}
                onChange={() => set('purchasing_months', toggle(form.purchasing_months, i + 1))}
              />
            ))}
          </div>
        </div>
        <div role="group" aria-label="How you prefer to pay">
          <p className={styles.muted}>How you prefer to pay (recorded only; no payment is taken)</p>
          <div className={styles.checkGrid}>
            {PAYMENT_PREFERENCES.map((p) => (
              <Checkbox
                key={p}
                label={PAYMENT_LABELS[p]}
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

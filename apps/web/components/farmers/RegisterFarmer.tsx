'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';

import { LIVE_FARMERS, createFarmer } from '@/lib/farmers/api';
import { CROP_LABELS, LANGUAGE_LABELS } from '@/lib/format';
import { canRegister } from '@/lib/farmers/presentation';
import {
  validateFarmer,
  maxBirthYear,
  MIN_YEAR,
  type FarmerErrors,
  type FarmerFormValues,
} from '@/lib/farmers/schema';
import { FARMERS, FARMER_NUMBER_FORMAT, type Farmer } from '@/lib/fixtures/farmers';
import { COUNTIES, PAYAMS, STATES, payamName } from '@/lib/fixtures/p1';
import { ROLE_LABELS, usePreview } from '@/lib/preview';
import { CROPS } from '@agri-erp/shared';

import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  PrefixedInput,
  Select,
} from '../ui';
import screens from '../screens.module.css';
import styles from './farmers.module.css';
import { DuplicateWarning } from './DuplicateWarning';

// The fixture "today"; the age floor is computed against it, not the wall clock.
const REFERENCE = new Date('2026-09-02T00:00:00Z');
const MAX_YEAR = maxBirthYear(REFERENCE);

const CONSENT_VERSION: Record<'en' | 'ar-juba', string> = {
  en: 'v1.0-en',
  'ar-juba': 'v1.0-ar-juba',
};

const EMPTY: FarmerFormValues = {
  given_name: '',
  family_name: '',
  sex: '',
  year_of_birth: '',
  phone: '',
  national_id: '',
  state_id: STATES[0]?.id ?? '',
  county_id: '',
  payam_id: '',
  registration_source: 'officer',
  consent_language: '',
  consent_granted: false,
};

const FIELD_LABELS: Record<keyof FarmerFormValues, string> = {
  given_name: 'Given name',
  family_name: 'Family name',
  sex: 'Sex',
  year_of_birth: 'Year of birth',
  phone: 'Mobile number',
  national_id: 'National ID',
  state_id: 'State',
  county_id: 'County',
  payam_id: 'Payam',
  registration_source: 'How registered',
  consent_language: 'Consent language',
  consent_granted: 'Consent',
  password: 'Password',
};

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Farmer registration — the field officer's intake form.
 *
 * The form validates through `validateFarmer` (the same law the API will run
 * once C-5 lands) on blur and on submit, warns about possible duplicates as the
 * name, payam and phone are filled in, and records nothing to any server: a
 * successful submit shows the preview receipt and no more. Registration is an
 * administrator's or field officer's action; a supervisor or read-only preview
 * is turned away with the reason the live portal would give.
 */
export function RegisterFarmer() {
  const { role, hydrated } = usePreview();
  const [values, setValues] = useState<FarmerFormValues>(EMPTY);
  const [errors, setErrors] = useState<FarmerErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FarmerFormValues, boolean>>>({});
  const [saved, setSaved] = useState<{ name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [serverDupes, setServerDupes] = useState(0);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const counties = useMemo(
    () => COUNTIES.filter((c) => c.stateId === values.state_id),
    [values.state_id],
  );
  const payams = useMemo(
    () => PAYAMS.filter((p) => p.countyId === values.county_id),
    [values.county_id],
  );

  // Possible duplicates, live: same phone tail, or same name within the payam.
  const dupPhone = digits(values.phone);
  const duplicates = useMemo<Farmer[]>(() => {
    const name = `${values.given_name} ${values.family_name}`.trim().toLowerCase();
    const phoneReady = dupPhone.length >= 6;
    const nameReady = name.length >= 3 && values.payam_id !== '';
    if (!phoneReady && !nameReady) return [];
    return FARMERS.filter((f) => {
      if (f.merged_into) return false;
      const samePhone = phoneReady && digits(f.phone).endsWith(dupPhone.slice(-9));
      const sameName =
        nameReady &&
        `${f.given_name} ${f.family_name}`.trim().toLowerCase() === name &&
        f.payam_id === values.payam_id;
      return samePhone || sameName;
    }).slice(0, 4);
  }, [dupPhone, values.given_name, values.family_name, values.payam_id]);

  function set<K extends keyof FarmerFormValues>(key: K, value: FarmerFormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'state_id') {
        next.county_id = '';
        next.payam_id = '';
      }
      if (key === 'county_id') next.payam_id = '';
      return next;
    });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function blur(key: keyof FarmerFormValues) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const result = validateFarmer(values, REFERENCE);
    const message = result.ok ? undefined : result.errors[key];
    setErrors((prev) => ({ ...prev, [key]: message }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateFarmer(values, REFERENCE);
    if (!result.ok) {
      setErrors(result.errors);
      setTouched((prev) => {
        const all = { ...prev };
        (Object.keys(result.errors) as (keyof FarmerFormValues)[]).forEach((k) => {
          all[k] = true;
        });
        return all;
      });
      requestAnimationFrame(() => {
        summaryRef.current?.focus();
      });
      return;
    }
    setErrors({});
    setSubmitError(undefined);
    const v = result.values;

    if (!LIVE_FARMERS) {
      setSaved({ name: `${v.given_name} ${v.family_name}` });
      return;
    }

    setSubmitting(true);
    try {
      const res = await createFarmer({
        id: crypto.randomUUID(),
        given_name: v.given_name,
        family_name: v.family_name,
        sex: v.sex,
        year_of_birth: v.year_of_birth,
        phone: v.phone,
        national_id: v.national_id,
        payam_id: v.payam_id,
        consent: {
          text_version: CONSENT_VERSION[v.consent_language],
          language: v.consent_language,
          granted: v.consent_granted,
        },
      });
      setServerDupes(res.duplicates.length);
      setSaved({ name: `${v.given_name} ${v.family_name}` });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not register the farmer.');
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setValues(EMPTY);
    setErrors({});
    setTouched({});
    setSaved(null);
    setSubmitError(undefined);
    setServerDupes(0);
  }

  function focusField(key: keyof FarmerFormValues) {
    const wrap = document.getElementById(`fld-${key}`);
    const control = wrap?.querySelector<HTMLElement>('input, select, textarea');
    control?.focus();
  }

  if (!hydrated) return null;

  if (!canRegister(role)) {
    return (
      <>
        <PageHeader eyebrow="Farmers" title="Register a farmer" />
        <EmptyState
          error
          title="Only an administrator or field officer registers farmers"
          body={`You are previewing as ${ROLE_LABELS[role]}. Registration writes to a field officer's caseload; the live portal returns 403 for a supervisor or read-only account.`}
          actions={<ButtonLink href="/farmers">Back to the register</ButtonLink>}
        />
      </>
    );
  }

  if (saved) {
    return (
      <>
        <PageHeader eyebrow="Farmers" title="Register a farmer" />
        <div className={styles.recorded}>
          <p className="label">{LIVE_FARMERS ? 'Registered' : 'Recorded (preview, no server)'}</p>
          <p>
            {LIVE_FARMERS
              ? `${saved.name} was registered as pending and sent to the review queue.${
                  serverDupes > 0
                    ? ` ${serverDupes} possible duplicate${serverDupes > 1 ? 's were' : ' was'} flagged for a reviewer.`
                    : ''
                }`
              : `${saved.name} would be created as pending and sent to the review queue. Nothing was written; this preview build has no backend.`}
          </p>
          <div className={screens.formActions}>
            <Button variant="primary" onClick={reset}>
              Register another
            </Button>
            <ButtonLink href="/farmers" variant="secondary">
              Back to the register
            </ButtonLink>
          </div>
        </div>
      </>
    );
  }

  const errorList = (Object.keys(errors) as (keyof FarmerFormValues)[]).filter((k) => errors[k]);
  const shown = (k: keyof FarmerFormValues) => (touched[k] ? errors[k] : undefined);

  // Each field is wrapped so the error summary can anchor to it and move focus.
  const Row = ({ name, children }: { name: keyof FarmerFormValues; children: ReactNode }) => (
    <div id={`fld-${name}`}>{children}</div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Farmers"
        title="Register a farmer"
        subtitle={`New farmers enter as pending. The farmer number ${FARMER_NUMBER_FORMAT} is a placeholder until the numbering rule (C-5) is written.`}
        actions={
          <ButtonLink href="/farmers" variant="secondary">
            Cancel
          </ButtonLink>
        }
      />

      {errorList.length > 0 ? (
        <div className={styles.errorSummary} ref={summaryRef} tabIndex={-1} role="alert">
          <p className="label">
            Fix {errorList.length === 1 ? 'this' : `these ${errorList.length}`} before registering
          </p>
          <ul>
            {errorList.map((k) => (
              <li key={k}>
                <a
                  href={`#fld-${k}`}
                  onClick={(e) => {
                    e.preventDefault();
                    focusField(k);
                  }}
                >
                  {FIELD_LABELS[k]}
                </a>
                : {errors[k]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {submitError ? (
        <div className={styles.errorSummary} ref={summaryRef} tabIndex={-1} role="alert">
          <p className="label">The farmer was not registered</p>
          <p>{submitError}</p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className={screens.formLayout}>
          <div className={styles.homeStack}>
            <Card as="section" className={screens.formSection}>
              <h2 className={screens.formSectionTitle}>Identity</h2>
              <div className={screens.formGrid}>
                <Row name="given_name">
                  <Field label={FIELD_LABELS.given_name} error={shown('given_name')}>
                    {(ids) => (
                      <Input
                        {...ids}
                        value={values.given_name}
                        dir="auto"
                        onChange={(e) => set('given_name', e.target.value)}
                        onBlur={() => blur('given_name')}
                      />
                    )}
                  </Field>
                </Row>
                <Row name="family_name">
                  <Field label={FIELD_LABELS.family_name} error={shown('family_name')}>
                    {(ids) => (
                      <Input
                        {...ids}
                        value={values.family_name}
                        dir="auto"
                        onChange={(e) => set('family_name', e.target.value)}
                        onBlur={() => blur('family_name')}
                      />
                    )}
                  </Field>
                </Row>
                <Row name="sex">
                  <Field label={FIELD_LABELS.sex} error={shown('sex')}>
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.sex}
                        onChange={(e) => set('sex', e.target.value as FarmerFormValues['sex'])}
                        onBlur={() => blur('sex')}
                      >
                        <option value="">Select…</option>
                        <option value="f">Female</option>
                        <option value="m">Male</option>
                      </Select>
                    )}
                  </Field>
                </Row>
                <Row name="year_of_birth">
                  <Field
                    label={FIELD_LABELS.year_of_birth}
                    hint={`Between ${MIN_YEAR} and ${MAX_YEAR} (a lead farmer is at least 12).`}
                    error={shown('year_of_birth')}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="1994"
                        value={values.year_of_birth}
                        onChange={(e) => set('year_of_birth', digits(e.target.value))}
                        onBlur={() => blur('year_of_birth')}
                      />
                    )}
                  </Field>
                </Row>
                <Row name="phone">
                  <Field label={FIELD_LABELS.phone} error={shown('phone')}>
                    {(ids) => (
                      <PrefixedInput
                        {...ids}
                        prefix="+211"
                        inputMode="tel"
                        placeholder="9XX XXX XXX"
                        value={values.phone}
                        onChange={(e) => set('phone', e.target.value)}
                        onBlur={() => blur('phone')}
                      />
                    )}
                  </Field>
                </Row>
                <Row name="national_id">
                  <Field label={FIELD_LABELS.national_id} optional error={shown('national_id')}>
                    {(ids) => (
                      <Input
                        {...ids}
                        value={values.national_id}
                        placeholder="Leave blank if none"
                        onChange={(e) => set('national_id', e.target.value)}
                        onBlur={() => blur('national_id')}
                      />
                    )}
                  </Field>
                </Row>
              </div>
            </Card>

            <Card as="section" className={screens.formSection}>
              <h2 className={screens.formSectionTitle}>Location</h2>
              <div className={screens.formGrid}>
                <Row name="state_id">
                  <Field label={FIELD_LABELS.state_id} error={shown('state_id')}>
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.state_id}
                        onChange={(e) => set('state_id', e.target.value)}
                        onBlur={() => blur('state_id')}
                      >
                        <option value="">Select…</option>
                        {STATES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </Row>
                <Row name="county_id">
                  <Field label={FIELD_LABELS.county_id} error={shown('county_id')}>
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.county_id}
                        disabled={values.state_id === ''}
                        onChange={(e) => set('county_id', e.target.value)}
                        onBlur={() => blur('county_id')}
                      >
                        <option value="">Select…</option>
                        {counties.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </Row>
                <Row name="payam_id">
                  <Field label={FIELD_LABELS.payam_id} error={shown('payam_id')}>
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.payam_id}
                        disabled={values.county_id === ''}
                        onChange={(e) => set('payam_id', e.target.value)}
                        onBlur={() => blur('payam_id')}
                      >
                        <option value="">Select…</option>
                        {payams.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </Row>
              </div>
            </Card>

            <Card as="section" className={screens.formSection}>
              <h2 className={screens.formSectionTitle}>Registration &amp; consent</h2>
              <div className={screens.formGrid}>
                <Row name="registration_source">
                  <Field
                    label={FIELD_LABELS.registration_source}
                    error={shown('registration_source')}
                  >
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.registration_source}
                        onChange={(e) =>
                          set(
                            'registration_source',
                            e.target.value as FarmerFormValues['registration_source'],
                          )
                        }
                        onBlur={() => blur('registration_source')}
                      >
                        <option value="officer">Registered by an officer</option>
                        <option value="self">Self-registered</option>
                      </Select>
                    )}
                  </Field>
                </Row>
                <Row name="consent_language">
                  <Field
                    label={FIELD_LABELS.consent_language}
                    hint={
                      values.consent_language
                        ? `Consent text ${CONSENT_VERSION[values.consent_language]}`
                        : 'The language the consent statement was read in.'
                    }
                    error={shown('consent_language')}
                  >
                    {(ids) => (
                      <Select
                        {...ids}
                        value={values.consent_language}
                        onChange={(e) =>
                          set(
                            'consent_language',
                            e.target.value as FarmerFormValues['consent_language'],
                          )
                        }
                        onBlur={() => blur('consent_language')}
                      >
                        <option value="">Select…</option>
                        <option value="en">{LANGUAGE_LABELS.en}</option>
                        <option value="ar-juba">{LANGUAGE_LABELS['ar-juba']}</option>
                      </Select>
                    )}
                  </Field>
                </Row>
                <div className={screens.span2}>
                  <Row name="consent_granted">
                    <Field label={FIELD_LABELS.consent_granted} error={shown('consent_granted')}>
                      {() => (
                        <Checkbox
                          checked={values.consent_granted}
                          onChange={(e) => {
                            set('consent_granted', e.target.checked);
                            setTouched((prev) => ({ ...prev, consent_granted: true }));
                          }}
                          label="The farmer had the consent statement read to them and agreed to be registered."
                        />
                      )}
                    </Field>
                  </Row>
                </div>
              </div>
            </Card>

            <div className={screens.formActions}>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Registering…' : 'Register farmer'}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={submitting}>
                Clear form
              </Button>
            </div>
          </div>

          <aside className={screens.aside}>
            {duplicates.length > 0 ? (
              <DuplicateWarning
                farmer={
                  {
                    id: '__new__',
                    given_name: values.given_name,
                    family_name: values.family_name,
                    phone: values.phone,
                    payam_id: values.payam_id,
                  } as Farmer
                }
                matches={duplicates.map((f) => ({
                  farmer: f,
                  reason:
                    dupPhone.length >= 6 && digits(f.phone).endsWith(dupPhone.slice(-9))
                      ? 'phone'
                      : 'name_payam',
                }))}
              />
            ) : (
              <Notice kind="info" title="Duplicate check">
                <p className="small">
                  As you fill in the phone number and name, any possible duplicate already on the
                  register appears here. A match warns; it never blocks. The survivor is a
                  person&apos;s decision, taken from the dossier.
                </p>
              </Notice>
            )}

            <Card padded className={styles.homeAside}>
              <p className="label">After this step</p>
              <p className="small muted">
                Crop declarations and the farm boundary are captured on the next screen once the
                farmer exists:{' '}
                {CROPS.slice(0, 4)
                  .map((c) => CROP_LABELS[c])
                  .join(', ')}{' '}
                and more. The intake form records the person and their consent only.
              </p>
              <p className="small muted">
                Location is scoped to {payamName(values.payam_id) || 'Central Equatoria'}, the only
                state seeded in this preview.
              </p>
            </Card>
          </aside>
        </div>
      </form>
    </>
  );
}

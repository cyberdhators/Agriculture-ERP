'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Checkbox, Field, Input, Notice, PrefixedInput, Select } from '@/components/ui';
import { IconWarn } from '@/components/ui/icons';
import { maxBirthYear, validateFarmer, type FarmerFormValues } from '@/lib/farmers/schema';
import { FARMERS } from '@/lib/fixtures/farmers';
import { COUNTIES, PAYAMS, STATES } from '@/lib/fixtures/p1';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import styles from './farmer.module.css';

const REFERENCE = new Date('2026-09-02T00:00:00Z');
const MAX_YEAR = maxBirthYear(REFERENCE);

const CONSENT_VERSION: Record<'en' | 'ar-juba', string> = {
  en: 'v1.0-en',
  'ar-juba': 'v1.0-ar-juba',
};

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

type Step = 0 | 1 | 2;
const STEP_KEYS: Array<(keyof FarmerFormValues)[]> = [
  ['given_name', 'family_name', 'sex', 'year_of_birth'],
  ['phone', 'state_id', 'county_id', 'payam_id'],
  ['consent_language', 'consent_granted'],
];

/**
 * Self-registration in three short steps with a progress rule. It validates
 * through the same `validateFarmer` law the officer intake uses, warns about a
 * possible duplicate (same phone, or same name in the payam) without ever
 * blocking, and on submit creates the record as pending with no farmer number
 * yet (assigned when an officer verifies, C-5). The record lives in client
 * state for the session and the farmer is signed straight in.
 */
export function FarmerRegister() {
  const { language, register } = useFarmerSession();
  const router = useRouter();

  const [step, setStep] = useState<Step>(0);
  const [values, setValues] = useState<FarmerFormValues>({
    given_name: '',
    family_name: '',
    sex: '',
    year_of_birth: '',
    phone: '',
    national_id: '',
    state_id: STATES[0]?.id ?? '',
    county_id: '',
    payam_id: '',
    registration_source: 'self',
    consent_language: language,
    consent_granted: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FarmerFormValues, string>>>({});
  const [done, setDone] = useState<{ number: string } | null>(null);

  const counties = useMemo(
    () => COUNTIES.filter((c) => c.stateId === values.state_id),
    [values.state_id],
  );
  const payams = useMemo(
    () => PAYAMS.filter((p) => p.countyId === values.county_id),
    [values.county_id],
  );

  // Possible duplicates, live: same full phone, or same name within the payam.
  const duplicates = useMemo(() => {
    const phone = digits(values.phone);
    const name = `${values.given_name} ${values.family_name}`.trim().toLowerCase();
    const phoneReady = phone.length >= 9;
    const nameReady = name.length >= 3 && values.payam_id !== '';
    if (!phoneReady && !nameReady) return [];
    return FARMERS.filter((f) => {
      if (f.merged_into) return false;
      const samePhone = phoneReady && digits(f.phone).endsWith(phone.slice(-9));
      const sameName =
        nameReady &&
        `${f.given_name} ${f.family_name}`.trim().toLowerCase() === name &&
        f.payam_id === values.payam_id;
      return samePhone || sameName;
    }).slice(0, 3);
  }, [values.phone, values.given_name, values.family_name, values.payam_id]);

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

  function validateStep(current: Step): boolean {
    const result = validateFarmer({ ...values, consent_language: language }, REFERENCE);
    const stepErrors: Partial<Record<keyof FarmerFormValues, string>> = {};
    if (!result.ok) {
      for (const key of STEP_KEYS[current]!) {
        if (result.errors[key]) stepErrors[key] = result.errors[key];
      }
    }
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(2, s + 1) as Step);
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  function submit() {
    const result = validateFarmer({ ...values, consent_language: language }, REFERENCE);
    if (!result.ok) {
      setErrors(result.errors);
      // Jump to the earliest step that still has an error.
      const failStep = STEP_KEYS.findIndex((keys) => keys.some((k) => result.errors[k]));
      if (failStep >= 0) setStep(failStep as Step);
      return;
    }
    const created = register({
      given_name: result.values.given_name,
      family_name: result.values.family_name,
      sex: result.values.sex,
      year_of_birth: result.values.year_of_birth,
      phone: result.values.phone,
      payam_id: result.values.payam_id,
      state_id: result.values.state_id,
      preferred_language: language,
      consent_version: CONSENT_VERSION[language],
    });
    setDone({ number: created.farmer_number });
  }

  if (done) {
    return (
      <div className={styles.sheet}>
        <p className={styles.eyebrow}>
          <IconWarn size={16} /> {t('account.pending', language)}
        </p>
        <h1 className={styles.h1}>{t('register.doneTitle', language)}</h1>
        <p className={styles.lede}>{t('register.doneBody', language)}</p>

        <div className={styles.receiptNumber}>
          <span className={styles.recordTerm}>{t('register.doneNumber', language)}</span>
          <span className={styles.receiptNumberValue}>{t('register.donePending', language)}</span>
        </div>

        <div className={styles.actions}>
          <Button
            variant="primary"
            className={styles.blockButton}
            onClick={() => router.push('/farmer/account')}
          >
            {t('register.goToAccount', language)}
          </Button>
        </div>
      </div>
    );
  }

  const stepTitle = [
    t('register.stepName', language),
    t('register.stepContact', language),
    t('register.stepConsent', language),
  ][step];

  return (
    <div className={styles.sheet}>
      <div className={styles.progress}>
        <p className={styles.progressLabel}>
          {t('register.step', language)} {step + 1} {t('register.of', language)} 3 — {stepTitle}
        </p>
        <div className={styles.progressTrack} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`${styles.progressSeg} ${i <= step ? styles.progressSegDone : ''}`}
            />
          ))}
        </div>
      </div>

      <h1 className={styles.h1}>{t('register.title', language)}</h1>

      {duplicates.length > 0 && step > 0 ? (
        <Notice kind="warn" title={t('brand.tagline', language)}>
          <p className="small">
            A record with this phone or name already exists in{' '}
            {duplicates.map((d) => `${d.given_name} ${d.family_name}`).join(', ')}. You can still
            register — an officer will check.
          </p>
        </Notice>
      ) : null}

      {step === 0 ? (
        <div className={styles.stack}>
          <Field label={t('register.given', language)} error={errors.given_name}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                autoComplete="given-name"
                value={values.given_name}
                onChange={(e) => set('given_name', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('register.family', language)} error={errors.family_name}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                autoComplete="family-name"
                value={values.family_name}
                onChange={(e) => set('family_name', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('register.sex', language)} error={errors.sex}>
            {() => (
              <div
                className={styles.choiceRow}
                role="radiogroup"
                aria-label={t('register.sex', language)}
              >
                {(['f', 'm'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={values.sex === s}
                    className={`${styles.choice} ${values.sex === s ? styles.choiceSelected : ''}`}
                    onClick={() => set('sex', s)}
                  >
                    {s === 'f' ? t('register.female', language) : t('register.male', language)}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field
            label={t('register.yob', language)}
            hint={t('register.yobHint', language)}
            error={errors.year_of_birth}
          >
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                maxLength={4}
                placeholder="1994"
                className="mono"
                value={values.year_of_birth}
                onChange={(e) => set('year_of_birth', digits(e.target.value).slice(0, 4))}
              />
            )}
          </Field>
          <p className="small muted">
            {t('register.yobHint', language)} {MAX_YEAR}
          </p>
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.stack}>
          <Field label={t('register.phone', language)} error={errors.phone}>
            {(ids) => (
              <PrefixedInput
                {...ids}
                prefix="+211"
                inputMode="tel"
                autoComplete="tel-national"
                className="mono"
                placeholder="9XX XXX XXX"
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('register.state', language)} error={errors.state_id}>
            {(ids) => (
              <Select
                {...ids}
                value={values.state_id}
                onChange={(e) => set('state_id', e.target.value)}
              >
                <option value="">{t('register.select', language)}</option>
                {STATES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('register.county', language)} error={errors.county_id}>
            {(ids) => (
              <Select
                {...ids}
                value={values.county_id}
                disabled={values.state_id === ''}
                onChange={(e) => set('county_id', e.target.value)}
              >
                <option value="">{t('register.select', language)}</option>
                {counties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('register.payam', language)} error={errors.payam_id}>
            {(ids) => (
              <Select
                {...ids}
                value={values.payam_id}
                disabled={values.county_id === ''}
                onChange={(e) => set('payam_id', e.target.value)}
              >
                <option value="">{t('register.select', language)}</option>
                {payams.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className={styles.stack}>
          <div>
            <p className={styles.progressLabel}>{t('register.consentTitle', language)}</p>
            <div className={styles.consentBody}>{t('consent.body', language)}</div>
            <p className={styles.consentVersion}>{CONSENT_VERSION[language]}</p>
          </div>
          <Field label={t('register.consentTitle', language)} error={errors.consent_granted}>
            {() => (
              <Checkbox
                checked={values.consent_granted}
                onChange={(e) => set('consent_granted', e.target.checked)}
                label={t('register.agree', language)}
              />
            )}
          </Field>
        </div>
      ) : null}

      <div className={styles.actions}>
        {step < 2 ? (
          <Button variant="primary" className={styles.blockButton} onClick={next}>
            {t('register.next', language)}
          </Button>
        ) : (
          <Button variant="primary" className={styles.blockButton} onClick={submit}>
            {t('register.submit', language)}
          </Button>
        )}
        {step > 0 ? (
          <button type="button" className={styles.textLink} onClick={back}>
            {t('register.back', language)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

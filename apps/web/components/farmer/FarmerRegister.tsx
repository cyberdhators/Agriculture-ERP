'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  CONTACT_CHANNELS,
  HEARD_VIA,
  LAND_TENURES,
  LAND_UNITS,
  PHONE_TYPES,
  PROFILE_CROPS,
  SERVICES_WANTED,
} from '@agri-erp/shared';

import {
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  PasswordInput,
  PrefixedInput,
  Select,
} from '@/components/ui';
import { maxBirthYear, validateFarmer, type FarmerFormValues } from '@/lib/farmers/schema';
import { COUNTIES, PAYAMS, STATES } from '@/lib/fixtures/p1';
import { FarmerApiError, useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

const REFERENCE = new Date('2026-09-02T00:00:00Z');
const MAX_YEAR = maxBirthYear(REFERENCE);

/**
 * v1.2 (2026-10-07): adds that a buyer who sends a request is given the
 * farmer's phone, as CORWADO's own form declares -- "shared with transporters
 * and buyers only as needed to link me to them". Every farmer registering from
 * now agrees to this text, and the version is recorded with the consent.
 */
const CONSENT_VERSION: Record<'en' | 'ar', string> = {
  en: 'v1.2-en',
  ar: 'v1.2-ar',
};

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

type Step = 0 | 1 | 2 | 3 | 4;
const LAST_STEP: Step = 4;
const FARM_STEP: Step = 3;
const STEP_KEYS: Array<(keyof FarmerFormValues)[]> = [
  ['given_name', 'family_name', 'sex', 'year_of_birth'],
  ['phone', 'state_id', 'county_id', 'payam_id'],
  ['password'],
  [],
  ['consent_language', 'consent_granted'],
];

/** The optional "About your farm" answers, from CORWADO's registration form. */
interface FarmAnswers {
  primary_crops: string[];
  land_size: string;
  land_unit: string;
  land_tenure: string;
  years_farming: string;
  group_member: '' | 'yes' | 'no';
  group_name: string;
  next_of_kin_name: string;
  next_of_kin_relationship: string;
  next_of_kin_phone: string;
  phone_type: string;
  has_whatsapp: '' | 'yes' | 'no';
  preferred_channel: string;
  heard_via: string;
  services_wanted: string[];
}

const EMPTY_FARM: FarmAnswers = {
  primary_crops: [],
  land_size: '',
  land_unit: '',
  land_tenure: '',
  years_farming: '',
  group_member: '',
  group_name: '',
  next_of_kin_name: '',
  next_of_kin_relationship: '',
  next_of_kin_phone: '',
  phone_type: '',
  has_whatsapp: '',
  preferred_channel: '',
  heard_via: '',
  services_wanted: [],
};

/** Words for this form only, in both languages the farmer flow speaks. */
const W: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    village: 'Village or boma',
    villageHint: 'Where you live or farm.',
    stepFarm: 'About your farm (optional)',
    farmLead: 'These help buyers and CORWADO know your farm. You can skip them and add them later.',
    skip: 'Skip this step',
    crops: 'Crops you grow',
    land: 'Land you farm',
    landUnit: 'Unit',
    tenure: 'How you hold the land',
    years: 'Years farming',
    group: 'Member of a cooperative or group?',
    groupName: 'Name of the group',
    kinName: 'Next of kin (name)',
    kinRelationship: 'Relationship',
    kinPhone: 'Next of kin phone',
    phoneType: 'Type of phone',
    whatsapp: 'WhatsApp on your number?',
    channel: 'Best way to reach you',
    heard: 'How did you hear about AgriOne?',
    services: 'What would you like help with?',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    yes: 'Yes',
    no: 'No',
    choose: 'Choose…',
    failed: 'Registration was not completed.',
    feddan: 'Feddans',
    acre: 'Acres',
    hectare: 'Hectares',
    owned: 'Owned',
    rented: 'Rented',
    communal: 'Communal',
    other: 'Other',
    smartphone: 'Smartphone',
    basic: 'Basic phone',
    none: 'No phone',
    sms: 'SMS',
    voice: 'Voice call',
    app: 'This app',
    cooperative: 'Cooperative or group',
    community_leader: 'Community leader',
    ngo: 'NGO or partner',
    walk_in: 'Walked in',
    extension: 'Extension services',
    agronomy: 'Farming advice',
    market_information: 'Market prices',
    transport: 'Transport',
    buyers: 'Buyers',
    maize: 'Maize',
    sorghum: 'Sorghum',
    cassava: 'Cassava',
    groundnut: 'Groundnuts',
    sesame: 'Sesame',
    beans: 'Beans',
    vegetables: 'Vegetables',
    fruits: 'Fruits',
    rice: 'Rice',
    millet: 'Millet',
    cowpea: 'Cowpeas',
  },
  ar: {
    village: 'القرية أو البوما',
    villageHint: 'المكان الذي تسكن أو تزرع فيه.',
    stepFarm: 'عن مزرعتك (اختياري)',
    farmLead:
      'تساعد هذه المعلومات المشترين وكوروادو على معرفة مزرعتك. يمكنك تخطيها وإضافتها لاحقاً.',
    skip: 'تخطي هذه الخطوة',
    crops: 'المحاصيل التي تزرعها',
    land: 'الأرض التي تزرعها',
    landUnit: 'الوحدة',
    tenure: 'طريقة حيازة الأرض',
    years: 'سنوات الزراعة',
    group: 'هل أنت عضو في تعاونية أو مجموعة؟',
    groupName: 'اسم المجموعة',
    kinName: 'أقرب الأقارب (الاسم)',
    kinRelationship: 'صلة القرابة',
    kinPhone: 'هاتف أقرب الأقارب',
    phoneType: 'نوع الهاتف',
    whatsapp: 'هل لديك واتساب على رقمك؟',
    channel: 'أفضل طريقة للتواصل معك',
    heard: 'كيف سمعت عن أجري ون؟',
    services: 'ما المساعدة التي تريدها؟',
    selectAll: 'تحديد الكل',
    clearAll: 'إلغاء الكل',
    yes: 'نعم',
    no: 'لا',
    choose: 'اختر…',
    failed: 'لم يكتمل التسجيل.',
    feddan: 'فدان',
    acre: 'إيكر',
    hectare: 'هكتار',
    owned: 'ملك',
    rented: 'إيجار',
    communal: 'جماعية',
    other: 'أخرى',
    smartphone: 'هاتف ذكي',
    basic: 'هاتف عادي',
    none: 'لا يوجد هاتف',
    sms: 'رسائل نصية',
    voice: 'مكالمة صوتية',
    app: 'هذا التطبيق',
    cooperative: 'تعاونية أو مجموعة',
    community_leader: 'زعيم المجتمع',
    ngo: 'منظمة أو شريك',
    walk_in: 'حضرت بنفسي',
    extension: 'خدمات الإرشاد',
    agronomy: 'نصائح زراعية',
    market_information: 'أسعار السوق',
    transport: 'النقل',
    buyers: 'المشترون',
    maize: 'ذرة شامية',
    sorghum: 'ذرة رفيعة',
    cassava: 'كسافا',
    groundnut: 'فول سوداني',
    sesame: 'سمسم',
    beans: 'فاصوليا',
    vegetables: 'خضروات',
    fruits: 'فواكه',
    rice: 'أرز',
    millet: 'دخن',
    cowpea: 'لوبيا',
  },
};

/**
 * SELF-REGISTRATION (B14, 2026-10-07). Farmers enrol themselves -- CORWADO has
 * no staff to do it -- so the form is short and needs nobody's help:
 *
 *   1. name, sex and year of birth;
 *   2. phone, state, county, payam and village;
 *   3. a password;
 *   4. about the farm -- CORWADO's registration-form questions, all optional,
 *      with a button to skip;
 *   5. consent (v1.2).
 *
 * The farmer is created on the server, signed in at once, and can list
 * produce straight away; verification by an officer is optional and shown to
 * buyers. The steps validate with the same law the officer intake uses, and
 * the server's own field reasons are shown if it refuses anyway.
 */
export function FarmerRegister() {
  const { language, register } = useFarmerSession();
  const router = useRouter();
  const w = W[language === 'ar' ? 'ar' : 'en'];

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
    password: '',
  });
  const [village, setVillage] = useState('');
  const [villageError, setVillageError] = useState<string | undefined>();
  const [farm, setFarm] = useState<FarmAnswers>(EMPTY_FARM);
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Partial<Record<keyof FarmerFormValues, string>>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: string } | null>(null);

  const counties = useMemo(
    () => COUNTIES.filter((c) => c.stateId === values.state_id),
    [values.state_id],
  );
  const payams = useMemo(
    () => PAYAMS.filter((p) => p.countyId === values.county_id),
    [values.county_id],
  );

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

  const setF = <K extends keyof FarmAnswers>(key: K, value: FarmAnswers[K]) =>
    setFarm((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: 'primary_crops' | 'services_wanted', item: string) =>
    setFarm((prev) => ({
      ...prev,
      [key]: prev[key].includes(item) ? prev[key].filter((x) => x !== item) : [...prev[key], item],
    }));

  function validateStep(current: Step): boolean {
    const result = validateFarmer({ ...values, consent_language: language }, REFERENCE, {
      requirePassword: true,
    });
    const stepErrors: Partial<Record<keyof FarmerFormValues, string>> = {};
    if (!result.ok) {
      for (const key of STEP_KEYS[current]!) {
        if (result.errors[key]) stepErrors[key] = result.errors[key];
      }
    }
    setErrors(stepErrors);
    let villageMissing = false;
    if (current === 1) {
      villageMissing = village.trim() === '';
      setVillageError(villageMissing ? 'Give your village or boma.' : undefined);
    }
    const mismatch = current === 2 && !stepErrors.password && confirm !== values.password;
    setConfirmError(mismatch ? t('register.passwordMismatch', language) : undefined);
    return Object.keys(stepErrors).length === 0 && !mismatch && !villageMissing;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(LAST_STEP, s + 1) as Step);
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  /** The farm answers as the API takes them: blanks left out, numbers as numbers. */
  function farmBody(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (farm.primary_crops.length) out.primary_crops = farm.primary_crops;
    if (farm.services_wanted.length) out.services_wanted = farm.services_wanted;
    if (farm.land_size.trim()) out.land_size = Number(farm.land_size);
    if (farm.land_unit) out.land_unit = farm.land_unit;
    if (farm.land_tenure) out.land_tenure = farm.land_tenure;
    if (farm.years_farming.trim()) out.years_farming = Number(farm.years_farming);
    if (farm.group_member) out.group_member = farm.group_member === 'yes';
    if (farm.group_name.trim()) out.group_name = farm.group_name;
    if (farm.next_of_kin_name.trim()) out.next_of_kin_name = farm.next_of_kin_name;
    if (farm.next_of_kin_relationship.trim())
      out.next_of_kin_relationship = farm.next_of_kin_relationship;
    if (farm.next_of_kin_phone.trim()) out.next_of_kin_phone = farm.next_of_kin_phone;
    if (farm.phone_type) out.phone_type = farm.phone_type;
    if (farm.has_whatsapp) out.has_whatsapp = farm.has_whatsapp === 'yes';
    if (farm.preferred_channel) out.preferred_channel = farm.preferred_channel;
    if (farm.heard_via) out.heard_via = farm.heard_via;
    return out;
  }

  async function submit() {
    const result = validateFarmer({ ...values, consent_language: language }, REFERENCE, {
      requirePassword: true,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const failStep = STEP_KEYS.findIndex((keys) => keys.some((k) => result.errors[k]));
      if (failStep >= 0) setStep(failStep as Step);
      return;
    }
    setBusy(true);
    setFailure(null);
    setServerErrors({});
    try {
      const created = await register({
        given_name: result.values.given_name,
        family_name: result.values.family_name,
        sex: result.values.sex,
        year_of_birth: Number(result.values.year_of_birth),
        phone: result.values.phone,
        password: result.values.password ?? '',
        confirm_password: result.values.password ?? '',
        payam_id: result.values.payam_id,
        village: village.trim(),
        consent: {
          text_version: CONSENT_VERSION[language === 'ar' ? 'ar' : 'en'],
          language: language === 'ar' ? 'ar' : 'en',
          granted: true,
        },
        ...farmBody(),
      });
      setDone({ number: created.farmer_number });
    } catch (error) {
      if (error instanceof FarmerApiError) {
        setServerErrors(error.fields);
        setFailure(error.message);
      } else {
        setFailure(w.failed ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={styles.sheet}>
        <h1 className={styles.h1}>{t('register.doneTitle', language)}</h1>
        <p className={styles.lede}>{t('register.doneBody', language)}</p>

        <div className={styles.receiptNumber}>
          <span className={styles.recordTerm}>{t('register.doneNumber', language)}</span>
          <span className={`${styles.receiptNumberValue} mono`}>{done.number}</span>
          <span className={styles.receiptNote}>{t('register.donePending', language)}</span>
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
    t('register.stepPassword', language),
    w.stepFarm,
    t('register.stepConsent', language),
  ][step];

  const choose = (
    label: string,
    value: string,
    options: readonly string[],
    onChange: (v: string) => void,
  ) => (
    <Field label={label} optional>
      {(ids) => (
        <Select {...ids} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{w.choose}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {w[o] ?? o}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const yesNo = (
    label: string,
    value: '' | 'yes' | 'no',
    onChange: (v: '' | 'yes' | 'no') => void,
  ) => choose(label, value, ['yes', 'no'], (v) => onChange(v as '' | 'yes' | 'no'));

  const serverList = Object.values(serverErrors);

  return (
    <div className={styles.sheet}>
      <div className={styles.progress}>
        <p className={styles.progressLabel}>
          {t('register.step', language)} {step + 1} {t('register.of', language)} {LAST_STEP + 1}:{' '}
          {stepTitle}
        </p>
        <div className={styles.progressTrack} aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`${styles.progressSeg} ${i <= step ? styles.progressSegDone : ''}`}
            />
          ))}
        </div>
      </div>

      <h1 className={styles.h1}>{t('register.title', language)}</h1>
      {step === 0 ? (
        <p className="small muted">
          {language === 'ar'
            ? 'هذا الحساب للمزارعين الذين يبيعون منتجاتهم. هل تريد الشراء؟ '
            : 'This account is for farmers selling their produce. Want to buy instead? '}
          <a href="/buyer/register">{language === 'ar' ? 'سجّل كمشترٍ' : 'Register as a buyer'}</a>
        </p>
      ) : null}

      {failure ? (
        <Notice kind="error" title={failure}>
          {serverList.length ? (
            <ul className="small">
              {serverList.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
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
            {(ids) => (
              <div
                className={styles.choiceRow}
                role="radiogroup"
                id={ids.id}
                aria-label={t('register.sex', language)}
                aria-describedby={ids['aria-describedby']}
                aria-invalid={ids['aria-invalid']}
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
            hint={`${t('register.yobHint', language)} ${MAX_YEAR}`}
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
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.stack}>
          <Field label={t('register.phone', language)} error={errors.phone ?? serverErrors.phone}>
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
          <Field
            label={w.village!}
            hint={w.villageHint}
            error={villageError ?? serverErrors.village}
          >
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={village}
                onChange={(e) => {
                  setVillage(e.target.value);
                  setVillageError(undefined);
                }}
              />
            )}
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className={styles.stack}>
          <Field
            label={t('register.password', language)}
            hint={t('register.passwordHint', language)}
            error={errors.password}
          >
            {(ids) => (
              <PasswordInput
                {...ids}
                autoComplete="new-password"
                value={values.password ?? ''}
                showLabel={t('login.show', language)}
                hideLabel={t('login.hide', language)}
                onChange={(e) => set('password', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('register.passwordConfirm', language)} error={confirmError}>
            {(ids) => (
              <PasswordInput
                {...ids}
                autoComplete="new-password"
                value={confirm}
                showLabel={t('login.show', language)}
                hideLabel={t('login.hide', language)}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setConfirmError(undefined);
                }}
              />
            )}
          </Field>
        </div>
      ) : null}

      {step === FARM_STEP ? (
        <div className={styles.stack}>
          <p className="small muted">{w.farmLead}</p>
          <fieldset className={styles.stack} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">{w.crops}</legend>
            <div className={styles.choiceRow} style={{ flexWrap: 'wrap' }}>
              {PROFILE_CROPS.map((c) => (
                <Checkbox
                  key={c}
                  label={w[c] ?? c}
                  checked={farm.primary_crops.includes(c)}
                  onChange={() => toggle('primary_crops', c)}
                />
              ))}
            </div>
          </fieldset>
          <Field label={w.land!} optional error={serverErrors.land_size}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                className="mono"
                value={farm.land_size}
                onChange={(e) => setF('land_size', e.target.value)}
              />
            )}
          </Field>
          {choose(w.landUnit!, farm.land_unit, LAND_UNITS, (v) => setF('land_unit', v))}
          {choose(w.tenure!, farm.land_tenure, LAND_TENURES, (v) => setF('land_tenure', v))}
          <Field label={w.years!} optional error={serverErrors.years_farming}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                className="mono"
                value={farm.years_farming}
                onChange={(e) => setF('years_farming', digits(e.target.value).slice(0, 3))}
              />
            )}
          </Field>
          {yesNo(w.group!, farm.group_member, (v) => setF('group_member', v))}
          {farm.group_member === 'yes' ? (
            <Field label={w.groupName!} optional>
              {(ids) => (
                <Input
                  {...ids}
                  dir="auto"
                  value={farm.group_name}
                  onChange={(e) => setF('group_name', e.target.value)}
                />
              )}
            </Field>
          ) : null}
          <Field label={w.kinName!} optional>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={farm.next_of_kin_name}
                onChange={(e) => setF('next_of_kin_name', e.target.value)}
              />
            )}
          </Field>
          <Field label={w.kinRelationship!} optional>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={farm.next_of_kin_relationship}
                onChange={(e) => setF('next_of_kin_relationship', e.target.value)}
              />
            )}
          </Field>
          <Field label={w.kinPhone!} optional error={serverErrors.next_of_kin_phone}>
            {(ids) => (
              <PrefixedInput
                {...ids}
                prefix="+211"
                inputMode="tel"
                className="mono"
                value={farm.next_of_kin_phone}
                onChange={(e) => setF('next_of_kin_phone', e.target.value)}
              />
            )}
          </Field>
          {choose(w.phoneType!, farm.phone_type, PHONE_TYPES, (v) => setF('phone_type', v))}
          {yesNo(w.whatsapp!, farm.has_whatsapp, (v) => setF('has_whatsapp', v))}
          {choose(w.channel!, farm.preferred_channel, CONTACT_CHANNELS, (v) =>
            setF('preferred_channel', v),
          )}
          {choose(w.heard!, farm.heard_via, HEARD_VIA, (v) => setF('heard_via', v))}
          <fieldset className={styles.stack} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">{w.services}</legend>
            {/* 2026-10-10 (CORWADO): all at once instead of one by one. */}
            <div>
              <Button
                type="button"
                variant="ghost"
                size="small"
                onClick={() =>
                  setF(
                    'services_wanted',
                    farm.services_wanted.length === SERVICES_WANTED.length
                      ? []
                      : [...SERVICES_WANTED],
                  )
                }
              >
                {farm.services_wanted.length === SERVICES_WANTED.length ? w.clearAll : w.selectAll}
              </Button>
            </div>
            <div className={styles.choiceRow} style={{ flexWrap: 'wrap' }}>
              {SERVICES_WANTED.map((s) => (
                <Checkbox
                  key={s}
                  label={w[s] ?? s}
                  checked={farm.services_wanted.includes(s)}
                  onChange={() => toggle('services_wanted', s)}
                />
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {step === 4 ? (
        <div className={styles.stack}>
          <div>
            <p className={styles.progressLabel}>{t('register.consentTitle', language)}</p>
            <div className={styles.consentBody}>{t('consent.body', language)}</div>
            <p className={styles.consentVersion}>
              {CONSENT_VERSION[language === 'ar' ? 'ar' : 'en']}
            </p>
          </div>
          <Field label={t('register.consentTitle', language)} error={errors.consent_granted}>
            {(ids) => (
              <Checkbox
                {...ids}
                checked={values.consent_granted}
                onChange={(e) => set('consent_granted', e.target.checked)}
                label={t('register.agree', language)}
              />
            )}
          </Field>
        </div>
      ) : null}

      <div className={styles.actions}>
        {step < LAST_STEP ? (
          <Button variant="primary" className={styles.blockButton} onClick={next}>
            {t('register.next', language)}
          </Button>
        ) : (
          <Button
            variant="primary"
            className={styles.blockButton}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '…' : t('register.submit', language)}
          </Button>
        )}
        {step === FARM_STEP ? (
          <button type="button" className={styles.textLink} onClick={() => setStep(LAST_STEP)}>
            {w.skip}
          </button>
        ) : null}
        {step > 0 ? (
          <button type="button" className={styles.textLink} onClick={back}>
            {t('register.back', language)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type { Language };

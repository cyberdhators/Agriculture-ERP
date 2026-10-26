import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateFarmer, type FarmerFormValues } from '../lib/farmers/schema';
import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';

/**
 * 2026-11-02 (owner, 2026-10-26: "make the registration form compulsory,
 * details should be fixed"). The sign-up forms ask for every detail and let
 * none be skipped; only the profile extras stay optional. The server's half
 * is in packages/shared/tests (farmer-account, buyer).
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

const REFERENCE = new Date('2026-09-02T00:00:00Z');
const complete = (): FarmerFormValues => ({
  given_name: 'Demo',
  family_name: 'Farmer',
  sex: 'f',
  year_of_birth: '1990',
  phone: '+211912345678',
  national_id: '',
  state_id: 'CE',
  county_id: 'CE-JUB',
  payam_id: 'CE-JUB-KAT',
  registration_source: 'self',
  consent_language: 'en',
  consent_granted: true,
  password: 'maize1',
});

describe('the phone sign-up form requires every detail', () => {
  it('accepts a complete form', () => {
    expect(validateFarmer(complete(), REFERENCE, { requirePassword: true }).ok).toBe(true);
  });

  it.each([
    ['sex', 'Select female or male.'],
    ['year_of_birth', 'Enter the year of birth.'],
    ['state_id', 'Select a state.'],
    ['county_id', 'Select a county.'],
    ['payam_id', 'Select a payam.'],
    ['given_name', 'Enter the given name.'],
    ['family_name', 'Enter the family name.'],
  ] as const)('refuses a form without %s', (key, reason) => {
    const result = validateFarmer({ ...complete(), [key]: '' }, REFERENCE, {
      requirePassword: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBe(reason);
  });

  it('refuses a form without the password or the consent', () => {
    const noPassword = validateFarmer({ ...complete(), password: '' }, REFERENCE, {
      requirePassword: true,
    });
    expect(noPassword.ok).toBe(false);
    const noConsent = validateFarmer({ ...complete(), consent_granted: false }, REFERENCE, {
      requirePassword: true,
    });
    expect(noConsent.ok).toBe(false);
  });

  it('has no switch left that makes the details optional', () => {
    expect(read('lib/farmers/schema.ts')).not.toMatch(/optionalPersonal\??:/);
    expect(read('components/farmer/FarmerRegister.tsx')).not.toMatch(/optionalPersonal/);
  });

  const form = read('components/farmer/FarmerRegister.tsx');
  const detailsStep = form.slice(
    form.indexOf('{step === DETAILS_STEP ? ('),
    form.indexOf('{step === FARM_STEP ? ('),
  );

  it('asks for sex, year, place and village on a step of their own, none marked optional', () => {
    expect(detailsStep.length).toBeGreaterThan(100);
    for (const label of [
      "t('register.sex', language)",
      "t('register.yob', language)",
      "t('register.state', language)",
      "t('register.county', language)",
      "t('register.payam', language)",
      'w.village!',
    ]) {
      expect(detailsStep, label).toContain(label);
    }
    expect(detailsStep).not.toMatch(/\boptional\b/);
  });

  it('offers the skip button on the farm step only', () => {
    expect(form).toMatch(
      /\{step === FARM_STEP \? \(\s*<button[^\n]*onClick=\{\(\) => setStep\(LAST_STEP\)\}/,
    );
    expect(form.match(/w\.skip/g)?.length).toBe(1);
  });

  it('checks the body with the route’s own schema before sending it', () => {
    expect(form).toMatch(/farmerSelfRegisterSchema\.safeParse\(body\)/);
    expect(form).toMatch(/const created = await register\(body\)/);
  });

  it('says the village is required in English and Arabic, and no longer says the place can be skipped', () => {
    expect(form).toContain("villageRequired: 'Give your village or boma.'");
    expect(form).toContain("villageRequired: 'اكتب قريتك أو البوما.'");
    expect(form).not.toContain('if you skip it now');
    expect(form).not.toContain('More about you (optional)');
    expect(form).not.toContain('يُطلب عند نشر عرض إذا تخطيته الآن');
  });
});

describe('the email sign-up form requires the kind and the state', () => {
  const form = read('components/buyer/BuyerRegister.tsx');

  it('chooses no kind for the applicant', () => {
    expect(form).toMatch(/useState<'individual' \| 'business' \| ''>\(''\)/);
  });

  it('asks for the state from the public state list, without a session', () => {
    expect(form).toMatch(/listSignUpStates\(\)/);
    expect(form).toMatch(/state_id: stateId/);
    expect(read('lib/buyer/api.ts')).toMatch(/'\/api\/locations\/states'/);
    const route = read('app/api/locations/states/route.ts');
    expect(route).toMatch(/roles: 'public'/);
    expect(route).toMatch(/FROM public\.state_active/);
    expect(route).not.toMatch(/POST:|PATCH:|DELETE:|PUT:/);
  });

  it('speaks the new reasons in English and Arabic', () => {
    for (const key of [
      'email.reg.where',
      'email.reg.state',
      'email.reg.stateChoose',
      'email.reg.stateRequired',
      'email.reg.statesFailed',
      'email.reg.accountTypeRequired',
    ] as const) {
      expect(en[key], key).toBeTruthy();
      expect(ar[key], key).toBeTruthy();
      expect(ar[key], key).not.toBe(en[key]);
    }
  });
});

describe('the details screen no longer calls the details optional', () => {
  const screen = read('components/farmer/FarmerDetails.tsx');
  it('in either language', () => {
    expect(screen).not.toContain('Your details (optional)');
    expect(screen).not.toContain('تفاصيلك (اختياري)');
    expect(screen).not.toContain('Sign-up did not ask for these. Add them now or later');
  });
});

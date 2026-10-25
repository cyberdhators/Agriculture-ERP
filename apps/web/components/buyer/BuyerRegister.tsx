'use client';

import { useState, type FormEvent } from 'react';

import {
  SIGN_IN_ANNOUNCE_HEADER,
  buyerRegistrationSchema,
  zodErrorToApiError,
  type AccountLanguage,
  type BuyerRegistration,
} from '@agri-erp/shared';

import { BUYER_HOME_PATH, LOGIN_PATH } from '@/lib/auth/paths';
import { BuyerApiError, registerBuyer, sendEmailCode, verifyEmailCode } from '@/lib/buyer/api';
import { DEFAULT_LANGUAGE, isRtl, t, type Language, type TKey } from '@/lib/i18n';
import { useDocumentLanguage, useLanguageChoice } from '@/lib/i18n/client';
import { useNoticeText, type ConsentText } from '@/lib/settings/client';
import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Checkbox, Field, Input, Notice, PageHeader, PasswordInput } from '../ui';
import {
  EMPTY_ORG,
  ProcurementFields,
  toOrganizationBody,
  type OrgForm,
} from './ProcurementFields';
import styles from './buyer.module.css';

/**
 * 2026-10-28 (user journeys): the built-in terms of use and privacy notice,
 * shown until the published ones (Settings, notices of kind `terms` and
 * `privacy`) arrive, and whenever they cannot be read. The version shown is
 * the version recorded.
 */
const FALLBACK_TERMS: Record<AccountLanguage, ConsentText> = {
  en: {
    text_version: 'v1.0-en',
    body:
      'AgriOne connects people who buy, sell, offer services and give advice in agriculture. ' +
      'You deal with other members directly: CORWADO does not take part in, pay for or guarantee ' +
      'any trade. Post only true information, respect other members, and do not misuse the ' +
      'messages. CORWADO may remove posts or suspend accounts that break these rules, with a reason.',
  },
  ar: {
    text_version: 'v1.0-ar',
    body:
      'يربط أجري ون بين من يشترون ويبيعون ويقدمون الخدمات والنصائح في الزراعة. ' +
      'تتعامل مع الأعضاء الآخرين مباشرة: لا تشارك كوروادو في أي صفقة ولا تدفع عنها ولا تضمنها. ' +
      'انشر معلومات صحيحة فقط، واحترم الأعضاء الآخرين، ولا تسئ استخدام الرسائل. ' +
      'يجوز لكوروادو إزالة المنشورات أو تعليق الحسابات المخالفة لهذه القواعد مع ذكر السبب.',
  },
};

const FALLBACK_PRIVACY: Record<AccountLanguage, ConsentText> = {
  en: {
    text_version: 'v1.0-en',
    body:
      'Your email, password and sign-in history are private. Your password is stored so that ' +
      'nobody, including CORWADO staff, can read it. Your name and the details you choose to ' +
      'publish are shown to other members; your phone number is shown only where you choose. ' +
      'You can ask to delete your account in Settings; some records may be kept for a limited ' +
      'time for legal, safety and security reasons.',
  },
  ar: {
    text_version: 'v1.0-ar',
    body:
      'بريدك الإلكتروني وكلمة المرور وسجل الدخول خاصة بك. تُحفظ كلمة المرور بحيث لا يستطيع أحد قراءتها، ' +
      'بما في ذلك موظفو كوروادو. يظهر اسمك والتفاصيل التي تختار نشرها للأعضاء الآخرين، ' +
      'ولا يظهر رقم هاتفك إلا حيث تختار. يمكنك طلب حذف حسابك من الإعدادات؛ ' +
      'وقد تُحفظ بعض السجلات لفترة محدودة لأسباب قانونية وأمنية.',
  },
};

/**
 * APPLY FOR A BUYER ACCOUNT (C-14B.1, C-14B.2).
 *
 * Validated here with the shared schema the route runs. On success the account
 * exists; the applicant is signed in with the password they just chose and
 * taken to the dashboard. Nothing on this page lets an applicant choose their
 * own standing.
 *
 * State and county are not asked here: the location list is read with a
 * session, and an applicant has none yet. They are on the profile, one click
 * from the dashboard.
 *
 * 2026-10-28 (user journeys, CORWADO's specification line 38): a language
 * choice; the terms of use and privacy notice with an UNTICKED box that must
 * be ticked; and, when the deployment sends mail, a 6-digit code to the
 * address before the account is made (send again, change the address). The
 * account is active as soon as it is created -- no approval queue.
 */
export function BuyerRegister({
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  /** 2026-10-29: from the language cookie; the page then speaks the chosen language. */
  initialLanguage?: Language;
} = {}) {
  const [person, setPerson] = useState({
    given_name: '',
    family_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
  });
  const [org, setOrg] = useState<OrgForm>(EMPTY_ORG);
  const [accountType, setAccountType] = useState<'individual' | 'business'>('individual');
  const individual = accountType === 'individual';
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2026-10-29: the language choice is also the page's language, and is kept.
  const [language, setLanguage] = useLanguageChoice(initialLanguage);
  useDocumentLanguage(language);
  const w = (key: TKey) => t(key, language);
  // Unticked at first, always (the specification, section 6).
  const [agreed, setAgreed] = useState(false);
  const terms = useNoticeText('terms', language, FALLBACK_TERMS[language]);
  const privacy = useNoticeText('privacy', language, FALLBACK_PRIVACY[language]);
  /** The email code step, once a code has been sent. */
  const [codeFor, setCodeFor] = useState<{ id: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeNote, setCodeNote] = useState<string | null>(null);

  const setP = (key: keyof typeof person) => (value: string) =>
    setPerson((p) => ({ ...p, [key]: value }));

  /** The whole body, validated with the route's own schema. */
  const parse = () =>
    buyerRegistrationSchema.safeParse({
      account_type: accountType,
      ...person,
      ...toOrganizationBody(org, false, individual),
      preferred_language: language,
      ...(agreed
        ? {
            acknowledgement: {
              text_version: `terms:${terms.text_version};privacy:${privacy.text_version}`,
              language,
              granted: true,
            },
          }
        : {}),
    });

  const report = (e: unknown) => {
    if (e instanceof BuyerApiError) {
      setErrors(e.fields);
      setFailure(e.status === 409 ? w('email.reg.alreadyExists') : e.message);
      // A code that could not be used goes back to the form, with the reason.
      setCodeFor(null);
    } else {
      setFailure(w('email.reg.notSent'));
    }
    setBusy(false);
  };

  const finish = async (data: BuyerRegistration, verificationId: string | undefined) => {
    try {
      await registerBuyer({
        ...data,
        ...(verificationId ? { verification_id: verificationId } : {}),
      });
      const { error } = await supabaseBrowser().auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      // 2026-10-24 (acceptance QA): the sign-in that follows registration is
      // announced, so the access log records it as the account's first sign-in.
      if (!error) {
        await fetch('/api/me', { headers: { [SIGN_IN_ANNOUNCE_HEADER]: '1' } }).catch(
          () => undefined,
        );
      }
      window.location.assign(error ? LOGIN_PATH : BUYER_HOME_PATH);
    } catch (e) {
      // No answer (network drop or the 45-second limit): the account may have
      // been saved anyway. Signing in with what was just typed settles it --
      // if it works, the buyer is registered and goes straight in.
      if (e instanceof BuyerApiError && e.status === 0) {
        const { error } = await supabaseBrowser().auth.signInWithPassword({
          email: data.email,
          password: data.password,
        });
        if (!error) {
          window.location.assign(BUYER_HOME_PATH);
          return;
        }
        setFailure(w('email.reg.timeout'));
        setBusy(false);
        return;
      }
      throw e;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const parsed = parse();
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      setFailure(w('email.reg.needsAttention'));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // A code is asked for once; when this deployment does not verify
      // addresses the server says so and the account is created at once.
      const sent = await sendEmailCode({ email: parsed.data.email, language });
      if (sent.required && sent.verification_id) {
        setCodeFor({ id: sent.verification_id, email: parsed.data.email });
        setCode('');
        setCodeError(null);
        setCodeNote(null);
        setBusy(false);
        return;
      }
      await finish(parsed.data, undefined);
    } catch (e) {
      report(e);
    }
  };

  const confirmCode = async () => {
    if (!codeFor) return;
    setBusy(true);
    setCodeError(null);
    try {
      await verifyEmailCode(codeFor.id, code.trim());
    } catch (e) {
      setCodeError(e instanceof BuyerApiError ? e.message : w('email.reg.codeCheckFailed'));
      setBusy(false);
      return;
    }
    const parsed = parse();
    if (!parsed.success || parsed.data.email !== codeFor.email) {
      // The form changed under the code: start again from the form.
      setCodeFor(null);
      setBusy(false);
      return;
    }
    try {
      await finish(parsed.data, codeFor.id);
    } catch (e) {
      report(e);
    }
  };

  const resendCode = async () => {
    if (!codeFor) return;
    setBusy(true);
    setCodeError(null);
    setCodeNote(null);
    try {
      const sent = await sendEmailCode({ email: codeFor.email, language });
      if (sent.verification_id) setCodeFor({ id: sent.verification_id, email: codeFor.email });
      setCode('');
      setCodeNote(w('email.reg.codeResent'));
    } catch (e) {
      setCodeError(e instanceof BuyerApiError ? e.message : w('email.reg.codeSendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const ackError = errors.acknowledgement ?? errors['acknowledgement.granted'];

  return (
    <main className={styles.registerWrap} dir={isRtl(language) ? 'rtl' : 'ltr'}>
      <div className={styles.registerInner}>
        <Wordmark size={28} tagline />
        <PageHeader title={w('email.login.createEmail')} subtitle={w('email.reg.subtitle')} />
        <p className="small">
          {w('email.reg.phoneQ')} <a href="/farmer/register">{w('email.reg.phoneLink')}</a>{' '}
          {w('email.reg.instead')} {w('email.reg.haveAccount')}{' '}
          <a href="/login?next=/buyer/marketplace">{w('login.submit')}</a>.
        </p>
        <Card padded>
          <form
            className={styles.form}
            onSubmit={submit}
            noValidate
            aria-label={w('email.reg.formAria')}
          >
            {failure ? (
              <Notice kind="error" title={w('email.reg.notSentTitle')}>
                {failure}
              </Notice>
            ) : null}

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>{w('account.language')}</legend>
              <div
                className={styles.checkGrid}
                role="radiogroup"
                aria-label={w('account.language')}
              >
                {(
                  [
                    ['en', t('language.name', 'en')],
                    ['ar', t('language.arabicNative', 'en')],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} lang={value} dir={isRtl(value) ? 'rtl' : 'ltr'}>
                    <input
                      type="radio"
                      name="preferred_language"
                      value={value}
                      checked={language === value}
                      onChange={() => setLanguage(value)}
                    />{' '}
                    {label}
                  </label>
                ))}
              </div>
              <p className={styles.muted}>{w('email.reg.langNote')}</p>
              {errors.preferred_language ? <p role="alert">{errors.preferred_language}</p> : null}
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>{w('email.reg.who')}</legend>
              <div
                className={styles.checkGrid}
                role="radiogroup"
                aria-label={w('email.reg.accountTypeAria')}
              >
                {(
                  [
                    ['individual', w('email.reg.individual'), w('email.reg.individualHint')],
                    ['business', w('email.reg.business'), w('email.reg.businessHint')],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className={styles.form} style={{ gap: 2 }}>
                    <span>
                      <input
                        type="radio"
                        name="account_type"
                        value={value}
                        checked={accountType === value}
                        onChange={() => setAccountType(value)}
                      />{' '}
                      {label}
                    </span>
                    <span className={styles.muted}>{hint}</span>
                  </label>
                ))}
              </div>
              {errors.account_type ? <p role="alert">{errors.account_type}</p> : null}
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>{w('email.reg.yourAccount')}</legend>
              <div className={styles.formGrid}>
                <Field label={w('buyer.field.givenName')} error={errors.given_name}>
                  {(ids) => (
                    <Input
                      {...ids}
                      autoComplete="given-name"
                      value={person.given_name}
                      onChange={(e) => setP('given_name')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={w('buyer.field.familyName')} error={errors.family_name}>
                  {(ids) => (
                    <Input
                      {...ids}
                      autoComplete="family-name"
                      value={person.family_name}
                      onChange={(e) => setP('family_name')(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={w('buyer.field.email')}
                  hint={w('email.reg.emailHint')}
                  error={errors.email}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      type="email"
                      autoComplete="email"
                      value={person.email}
                      disabled={Boolean(codeFor)}
                      onChange={(e) => setP('email')(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={w('buyer.field.mobile')}
                  hint={w('buyer.field.mobileHint')}
                  error={errors.phone}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      type="tel"
                      autoComplete="tel"
                      value={person.phone}
                      onChange={(e) => setP('phone')(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label={w('login.passwordLabel')}
                  hint={w('email.reg.passwordHint')}
                  error={errors.password}
                >
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="new-password"
                      value={person.password}
                      onChange={(e) => setP('password')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={w('email.reg.confirmPassword')} error={errors.confirm_password}>
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="new-password"
                      value={person.confirm_password}
                      onChange={(e) => setP('confirm_password')(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            <ProcurementFields
              form={org}
              onChange={setOrg}
              errors={errors}
              individual={individual}
              language={language}
            />

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>{w('email.reg.terms')}</legend>
              <div dir={language === 'ar' ? 'rtl' : 'auto'} className="small">
                <p>{terms.body}</p>
                <p>{privacy.body}</p>
              </div>
              <p className={`${styles.muted} mono`}>
                {w('email.reg.versions')
                  .replace('{terms}', terms.text_version)
                  .replace('{privacy}', privacy.text_version)}
              </p>
              <Checkbox
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.acknowledgement;
                    delete next['acknowledgement.granted'];
                    return next;
                  });
                }}
                aria-invalid={ackError ? true : undefined}
                label={w('email.reg.agree')}
              />
              {ackError ? <p role="alert">{ackError}</p> : null}
            </fieldset>

            {codeFor ? (
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>{w('email.reg.codeTitle')}</legend>
                <p className="small">
                  {w('email.reg.codeSentBefore')} <strong dir="ltr">{codeFor.email}</strong>
                  {w('email.reg.codeSentAfter')}
                </p>
                {codeNote ? <p className="small">{codeNote}</p> : null}
                <Field label={w('email.reg.code')} error={codeError ?? undefined}>
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="mono"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                  )}
                </Field>
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void resendCode()}
                  >
                    {w('email.reg.resend')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setCodeFor(null);
                      setCode('');
                      setCodeError(null);
                    }}
                  >
                    {w('email.reg.changeEmail')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || code.length !== 6}
                    onClick={() => void confirmCode()}
                  >
                    {busy ? w('mfa.checking') : w('email.reg.confirm')}
                  </Button>
                </div>
              </fieldset>
            ) : null}

            <div className={styles.actions} hidden={Boolean(codeFor)}>
              <a href={LOGIN_PATH} className="small">
                {w('email.reg.alreadySignIn')}
              </a>
              <Button type="submit" disabled={busy}>
                {busy
                  ? w('email.reg.sending')
                  : individual
                    ? w('login.register')
                    : w('email.reg.sendApplication')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}

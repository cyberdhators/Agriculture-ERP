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
export function BuyerRegister() {
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
  const [language, setLanguage] = useState<AccountLanguage>('en');
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
      setFailure(
        e.status === 409
          ? 'An account already exists for that email address. Sign in instead.'
          : e.message,
      );
      // A code that could not be used goes back to the form, with the reason.
      setCodeFor(null);
    } else {
      setFailure('The application could not be sent.');
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
        setFailure(
          'The server took too long to answer and your account was not confirmed. Please try again in a moment.',
        );
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
      setFailure('Some details need attention. They are marked below.');
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
      setCodeError(e instanceof BuyerApiError ? e.message : 'The code could not be checked.');
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
      setCodeNote('A new code is on its way.');
    } catch (e) {
      setCodeError(e instanceof BuyerApiError ? e.message : 'The code could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const ackError = errors.acknowledgement ?? errors['acknowledgement.granted'];

  return (
    <main className={styles.registerWrap}>
      <div className={styles.registerInner}>
        <Wordmark size={28} tagline />
        <PageHeader
          title="Create an account with email"
          subtitle="One account to buy, sell, offer services and get advice. Your account is ready as soon as your email address is confirmed."
        />
        <p className="small">
          Have a South Sudan mobile number?{' '}
          <a href="/farmer/register">Create your account with your phone</a> instead. Already have
          an account? <a href="/login?next=/buyer/marketplace">Sign in</a>.
        </p>
        <Card padded>
          <form className={styles.form} onSubmit={submit} noValidate aria-label="Buyer application">
            {failure ? (
              <Notice kind="error" title="Not sent">
                {failure}
              </Notice>
            ) : null}

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Language</legend>
              <div className={styles.checkGrid} role="radiogroup" aria-label="Language">
                {(
                  [
                    ['en', 'English'],
                    ['ar', 'العربية (Arabic)'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
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
              <p className={styles.muted}>
                Codes and notices from AgriOne use this language where they can.
              </p>
              {errors.preferred_language ? <p role="alert">{errors.preferred_language}</p> : null}
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Who is buying</legend>
              <div className={styles.checkGrid} role="radiogroup" aria-label="Account type">
                {(
                  [
                    ['individual', 'An individual', 'Buying for yourself. Start at once.'],
                    [
                      'business',
                      'A business or organisation',
                      'Buy straight away. CORWADO may check it later and add a "Verified organisation" badge.',
                    ],
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
              <legend className={styles.legend}>Your account</legend>
              <div className={styles.formGrid}>
                <Field label="First name" error={errors.given_name}>
                  {(ids) => (
                    <Input
                      {...ids}
                      autoComplete="given-name"
                      value={person.given_name}
                      onChange={(e) => setP('given_name')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Last name" error={errors.family_name}>
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
                  label="Email"
                  hint="You will sign in with this. We send a code to confirm it."
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
                  label="Mobile number"
                  hint="International form, e.g. +211912345678"
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
                <Field label="Password" hint="At least 12 characters." error={errors.password}>
                  {(ids) => (
                    <PasswordInput
                      {...ids}
                      autoComplete="new-password"
                      value={person.password}
                      onChange={(e) => setP('password')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Confirm password" error={errors.confirm_password}>
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
            />

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Terms of use and privacy</legend>
              <div dir={language === 'ar' ? 'rtl' : 'auto'} className="small">
                <p>{terms.body}</p>
                <p>{privacy.body}</p>
              </div>
              <p className={`${styles.muted} mono`}>
                Terms {terms.text_version} · Privacy {privacy.text_version}
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
                label="I agree to the terms of use and the privacy notice."
              />
              {ackError ? <p role="alert">{ackError}</p> : null}
            </fieldset>

            {codeFor ? (
              <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Confirm your email address</legend>
                <p className="small">
                  We sent a 6-digit code to <strong>{codeFor.email}</strong>. Type it here. Your
                  account is ready as soon as the code is confirmed.
                </p>
                {codeNote ? <p className="small">{codeNote}</p> : null}
                <Field label="Code" error={codeError ?? undefined}>
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
                    Send the code again
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
                    Change the email address
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || code.length !== 6}
                    onClick={() => void confirmCode()}
                  >
                    {busy ? 'Checking…' : 'Confirm and create account'}
                  </Button>
                </div>
              </fieldset>
            ) : null}

            <div className={styles.actions} hidden={Boolean(codeFor)}>
              <a href={LOGIN_PATH} className="small">
                Already have an account? Sign in
              </a>
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : individual ? 'Create account' : 'Send application'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}

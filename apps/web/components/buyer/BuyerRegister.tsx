'use client';

import { useState, type FormEvent } from 'react';

import { buyerRegistrationSchema, zodErrorToApiError } from '@agri-erp/shared';

import { BUYER_HOME_PATH, LOGIN_PATH } from '@/lib/auth/paths';
import { BuyerApiError, registerBuyer } from '@/lib/buyer/api';
import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import { Button, Card, Field, Input, Notice, PageHeader, PasswordInput } from '../ui';
import {
  EMPTY_ORG,
  ProcurementFields,
  toOrganizationBody,
  type OrgForm,
} from './ProcurementFields';
import styles from './buyer.module.css';

/**
 * APPLY FOR A BUYER ACCOUNT (C-14B.1, C-14B.2).
 *
 * Validated here with the shared schema the route runs. On success the account
 * exists and is PENDING; the applicant is signed in with the password they
 * just chose and taken to the dashboard, which explains what pending means.
 * Nothing on this page lets an applicant choose their own standing.
 *
 * State and county are not asked here: the location list is read with a
 * session, and an applicant has none yet. They are on the profile, one click
 * from the dashboard.
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

  const setP = (key: keyof typeof person) => (value: string) =>
    setPerson((p) => ({ ...p, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const parsed = buyerRegistrationSchema.safeParse({
      account_type: accountType,
      ...person,
      ...toOrganizationBody(org, false, individual),
    });
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      setFailure('Some details need attention. They are marked below.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await registerBuyer(parsed.data);
      const { error } = await supabaseBrowser().auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      window.location.assign(error ? LOGIN_PATH : BUYER_HOME_PATH);
    } catch (e) {
      if (e instanceof BuyerApiError) {
        setErrors(e.fields);
        setFailure(
          e.status === 409
            ? 'An account already exists for that email address. Sign in instead.'
            : e.message,
        );
      } else {
        setFailure('The application could not be sent.');
      }
      setBusy(false);
    }
  };

  return (
    <main className={styles.registerWrap}>
      <div className={styles.registerInner}>
        <Wordmark size={28} tagline />
        <PageHeader
          title="Create a buyer account"
          subtitle="Buy produce from South Sudan's verified farmers. Individual buyers can start straight away; business accounts are reviewed by CORWADO before requests can be sent."
        />
        <p className="small">
          Are you a farmer selling produce? <a href="/farmer/register">Register as a farmer</a>{' '}
          instead. Already a buyer? <a href="/login?next=/buyer/marketplace">Sign in</a>.
        </p>
        <Card padded>
          <form className={styles.form} onSubmit={submit} noValidate aria-label="Buyer application">
            {failure ? (
              <Notice kind="error" title="Not sent">
                {failure}
              </Notice>
            ) : null}

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Who is buying</legend>
              <div className={styles.checkGrid} role="radiogroup" aria-label="Account type">
                {(
                  [
                    ['individual', 'An individual', 'Buying for yourself. No review needed.'],
                    [
                      'business',
                      'A business or organisation',
                      'Reviewed by CORWADO before you can send requests.',
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
                <Field label="Email" hint="You will sign in with this." error={errors.email}>
                  {(ids) => (
                    <Input
                      {...ids}
                      type="email"
                      autoComplete="email"
                      value={person.email}
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

            <div className={styles.actions}>
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

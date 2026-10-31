'use client';

import { useEffect, useMemo, useState } from 'react';

import { farmerStartSellingSchema } from '@agri-erp/shared';

import css from '@/components/account/settings.module.css';
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui';
import { getProfile } from '@/lib/buyer/api';
import { COUNTIES, PAYAMS, STATES } from '@/lib/fixtures/p1';
import { t } from '@/lib/i18n';
import { useConsentText } from '@/lib/settings/client';

import styles from './buyer.module.css';

/**
 * The consent text version the farmer sign-up records (FarmerRegister): the
 * built-in v1.3 text is the offline fallback; the PUBLISHED consent notice
 * (GET /api/notices/current, 2026-10-25) is shown and recorded when it can be
 * read.
 */
const CONSENT_VERSION = 'v1.3-en';

/**
 * START SELLING WITH THE SAME ACCOUNT (2026-10-19; CORWADO: "one account, many
 * activities"). A buyer adds the farmer details of sign-up -- no new password
 * -- and the account can then post produce from the farmer side. Checked with
 * the same schema the server uses (farmerStartSellingSchema).
 */
export function StartSelling() {
  const [already, setAlready] = useState<boolean | null>(null);
  const [given, setGiven] = useState('');
  const [family, setFamily] = useState('');
  const [phone, setPhone] = useState('');
  const [sex, setSex] = useState('');
  const [year, setYear] = useState('');
  const [stateId, setStateId] = useState('');
  const [countyId, setCountyId] = useState('');
  const [payamId, setPayamId] = useState('');
  const [village, setVillage] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const consent = useConsentText('en', {
    text_version: CONSENT_VERSION,
    body: t('consent.body', 'en'),
  });

  useEffect(() => {
    // Already selling? Then there is nothing to fill in.
    void fetch('/api/farmer/me', { cache: 'no-store' })
      .then((r) => setAlready(r.ok))
      .catch(() => setAlready(false));
    void getProfile()
      .then((p) => {
        setGiven(p.person.given_name);
        setFamily(p.person.family_name);
        if (p.person.phone?.startsWith('+211')) setPhone(p.person.phone.slice(4));
      })
      .catch(() => undefined);
  }, []);

  const counties = useMemo(() => COUNTIES.filter((c) => c.stateId === stateId), [stateId]);
  const payams = useMemo(() => PAYAMS.filter((p) => p.countyId === countyId), [countyId]);

  async function submit() {
    const body = {
      given_name: given,
      family_name: family,
      sex,
      year_of_birth: year.trim() === '' ? undefined : Number(year),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      payam_id: payamId,
      village: village.trim(),
      consent: { text_version: consent.text_version, language: 'en', granted: agreed },
    };
    const parsed = farmerStartSellingSchema.safeParse(body);
    if (!parsed.success || !agreed) {
      const next: Record<string, string> = {};
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??= issue.message;
      }
      if (!agreed) next.consent = 'Tick the box to agree before you start selling.';
      setErrors(next);
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      const res = await fetch('/api/buyer/selling', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; fields?: Record<string, string> };
        };
        setErrors(err.error?.fields ?? {});
        throw new Error(err.error?.message ?? 'Selling could not be set up. Please try again.');
      }
      window.location.assign('/farmer/account');
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Selling could not be set up. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (already) {
    return (
      <Notice kind="success" title="This account already sells">
        <p className="small">Post produce and answer buyers from your farm.</p>
        <ButtonLink href="/farmer/account">Go to my farm</ButtonLink>
      </Notice>
    );
  }

  return (
    // 2026-10-31 (the owner: "more beautiful and more appealing"): the title
    // and one short line, then the fields grouped on white cards -- you, the
    // farm, the agreement -- and one button that does not repeat the title.
    <div className={styles.sections} style={{ maxWidth: 560 }}>
      <PageHeader title="Start selling" subtitle="Sell with this same account; no new password." />

      {failure ? (
        <Notice kind="error" title="Not set up yet">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}

      <section className={css.group} aria-labelledby="sell-you">
        <h2 id="sell-you" className={css.groupTitle}>
          About you
        </h2>
        <div className={css.formCard}>
          <Field label="First name" error={errors.given_name}>
            {(ids) => (
              <Input {...ids} dir="auto" value={given} onChange={(e) => setGiven(e.target.value)} />
            )}
          </Field>
          <Field label="Family name" error={errors.family_name}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
              />
            )}
          </Field>
          <Field label="Sex" error={errors.sex}>
            {(ids) => (
              <Select {...ids} value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Select…</option>
                <option value="f">Female</option>
                <option value="m">Male</option>
              </Select>
            )}
          </Field>
          <Field label="Year of birth" error={errors.year_of_birth}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                maxLength={4}
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
        </div>
      </section>

      <section className={css.group} aria-labelledby="sell-farm">
        <h2 id="sell-farm" className={css.groupTitle}>
          Your farm
        </h2>
        <div className={css.formCard}>
          <Field label="Farm phone (South Sudan)" hint="Starts 9, after +211." error={errors.phone}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="tel"
                className="mono"
                placeholder="9XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label="State">
            {(ids) => (
              <Select
                {...ids}
                value={stateId}
                onChange={(e) => {
                  setStateId(e.target.value);
                  setCountyId('');
                  setPayamId('');
                }}
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
          <Field label="County">
            {(ids) => (
              <Select
                {...ids}
                value={countyId}
                disabled={!stateId}
                onChange={(e) => {
                  setCountyId(e.target.value);
                  setPayamId('');
                }}
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
          <Field label="Payam" error={errors.payam_id}>
            {(ids) => (
              <Select
                {...ids}
                value={payamId}
                disabled={!countyId}
                onChange={(e) => setPayamId(e.target.value)}
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
          <Field label="Village or boma" optional error={errors.village}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      <section className={css.group} aria-labelledby="sell-consent">
        <h2 id="sell-consent" className={css.groupTitle}>
          Agreement
        </h2>
        <div className={css.formCard}>
          <p className="small">{consent.body}</p>
          <p className="small muted">{consent.text_version}</p>
          <Field label="Consent" error={errors.consent}>
            {(ids) => (
              <Checkbox
                {...ids}
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                label="I agree"
              />
            )}
          </Field>
        </div>
      </section>

      <div className={css.actions}>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || already === null}>
          {busy ? 'Setting up…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

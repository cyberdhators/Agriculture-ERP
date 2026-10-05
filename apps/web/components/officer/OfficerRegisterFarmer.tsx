'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { LANGUAGES } from '@agri-erp/shared';

import { Button, ButtonLink, Field, Input, Select } from '@/components/ui';
import { LIVE_FARMERS, createFarmer } from '@/lib/farmers/api';
import { farmerPayamName, type Farmer } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import {
  buildRegistration,
  CONSENT_VERSION,
  draftProblems,
  emptyDraft,
  type ConsentLanguage,
  type RegistrationDraft,
} from '@/lib/officer/registration';
import { classify } from '@/lib/officer/recovery';
// LANGUAGE_LABELS is the repository's one set of language display names, typed
// `Record<Language, string>`. This screen names no language of its own.
import { formatDate, formatPhone, LANGUAGE_LABELS } from '@/lib/format';

import styles from './officer-register.module.css';

/**
 * REGISTERING A FARMER, IN A FIELD.
 *
 * The administrator's register asks for a state, then a county, then a payam,
 * then which officer to credit. An officer has none of those choices: the route
 * refuses any payam but their own with a 403 and stamps them as the registrar
 * whatever the body says. So this form does not offer a location cascade that
 * can only end one way -- it states the payam and moves on.
 *
 * NOTHING ON THIS SCREEN IS TRUSTED FOR AUTHORISATION. The payam comes from
 * `GET /api/me`'s scope and `registered_by` is never sent, so there is no
 * hidden input to tamper with. The server would refuse a wrong one anyway;
 * this simply does not offer the officer a way to be refused.
 *
 * WHAT HAPPENS ON SAVE. `POST /api/farmers` with a client-generated `id` --
 * the idempotency key from C-9.2, so a retry of a registration that landed
 * returns the same farmer rather than a second one. The response carries the
 * farmer number the server allocated and any duplicate matches it found.
 *
 * THIS FORM IS NOT OFFLINE. There is no queue, no local store and no retry
 * loop; a failed request says so and keeps what was typed. Working without a
 * signal is the Android application's job and is not built.
 */
type Outcome = { farmer: Farmer; duplicates: string[] } | null;

export function OfficerRegisterFarmer() {
  const { me } = usePreview();
  const payamId = me?.scope?.kind === 'caseload' ? me.scope.payamId : null;

  const [draft, setDraft] = useState<RegistrationDraft>(emptyDraft);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const problems = useMemo(() => draftProblems(draft, payamId), [draft, payamId]);
  const problemFor = (field: string) =>
    submitted ? problems.find((p) => p.field === field)?.message : undefined;

  const set = (patch: Partial<RegistrationDraft>) => setDraft({ ...draft, ...patch });

  if (outcome) {
    return (
      <Registered
        outcome={outcome}
        onAnother={() => {
          setOutcome(null);
          setDraft(emptyDraft());
          setSubmitted(false);
        }}
      />
    );
  }

  const submit = () => {
    setSubmitted(true);
    setFailure(null);
    if (problems.length > 0 || !payamId) return;
    if (!LIVE_FARMERS) {
      setFailure('This deployment is running on preview data, so nothing was sent.');
      return;
    }
    setSaving(true);
    createFarmer(buildRegistration(draft, payamId, () => crypto.randomUUID()))
      .then((result) => setOutcome({ farmer: result.farmer, duplicates: result.duplicates }))
      .catch((error: unknown) => setFailure(classify(error).explanation))
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.page}>
      <Link href="/farmers" className={styles.back}>
        ← My farmers
      </Link>
      <h1 className={styles.title}>Register a farmer</h1>

      {/* The payam is stated, not chosen: the route accepts no other. */}
      <p className={styles.scope}>
        {payamId ? (
          <>
            In your payam, <span className="mono">{payamId}</span>, recorded under your name.
          </>
        ) : (
          'Your payam is not known from this session, so registration is not available.'
        )}
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Given name" error={problemFor('given_name')}>
          {(ids) => (
            <Input
              {...ids}
              value={draft.given_name}
              autoComplete="off"
              onChange={(e) => set({ given_name: e.target.value })}
            />
          )}
        </Field>

        <Field label="Family name" error={problemFor('family_name')}>
          {(ids) => (
            <Input
              {...ids}
              value={draft.family_name}
              autoComplete="off"
              onChange={(e) => set({ family_name: e.target.value })}
            />
          )}
        </Field>

        <Field label="Phone" hint="The number the farmer answers." error={problemFor('phone')}>
          {(ids) => (
            <Input
              {...ids}
              value={draft.phone}
              inputMode="tel"
              autoComplete="off"
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>

        <Field label="Sex" error={problemFor('sex')}>
          {(ids) => (
            <Select
              {...ids}
              value={draft.sex}
              onChange={(e) => set({ sex: e.target.value as 'f' | 'm' })}
            >
              <option value="f">Female</option>
              <option value="m">Male</option>
            </Select>
          )}
        </Field>

        <Field label="Year of birth" error={problemFor('year_of_birth')}>
          {(ids) => (
            <Input
              {...ids}
              value={draft.year_of_birth}
              inputMode="numeric"
              onChange={(e) => set({ year_of_birth: e.target.value })}
            />
          )}
        </Field>

        {/* Optional on the contract: an empty box sends no key at all. */}
        <Field
          label="National ID (optional)"
          hint="Leave empty if the farmer has none."
          error={problemFor('national_id')}
        >
          {(ids) => (
            <Input
              {...ids}
              value={draft.national_id}
              autoComplete="off"
              onChange={(e) => set({ national_id: e.target.value })}
            />
          )}
        </Field>

        <fieldset className={styles.consent}>
          <legend className={styles.consentLegend}>Consent</legend>
          <Field label="Language the consent was read in">
            {(ids) => (
              <Select
                {...ids}
                value={draft.consent_language}
                onChange={(e) => set({ consent_language: e.target.value as ConsentLanguage | '' })}
              >
                <option value="">Choose a language</option>
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {LANGUAGE_LABELS[language]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {draft.consent_language ? (
            <p className={styles.version}>
              Text version <span className="mono">{CONSENT_VERSION[draft.consent_language]}</span>
            </p>
          ) : null}
          <label className={styles.granted}>
            <input
              type="checkbox"
              checked={draft.consent_granted}
              onChange={(e) => set({ consent_granted: e.target.checked })}
            />
            <span>The farmer understood and gave consent.</span>
          </label>
          {problemFor('consent') ? (
            <p className={styles.fieldError}>{problemFor('consent')}</p>
          ) : null}
        </fieldset>

        {submitted && problems.length > 0 ? (
          <p className={styles.formError} role="alert">
            {problems.length === 1
              ? 'One thing still needs attention.'
              : `${problems.length} things still need attention.`}
          </p>
        ) : null}
        {failure ? (
          <p className={styles.formError} role="alert">
            {failure}
          </p>
        ) : null}

        <Button type="submit" className={styles.submit} disabled={saving || !payamId}>
          {saving ? 'Registering…' : 'Register farmer'}
        </Button>
        <p className={styles.note}>
          The farmer number is assigned by the server, and the record starts pending a supervisor’s
          verification.
        </p>
      </form>
    </div>
  );
}

/**
 * The receipt, and the slip that goes with it.
 *
 * The slip was on the old field desk and became unreachable when the dashboard
 * was branched. Its natural home was always here: the moment to hand a farmer
 * their number is the moment it is assigned. Printing is offered, never
 * required -- a phone in a field has no printer, and the number is on screen.
 */
function Registered({
  outcome,
  onAnother,
}: {
  outcome: NonNullable<Outcome>;
  onAnother: () => void;
}) {
  const { farmer, duplicates } = outcome;
  return (
    <div className={styles.page}>
      <div className={styles.done}>
        <p className={styles.doneLabel}>Registered</p>
        <p className={styles.number}>{farmer.farmer_number}</p>
        <p className={styles.doneName} dir="auto">
          {farmer.given_name} {farmer.family_name}
        </p>
        <p className={styles.note}>Pending a supervisor’s verification.</p>
      </div>

      {duplicates.length > 0 ? (
        <div className={styles.duplicates} role="status">
          <p className={styles.duplicatesTitle}>
            This may be someone already registered
            {duplicates.length > 1 ? ` (${duplicates.length} possible matches)` : ''}
          </p>
          <p className={styles.duplicatesBody}>
            The record was created and is waiting for verification — nothing was refused. A
            supervisor decides whether two records are the same person; you cannot merge them. Check
            with the farmer whether they have registered before.
          </p>
        </div>
      ) : null}

      <div className={`${styles.slip} print-flat`}>
        <p className={styles.slipHead}>AgriOne South Sudan · Registration slip</p>
        <dl className={styles.slipRows}>
          <div>
            <dt>Farmer number</dt>
            <dd className="mono">{farmer.farmer_number}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd dir="auto">
              {farmer.given_name} {farmer.family_name}
            </dd>
          </div>
          <div>
            <dt>Sex · age</dt>
            <dd>
              {farmer.sex === 'f' ? 'F' : 'M'} ·{' '}
              <span className="mono">{new Date().getFullYear() - farmer.year_of_birth}</span>
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd className="mono">{formatPhone(farmer.phone)}</dd>
          </div>
          <div>
            {/* Named where the geography table knows the id, and the bare id
                where it does not -- it never guesses a name. */}
            <dt>Payam</dt>
            <dd>{farmerPayamName(farmer.payam_id)}</dd>
          </div>
          <div>
            <dt>Registered</dt>
            <dd>{formatDate(farmer.created_at)}</dd>
          </div>
        </dl>
        <p className={styles.slipNote}>
          Keep this slip. A supervisor reviews the registration; the farmer number is permanent.
        </p>
      </div>

      <div className={styles.doneActions}>
        <ButtonLink href={`/farmers/${farmer.id}`} className={styles.submit}>
          View farmer
        </ButtonLink>
        <Button variant="secondary" className={styles.submit} onClick={onAnother}>
          Register another
        </Button>
        <Button
          variant="ghost"
          className={`${styles.printButton} no-print`}
          onClick={() => window.print()}
        >
          Print slip
        </Button>
      </div>
    </div>
  );
}

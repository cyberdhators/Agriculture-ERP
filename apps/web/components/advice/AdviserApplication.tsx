'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ADVICE_LANGUAGES,
  ADVICE_TOPICS,
  ADVISER_LIMITS,
  adviserApplicationSchema,
  adviserReplySchema,
  type AdviceProviderOwn,
  type AdviserApplicationOwn,
  type AdviserApplicationState,
  type AdviserApplicationStatus,
} from '@agri-erp/shared';

import { Badge, Button, Checkbox, Field, Notice, Textarea, type Tone } from '@/components/ui';
import {
  AdviceError,
  applyAsAdviser,
  getMyApplication,
  replyToClarification,
  withdrawApplication,
} from '@/lib/advice/client';
import { LANGUAGE_KEY, TOPIC_KEY } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import styles from './advice.module.css';

const STATUS_KEY: Record<AdviserApplicationStatus, TKey> = {
  submitted: 'adviser.status.submitted',
  clarification_requested: 'adviser.status.clarification_requested',
  approved: 'adviser.status.approved',
  declined: 'adviser.status.declined',
  revoked: 'adviser.status.revoked',
  withdrawn: 'adviser.status.withdrawn',
};

const STATUS_TONE: Record<AdviserApplicationStatus, Tone> = {
  submitted: 'nile',
  clarification_requested: 'sorghum',
  approved: 'leaf',
  declined: 'clay',
  revoked: 'clay',
  withdrawn: 'neutral',
};

interface Values {
  specialties: string[];
  service_area: string[];
  languages: string[];
  experience: string;
  qualifications: string;
  affiliation: string;
  accurate_information: boolean;
  disclose_interests: boolean;
}

/** Starts from the advice profile's own lists; the acknowledgements start UNTICKED. */
const startFrom = (p: AdviceProviderOwn | null): Values => ({
  specialties: p?.topics ?? [],
  service_area: p?.state_ids ?? [],
  languages: p?.languages ?? [],
  experience: '',
  qualifications: '',
  affiliation: '',
  accurate_information: false,
  disclose_interests: false,
});

/**
 * APPROVED ADVISER (OPTIONAL), 2026-10-24. Under the advice profile on "Offer
 * advice": what the pathway is, the application (specialties, service area,
 * languages, experience, qualifications, affiliation, and two acknowledgements
 * that start unticked), where it stands, CORWADO's question and a box to
 * answer it, and Withdraw. Nothing here changes what the account can do; the
 * page says so. Same shared schemas as the routes.
 */
export function AdviserApplication({
  lang,
  profile,
  states,
}: {
  lang: Language;
  profile: AdviceProviderOwn | null;
  states: { id: string; name: string }[];
}) {
  const [state, setState] = useState<AdviserApplicationState | null | undefined>(undefined);
  const [values, setValues] = useState<Values>(() => startFrom(profile));
  const [reply, setReply] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const load = useCallback(() => {
    getMyApplication()
      .then(setState)
      .catch((e: unknown) => {
        setState(null);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };
  const toggle = (key: 'specialties' | 'service_area' | 'languages', v: string) =>
    set(key, values[key].includes(v) ? values[key].filter((x) => x !== v) : [...values[key], v]);

  const failed = (e: unknown) => {
    if (e instanceof AdviceError) {
      setErrors(e.fields);
      setFailure(e.message);
    } else setFailure(String(e));
  };

  async function apply() {
    setFailure(null);
    setNotice(null);
    const check = adviserApplicationSchema.safeParse(values);
    if (!check.success) {
      const next: Record<string, string> = {};
      for (const issue of check.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      await applyAsAdviser(check.data);
      setValues(startFrom(profile));
      setNotice(t('adviser.sent', lang));
      load();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  async function answer() {
    setFailure(null);
    setNotice(null);
    const check = adviserReplySchema.safeParse({ reply });
    if (!check.success) {
      setErrors({ reply: check.error.issues[0]?.message ?? '' });
      return;
    }
    setBusy(true);
    try {
      await replyToClarification(check.data.reply);
      setReply('');
      setNotice(t('adviser.sent', lang));
      load();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setFailure(null);
    setNotice(null);
    setBusy(true);
    try {
      await withdrawApplication();
      setConfirmWithdraw(false);
      load();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  const current = state?.current ?? null;
  const open =
    current !== null &&
    (current.status === 'submitted' || current.status === 'clarification_requested');
  const mayApply = profile !== null && state !== undefined && !open && !state?.approved;

  const group = (
    key: 'specialties' | 'service_area' | 'languages',
    legend: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    hint?: string,
  ) => (
    <div>
      <fieldset className={styles.choices}>
        <legend>{legend}</legend>
        {options.map((o) => (
          <Checkbox
            key={o.value}
            label={o.label}
            checked={values[key].includes(o.value)}
            onChange={() => toggle(key, o.value)}
          />
        ))}
      </fieldset>
      {hint ? <p className="small muted">{hint}</p> : null}
      {errors[key] ? (
        <p className="small" role="alert">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );

  return (
    <section className={styles.box} aria-labelledby="adviser-approval">
      <h2 id="adviser-approval">{t('adviser.title', lang)}</h2>
      <p className="small">{t('adviser.lead', lang)}</p>

      {!profile ? <p className="small muted">{t('adviser.needProfile', lang)}</p> : null}
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {profile && state === undefined ? (
        <p className="muted small">{t('market.loading', lang)}</p>
      ) : null}

      {state?.approved ? <Notice kind="success">{t('adviser.approvedNow', lang)}</Notice> : null}

      {current ? (
        <ApplicationSummary application={current} lang={lang} />
      ) : null}

      {current?.status === 'clarification_requested' ? (
        <div className={styles.formGrid}>
          <Field
            label={t('adviser.yourReply', lang)}
            error={errors.reply || undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={4}
                dir="auto"
                maxLength={ADVISER_LIMITS.replyMax}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  setErrors((x) => ({ ...x, reply: '' }));
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => void answer()}>
              {t('adviser.sendReply', lang)}
            </Button>
          </div>
        </div>
      ) : null}

      {open ? (
        confirmWithdraw ? (
          <div className={styles.formGrid}>
            <p className="small">{t('adviser.withdrawConfirm', lang)}</p>
            <div className={styles.actions}>
              <Button variant="danger" disabled={busy} onClick={() => void withdraw()}>
                {t('adviser.withdraw', lang)}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmWithdraw(false)}>
                {t('msg.cancel', lang)}
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmWithdraw(true)}>
              {t('adviser.withdraw', lang)}
            </Button>
          </div>
        )
      ) : null}

      {mayApply ? (
        <form
          className={styles.formGrid}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          {group(
            'specialties',
            t('adviser.specialties', lang),
            ADVICE_TOPICS.map((v) => ({ value: v, label: t(TOPIC_KEY[v], lang) })),
          )}
          {group(
            'service_area',
            t('adviser.serviceArea', lang),
            states.map((s) => ({ value: s.id, label: s.name })),
            t('adviser.serviceAreaHint', lang),
          )}
          {group(
            'languages',
            t('adviser.languages', lang),
            ADVICE_LANGUAGES.map((v) => ({ value: v, label: t(LANGUAGE_KEY[v], lang) })),
          )}
          <Field
            label={t('adviser.experience', lang)}
            hint={t('adviser.experienceHint', lang)}
            error={errors.experience || undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={5}
                dir="auto"
                maxLength={ADVISER_LIMITS.experienceMax}
                value={values.experience}
                onChange={(e) => set('experience', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('adviser.qualifications', lang)}
            hint={t('adviser.qualificationsHint', lang)}
            optional
            error={errors.qualifications || undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                dir="auto"
                maxLength={ADVISER_LIMITS.qualificationsMax}
                value={values.qualifications}
                onChange={(e) => set('qualifications', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('adviser.affiliation', lang)}
            hint={t('adviser.affiliationHint', lang)}
            optional
            error={errors.affiliation || undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={2}
                dir="auto"
                maxLength={ADVISER_LIMITS.affiliationMax}
                value={values.affiliation}
                onChange={(e) => set('affiliation', e.target.value)}
              />
            )}
          </Field>
          {(['accurate_information', 'disclose_interests'] as const).map((key) => (
            <div key={key}>
              <Checkbox
                label={t(key === 'accurate_information' ? 'adviser.ackAccurate' : 'adviser.ackInterests', lang)}
                checked={values[key]}
                onChange={(e) => set(key, e.target.checked)}
              />
              {errors[key] ? (
                <p className="small" role="alert">
                  {errors[key]}
                </p>
              ) : null}
            </div>
          ))}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy}>
              {current ? t('adviser.applyAgain', lang) : t('adviser.apply', lang)}
            </Button>
          </div>
        </form>
      ) : null}

      {state && state.history.length > 1 ? (
        <details>
          <summary className="small">{t('adviser.history', lang)}</summary>
          <ul className={styles.rows}>
            {state.history.slice(1).map((a) => (
              <li key={a.id} className="small">
                <Badge tone={STATUS_TONE[a.status]}>{t(STATUS_KEY[a.status], lang)}</Badge>{' '}
                {t('adviser.sentOn', lang)} {formatDate(a.created_at, lang)}
                {a.decision_reason ? (
                  <>
                    {' · '}
                    <span dir="auto">{a.decision_reason}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ApplicationSummary({
  application: a,
  lang,
}: {
  application: AdviserApplicationOwn;
  lang: Language;
}) {
  return (
    <div className={styles.formGrid}>
      <p className="small">
        {t('adviser.statusLabel', lang)}{' '}
        <Badge tone={STATUS_TONE[a.status]}>{t(STATUS_KEY[a.status], lang)}</Badge> ·{' '}
        {t('adviser.sentOn', lang)} {formatDate(a.created_at, lang)}
      </p>
      {a.clarification_request ? (
        <dl className={styles.facts}>
          <div>
            <dt>{t('adviser.question', lang)}</dt>
            <dd dir="auto">{a.clarification_request}</dd>
          </div>
          {a.applicant_reply ? (
            <div>
              <dt>{t('adviser.lastReply', lang)}</dt>
              <dd dir="auto">{a.applicant_reply}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {a.decision_reason ? (
        <dl className={styles.facts}>
          <div>
            <dt>{t('adviser.reason', lang)}</dt>
            <dd dir="auto">
              {a.decision_reason}
              {a.decided_at ? ` · ${formatDate(a.decided_at, lang)}` : ''}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

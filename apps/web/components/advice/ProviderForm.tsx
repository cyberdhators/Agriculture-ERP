'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  ADVICE_DELIVERY_MODES,
  ADVICE_LANGUAGES,
  ADVICE_LIMITS,
  ADVICE_PROVIDER_KINDS,
  ADVICE_TERMS,
  ADVICE_TOPICS,
  adviceProviderSchema,
  type AdviceProviderOwn,
  type AdviceProviderStatus,
} from '@agri-erp/shared';

import { Badge, Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { AdviceError, getMyProvider, saveMyProvider } from '@/lib/advice/client';
import {
  KIND_KEY,
  LANGUAGE_KEY,
  MODE_KEY,
  PROVIDER_STATUS_KEY,
  TERMS_KEY,
  TOPIC_KEY,
} from '@/lib/advice/labels';
import { t, type Language, type TKey } from '@/lib/i18n';
import { listStates } from '@/lib/market-posts/api';

import { AdviserApplication } from './AdviserApplication';
import styles from './advice.module.css';

interface Values {
  display_name: string;
  provider_kind: string;
  description: string;
  topics: string[];
  languages: string[];
  state_ids: string[];
  delivery_modes: string[];
  availability: string;
  terms: string;
  fee_note: string;
  commercial_interests: string;
}

const EMPTY: Values = {
  display_name: '',
  provider_kind: '',
  description: '',
  topics: [],
  languages: [],
  state_ids: [],
  delivery_modes: [],
  availability: '',
  terms: '',
  fee_note: '',
  commercial_interests: '',
};

const fromProfile = (p: AdviceProviderOwn): Values => ({
  display_name: p.display_name,
  provider_kind: p.provider_kind,
  description: p.description,
  topics: p.topics,
  languages: p.languages,
  state_ids: p.state_ids,
  delivery_modes: p.delivery_modes,
  availability: p.availability ?? '',
  terms: p.terms,
  fee_note: p.fee_note ?? '',
  commercial_interests: p.commercial_interests ?? '',
});

/**
 * OFFER ADVICE (2026-10-22): the account's own advice profile -- who they
 * are, what they advise on, where and how, on what terms, and any commercial
 * interest. Saved as a draft, published at once (no review), or unpublished.
 * The same shared schema as the route. `base` is where public profiles are
 * on this side of the app; `workHref` is My Advisory Work.
 */
export function ProviderForm({
  lang,
  base,
  workHref,
  source,
}: {
  lang: Language;
  base: string;
  workHref: string;
  /**
   * 2026-10-28: an ORGANISATION's advice profile instead of the account's own.
   * Loads and saves through the organisation's route; the approved-adviser
   * pathway, which is a person's, is not offered.
   */
  source?: {
    load: () => Promise<AdviceProviderOwn | null>;
    save: (body: Record<string, unknown>) => Promise<AdviceProviderOwn>;
    title: string;
    lead: string;
  };
}) {
  const [profile, setProfile] = useState<AdviceProviderOwn | null | undefined>(undefined);
  const [values, setValues] = useState<Values>(EMPTY);
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (source ? source.load() : getMyProvider())
      .then((p) => {
        setProfile(p);
        if (p) setValues(fromProfile(p));
      })
      .catch((e: unknown) => {
        setProfile(null);
        setFailure(e instanceof Error ? e.message : String(e));
      });
    listStates()
      .then(setStates)
      .catch(() => setStates([]));
  }, []);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
    setSaved(false);
  };
  const toggle = (key: 'topics' | 'languages' | 'state_ids' | 'delivery_modes', v: string) =>
    set(key, values[key].includes(v) ? values[key].filter((x) => x !== v) : [...values[key], v]);

  async function save(status: AdviceProviderStatus) {
    setFailure(null);
    setSaved(false);
    const check = adviceProviderSchema.safeParse({ ...values, status });
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
      const got = await (source ? source.save(check.data) : saveMyProvider(check.data));
      setProfile(got);
      setValues(fromProfile(got));
      setSaved(true);
    } catch (e) {
      if (e instanceof AdviceError) {
        setErrors(e.fields);
        setFailure(e.message);
      } else setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (profile === undefined) return <p className="muted">{t('market.loading', lang)}</p>;
  const status = profile?.status ?? 'draft';

  const group = (
    key: 'topics' | 'languages' | 'state_ids' | 'delivery_modes',
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
  const labelled = <T extends string>(list: readonly T[], keys: Record<T, TKey>) =>
    list.map((v) => ({ value: v, label: t(keys[v], lang) }));

  return (
    <div className={styles.narrow}>
      <header className={styles.head}>
        <h1>{source ? source.title : t('advice.offer', lang)}</h1>
        <p className="muted small">{source ? source.lead : t('advice.offerLead', lang)}</p>
      </header>
      {profile ? (
        <div className={styles.cardHead}>
          <span>
            {t('advice.statusNow', lang)}{' '}
            <Badge tone={status === 'published' ? 'leaf' : 'neutral'}>
              {t(PROVIDER_STATUS_KEY[status], lang)}
            </Badge>
          </span>
          <span className="small">
            {status === 'published' ? (
              <Link href={`${base}/${profile.id}`}>{t('advice.viewPublic', lang)}</Link>
            ) : null}{' '}
            <Link href={workHref}>{t('advice.openWork', lang)}</Link>
          </span>
        </div>
      ) : null}
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {saved ? <Notice kind="success">{t('advice.saved', lang)}</Notice> : null}

      <form
        className={styles.formGrid}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(status);
        }}
      >
        <Field label={t('advice.displayName', lang)} error={errors.display_name || undefined}>
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={ADVICE_LIMITS.displayNameMax}
              value={values.display_name}
              onChange={(e) => set('display_name', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('advice.kindLabel', lang)} error={errors.provider_kind || undefined}>
          {(ids) => (
            <Select
              {...ids}
              value={values.provider_kind}
              onChange={(e) => set('provider_kind', e.target.value)}
            >
              <option value="">{t('register.select', lang)}</option>
              {labelled(ADVICE_PROVIDER_KINDS, KIND_KEY).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('advice.description', lang)}
          hint={t('advice.descriptionHint', lang)}
          error={errors.description || undefined}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={5}
              dir="auto"
              maxLength={ADVICE_LIMITS.descriptionMax}
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        {group('topics', t('advice.topicsPick', lang), labelled(ADVICE_TOPICS, TOPIC_KEY))}
        {group(
          'languages',
          t('advice.languagesPick', lang),
          labelled(ADVICE_LANGUAGES, LANGUAGE_KEY),
        )}
        {group(
          'state_ids',
          t('advice.statesPick', lang),
          states.map((s) => ({ value: s.id, label: s.name })),
          t('advice.statesHint', lang),
        )}
        {group(
          'delivery_modes',
          t('advice.deliveryPick', lang),
          labelled(ADVICE_DELIVERY_MODES, MODE_KEY),
        )}
        <Field
          label={t('advice.availability', lang)}
          hint={t('advice.availabilityHint', lang)}
          optional
          error={errors.availability || undefined}
        >
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={ADVICE_LIMITS.availabilityMax}
              value={values.availability}
              onChange={(e) => set('availability', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('advice.termsPick', lang)} error={errors.terms || undefined}>
          {(ids) => (
            <Select {...ids} value={values.terms} onChange={(e) => set('terms', e.target.value)}>
              <option value="">{t('register.select', lang)}</option>
              {labelled(ADVICE_TERMS, TERMS_KEY).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('advice.fees', lang)}
          hint={t('advice.feeNoteHint', lang)}
          optional
          error={errors.fee_note || undefined}
        >
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={ADVICE_LIMITS.feeNoteMax}
              value={values.fee_note}
              onChange={(e) => set('fee_note', e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('advice.commercial', lang)}
          hint={t('advice.commercialHint', lang)}
          optional
          error={errors.commercial_interests || undefined}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              dir="auto"
              maxLength={ADVICE_LIMITS.commercialMax}
              value={values.commercial_interests}
              onChange={(e) => set('commercial_interests', e.target.value)}
            />
          )}
        </Field>

        <div className={styles.actions}>
          {profile ? (
            <>
              <Button type="submit" disabled={busy}>
                {t('advice.save', lang)}
              </Button>
              {status === 'published' ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void save('unpublished')}
                >
                  {t('advice.unpublish', lang)}
                </Button>
              ) : (
                <Button variant="secondary" disabled={busy} onClick={() => void save('published')}>
                  {t('advice.publish', lang)}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void save('draft')}>
                {t('advice.saveDraft', lang)}
              </Button>
              <Button disabled={busy} onClick={() => void save('published')}>
                {t('advice.publish', lang)}
              </Button>
            </>
          )}
        </div>
      </form>

      {/* 2026-10-24: the optional approved-adviser pathway. Keyed by the
          profile so a first save starts the form from the saved lists. */}
      {source ? null : (
        <AdviserApplication
          key={profile?.id ?? 'none'}
          lang={lang}
          profile={profile}
          states={states}
        />
      )}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  ADVICE_CONTACT_MODES,
  ADVICE_LIMITS,
  adviceCaseCreateSchema,
  type AdviceProviderPublic,
  type AdviceTopic,
} from '@agri-erp/shared';

import { BackLinkRow } from '@/components/market-posts/bits';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  EmptyState,
  Field,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { AdviceError, createCase, getProvider, newId } from '@/lib/advice/client';
import {
  CONTACT_KEY,
  KIND_KEY,
  LANGUAGE_KEY,
  MODE_KEY,
  TERMS_KEY,
  TOPIC_KEY,
  caseHref,
} from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { messagesChanged } from '@/lib/messages/client';

import { coverageLine } from './AdviceDirectory';
import styles from './advice.module.css';

/** "October 2026" from "2026-10", in the reader's language. */
const monthOf = (month: string, lang: Language) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * ONE ADVICE PROVIDER (2026-10-22): what they advise on, in which languages,
 * where, how, when, on what terms, and any commercial interest they declare
 * -- then "Request advice". `base` is the directory on this side of the app;
 * `side` says where the new request's page is.
 */
export function ProviderDetail({
  id,
  lang,
  base,
  side,
}: {
  id: string;
  lang: Language;
  base: string;
  side: 'farmer' | 'buyer';
}) {
  const [row, setRow] = useState<AdviceProviderPublic | null | undefined>(undefined);

  useEffect(() => {
    getProvider(id)
      .then(setRow)
      .catch(() => setRow(null));
  }, [id]);

  if (row === undefined) return <p className="muted">{t('market.loading', lang)}</p>;
  if (row === null) {
    return (
      <div className={styles.narrow}>
        <BackLinkRow href={base} label={t('advice.back', lang)} />
        <EmptyState title={t('advice.gone', lang)} body={t('advice.emptyBody', lang)} />
      </div>
    );
  }

  return (
    <div className={styles.narrow}>
      <BackLinkRow href={base} label={t('advice.back', lang)} />
      <div className={styles.cardHead}>
        <Badge tone="leaf">{t(KIND_KEY[row.provider_kind], lang)}</Badge>
        <Badge tone="sorghum">{t(TERMS_KEY[row.terms], lang)}</Badge>
        {row.approved_adviser ? (
          <Badge tone="nile">{t('advice.approvedBadge', lang)}</Badge>
        ) : null}
      </div>
      <h1 dir="auto">{row.display_name}</h1>
      {row.approved_adviser && row.approved_since ? (
        <p className={styles.note}>
          {t('advice.approvedSince', lang)} {monthOf(row.approved_since, lang)}
        </p>
      ) : null}
      <p className={styles.prose} dir="auto">
        {row.description}
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>{t('advice.topics', lang)}</dt>
          <dd>{row.topics.map((v) => t(TOPIC_KEY[v], lang)).join(' · ')}</dd>
        </div>
        <div>
          <dt>{t('advice.languages', lang)}</dt>
          <dd>{row.languages.map((v) => t(LANGUAGE_KEY[v], lang)).join(', ')}</dd>
        </div>
        <div>
          <dt>{t('advice.coverage', lang)}</dt>
          <dd>{coverageLine(row, lang)}</dd>
        </div>
        <div>
          <dt>{t('advice.delivery', lang)}</dt>
          <dd>{row.delivery_modes.map((v) => t(MODE_KEY[v], lang)).join(', ')}</dd>
        </div>
        {row.availability ? (
          <div>
            <dt>{t('advice.availability', lang)}</dt>
            <dd dir="auto">{row.availability}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('advice.terms', lang)}</dt>
          <dd>
            {t(TERMS_KEY[row.terms], lang)}
            {row.fee_note ? (
              <>
                {' · '}
                <span dir="auto">{row.fee_note}</span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t('advice.commercial', lang)}</dt>
          <dd dir="auto">{row.commercial_interests ?? t('advice.noCommercial', lang)}</dd>
        </div>
      </dl>
      <p className={styles.note}>
        {t('advice.notEndorsed', lang)} {t('advice.noPurchase', lang)} ·{' '}
        {formatDate(row.updated_at, lang)}
      </p>
      <RequestForm provider={row} lang={lang} side={side} />
    </div>
  );
}

/**
 * "Request advice": a topic, the question, how to be reached, and whether to
 * share details -- UNTICKED until the person ticks it. The provider decides
 * whether and when to answer; the form says so before anything is sent.
 * The same shared schema as the route. Needs signal.
 */
function RequestForm({
  provider,
  lang,
  side,
}: {
  provider: AdviceProviderPublic;
  lang: Language;
  side: 'farmer' | 'buyer';
}) {
  const router = useRouter();
  // One id per form: Send pressed again after a lost answer is the same request.
  const [id] = useState(newId);
  const [topic, setTopic] = useState<AdviceTopic>(provider.topics[0] ?? 'other');
  const [question, setQuestion] = useState('');
  const [contact, setContact] = useState<string>('in_app');
  const [share, setShare] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const payload = {
      id,
      provider_id: provider.id,
      topic,
      question,
      preferred_contact: contact,
      share_details: share,
    };
    const check = adviceCaseCreateSchema.safeParse(payload);
    if (!check.success) {
      const next: Record<string, string> = {};
      for (const issue of check.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFailure(t('advice.needsSignal', lang));
      return;
    }
    setBusy(true);
    try {
      const made = await createCase(check.data);
      messagesChanged();
      router.push(caseHref(side, made.id));
    } catch (e) {
      if (e instanceof AdviceError && e.status === 401) setSignIn(true);
      else if (e instanceof AdviceError && e.status === 0)
        setFailure(t('advice.needsSignal', lang));
      else if (e instanceof AdviceError) {
        setErrors(e.fields);
        setFailure(e.message);
      } else setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (signIn) {
    return (
      <div className={styles.box}>
        <h2>{t('advice.askTitle', lang)}</h2>
        <div className={styles.actions}>
          <ButtonLink href="/join">{t('advice.signIn', lang)}</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.box} noValidate onSubmit={(e) => void submit(e)}>
      <h2>{t('advice.askTitle', lang)}</h2>
      <p className={styles.note}>{t('advice.askLead', lang)}</p>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      <div className={styles.formGrid}>
        <Field label={t('advice.topicLabel', lang)} error={errors.topic}>
          {(ids) => (
            <Select
              {...ids}
              value={topic}
              onChange={(e) => setTopic(e.target.value as AdviceTopic)}
            >
              {provider.topics.map((v) => (
                <option key={v} value={v}>
                  {t(TOPIC_KEY[v], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('advice.question', lang)}
          hint={t('advice.questionHint', lang)}
          error={errors.question}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={5}
              dir="auto"
              maxLength={ADVICE_LIMITS.questionMax}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('advice.preferredContact', lang)} error={errors.preferred_contact}>
          {(ids) => (
            <Select {...ids} value={contact} onChange={(e) => setContact(e.target.value)}>
              {ADVICE_CONTACT_MODES.map((v) => (
                <option key={v} value={v}>
                  {t(CONTACT_KEY[v], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <Checkbox
            label={t('advice.share', lang)}
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
          />
          <p className="small muted">{t('advice.shareHint', lang)}</p>
        </div>
      </div>
      <p className={styles.note}>
        {t('advice.noGuarantee', lang)} {t('advice.disclaimer', lang)}
      </p>
      <div className={styles.actions}>
        <Button type="submit" disabled={busy}>
          {t('advice.send', lang)}
        </Button>
      </div>
    </form>
  );
}

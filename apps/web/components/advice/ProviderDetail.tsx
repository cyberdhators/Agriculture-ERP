'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  ADVICE_ATTACHMENT_LIMITS,
  ADVICE_CONTACT_MODES,
  ADVICE_LIMITS,
  adviceCaseCreateSchema,
  type AdviceProviderPublic,
  type AdviceTopic,
  type AdvisoryNotePublic,
} from '@agri-erp/shared';

import css from '@/components/account/settings.module.css';
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
import {
  AdviceError,
  attachPhoto,
  createCase,
  getProvider,
  getProviderNotes,
  newId,
  shrinkAdvicePhoto,
} from '@/lib/advice/client';
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
import { t, type Language, type TKey } from '@/lib/i18n';
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
 *
 * 2026-10-31: the description and the facts on one white card, the request
 * form on another; the green action is Send.
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
        {row.approved_adviser ? <Badge tone="nile">{t('advice.approvedBadge', lang)}</Badge> : null}
      </div>
      <h1 dir="auto">{row.display_name}</h1>
      {row.approved_adviser && row.approved_since ? (
        <p className={styles.note}>
          {t('advice.approvedSince', lang)} {monthOf(row.approved_since, lang)}
        </p>
      ) : null}
      {/* 2026-10-28: the verification panel -- what CORWADO checked. */}
      {row.approved_adviser ? <ApprovalChecks row={row} lang={lang} /> : null}
      <section className={styles.box}>
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
      </section>
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
  // 2026-10-25: up to three photos, sent after the request is stored (their
  // place in the bucket is the case's id), each shrunk on the phone first.
  const [photos, setPhotos] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
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
      let photoFailed = false;
      for (const file of photos) {
        try {
          await attachPhoto(made.id, await shrinkAdvicePhoto(file));
        } catch {
          photoFailed = true;
        }
      }
      router.push(`${caseHref(side, made.id)}${photoFailed ? '?photos=failed' : ''}`);
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
        <div className={css.actions}>
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
        <div>
          <p className="small">
            <strong>{t('advice.photos', lang)}</strong>
          </p>
          <div className={styles.chosen}>
            {photos.map((file, i) => (
              <Button
                key={`${file.name}-${i}`}
                type="button"
                variant="ghost"
                size="small"
                onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
              >
                {file.name} ✕
              </Button>
            ))}
            {photos.length < ADVICE_ATTACHMENT_LIMITS.atCreate ? (
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={() => fileRef.current?.click()}
              >
                {t('advice.photosChoose', lang)}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            className={styles.hiddenInput}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const next = [...photos, ...Array.from(e.target.files ?? [])];
              if (next.length > ADVICE_ATTACHMENT_LIMITS.atCreate) {
                setFailure(t('advice.photosTooMany', lang));
              }
              setPhotos(next.slice(0, ADVICE_ATTACHMENT_LIMITS.atCreate));
              e.target.value = '';
            }}
          />
          <p className="small muted">{t('advice.photosHint', lang)}</p>
        </div>
      </div>
      <p className={styles.note}>
        {t('advice.noGuarantee', lang)} {t('advice.disclaimer', lang)}
      </p>
      <div className={css.actions}>
        <Button type="submit" disabled={busy}>
          {t('advice.send', lang)}
        </Button>
      </div>
    </form>
  );
}

/** 2026-10-28: "Approved adviser -- what CORWADO checked", and its published notes. */
function ApprovalChecks({ row, lang }: { row: AdviceProviderPublic; lang: Language }) {
  const [notes, setNotes] = useState<AdvisoryNotePublic[]>([]);
  useEffect(() => {
    let on = true;
    getProviderNotes(row.id)
      .then((n) => on && setNotes(n))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [row.id]);
  return (
    <section className={styles.box} aria-labelledby="approval-checks">
      <h2 id="approval-checks" className="small">
        {t('advice.checked.title', lang)}
      </h2>
      {row.verified_checks.length > 0 ? (
        <ul className="small">
          {row.verified_checks.map((c) => (
            <li key={c}>{t(`advice.checked.${c}` as TKey, lang)}</li>
          ))}
        </ul>
      ) : (
        <p className="small muted">{t('advice.checked.none', lang)}</p>
      )}
      <p className="small muted">{t('advice.checked.note', lang)}</p>
      {notes.length > 0 ? (
        <div>
          <h3 className="small">{t('notes.title', lang)}</h3>
          {notes.map((n) => (
            <article key={n.id} style={{ marginTop: 'var(--s-3)' }}>
              <h4 dir="auto">{n.title}</h4>
              <p className="small muted">
                {t('notes.reviewedBy', lang)} · {n.published_at.slice(0, 10)} ·{' '}
                {n.topics.map((v) => t(TOPIC_KEY[v], lang)).join(' · ')}
              </p>
              <p className={styles.prose} dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {n.body}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

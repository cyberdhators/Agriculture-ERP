'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  ADVICE_LIMITS,
  ADVICE_OUTCOMES_BY_SIDE,
  type AdviceCaseView,
  type AdviceOutcome,
} from '@agri-erp/shared';

import { BackLinkRow } from '@/components/market-posts/bits';
import { ConversationThread } from '@/components/messages/Messages';
import { Badge, Button, EmptyState, Field, Notice, Select, Textarea } from '@/components/ui';
import { AdviceError, changeCase, getCase } from '@/lib/advice/client';
import { CONTACT_KEY, OUTCOME_KEY, STATUS_KEY, TOPIC_KEY } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import styles from './advice.module.css';

const STATUS_TONE = { open: 'nile', in_progress: 'sorghum', closed: 'neutral' } as const;

/**
 * ONE ADVICE REQUEST (2026-10-22), from either side: its status and outcome,
 * the question, what the requester chose to share (the provider sees it), the
 * conversation -- the in-app messaging thread, so replies wait for signal like
 * any message -- and the changes this side may make: the provider takes it
 * up; either side closes it with an outcome; the requester rates it once it is
 * closed. A concern goes to CORWADO through the help page (/help).
 */
export function CaseDetail({
  id,
  lang,
  requestsHref,
  workHref,
}: {
  id: string;
  lang: Language;
  requestsHref: string;
  workHref: string;
}) {
  const [row, setRow] = useState<AdviceCaseView | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCase(id)
      .then(setRow)
      .catch(() => setRow(null));
  }, [id]);

  const change = useCallback(
    async (body: Parameters<typeof changeCase>[1]) => {
      setBusy(true);
      setFailure(null);
      try {
        setRow(await changeCase(id, body));
      } catch (e) {
        setFailure(e instanceof AdviceError ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  if (row === undefined) return <p className="muted">{t('market.loading', lang)}</p>;
  if (row === null) {
    return (
      <div className={styles.narrow}>
        <BackLinkRow href={requestsHref} label={t('advice.myRequests', lang)} />
        <EmptyState title={t('advice.notFound', lang)} body="" />
      </div>
    );
  }

  const mine = row.my_side === 'requester';
  return (
    <div className={styles.narrow}>
      <BackLinkRow
        href={mine ? requestsHref : workHref}
        label={t(mine ? 'advice.myRequests' : 'advice.work', lang)}
      />
      <div className={styles.cardHead}>
        <Badge tone={STATUS_TONE[row.status]}>{t(STATUS_KEY[row.status], lang)}</Badge>
        <span className="small muted">
          {t('advice.sentOn', lang)} {formatDate(row.created_at, lang)}
        </span>
      </div>
      <h1>
        {t('advice.caseTitle', lang)} · {t(TOPIC_KEY[row.topic], lang)}
      </h1>
      {row.outcome ? (
        <Notice kind="info">
          {t('advice.closedAs', lang)}: {t(OUTCOME_KEY[row.outcome], lang)}
          {row.closed_by_me ? ` (${t('advice.closedByYou', lang)})` : ''}
          {row.closed_at ? ` · ${formatDate(row.closed_at, lang)}` : ''}
        </Notice>
      ) : null}
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}

      <dl className={styles.facts}>
        <div>
          <dt>{t(mine ? 'advice.askedOf' : 'advice.askedBy', lang)}</dt>
          <dd dir="auto">{mine ? row.provider.display_name : row.requester_name}</dd>
        </div>
        <div>
          <dt>{t('advice.question', lang)}</dt>
          <dd className={styles.prose} dir="auto">
            {row.question}
          </dd>
        </div>
        <div>
          <dt>{t('advice.contactBy', lang)}</dt>
          <dd>{t(CONTACT_KEY[row.preferred_contact], lang)}</dd>
        </div>
        {mine ? null : row.shared ? (
          <>
            {row.shared.place ? (
              <div>
                <dt>{t('advice.sharedPlace', lang)}</dt>
                <dd dir="auto">{row.shared.place}</dd>
              </div>
            ) : null}
            {row.shared.phone ? (
              <div>
                <dt>{t('advice.sharedPhone', lang)}</dt>
                <dd className="mono">{row.shared.phone}</dd>
              </div>
            ) : null}
          </>
        ) : (
          <div>
            <dd className={styles.note}>{t('advice.notShared', lang)}</dd>
          </div>
        )}
      </dl>

      <p className={styles.note}>
        {t('advice.noGuarantee', lang)} {t('advice.disclaimer', lang)}
      </p>

      {row.status === 'closed' ? null : (
        <CloseControls row={row} lang={lang} busy={busy} onChange={change} />
      )}
      {mine && row.status === 'closed' ? (
        <Feedback row={row} lang={lang} busy={busy} onChange={change} />
      ) : null}
      {!mine && row.feedback_rating !== null ? (
        <div className={styles.box}>
          <h2>{t('advice.feedbackGiven', lang)}</h2>
          <p aria-label={`${row.feedback_rating} ${t('advice.stars', lang)}`}>
            {'★'.repeat(row.feedback_rating)}
            {'☆'.repeat(5 - row.feedback_rating)}
          </p>
          {row.feedback_comment ? (
            <p className={styles.prose} dir="auto">
              {row.feedback_comment}
            </p>
          ) : null}
        </div>
      ) : null}

      {row.conversation_id ? (
        <section className={styles.box}>
          <h2>{t('advice.conversation', lang)}</h2>
          <ConversationThread id={row.conversation_id} language={lang} embedded />
        </section>
      ) : null}

      <section className={styles.box}>
        <h2>{t('advice.concern', lang)}</h2>
        <p className={styles.note}>{t('advice.concernBody', lang)}</p>
        <Link href="/help">{t('help.title', lang)} →</Link>
      </section>
    </div>
  );
}

/** Take it up (provider, open only) and close with an outcome this side may choose. */
function CloseControls({
  row,
  lang,
  busy,
  onChange,
}: {
  row: AdviceCaseView;
  lang: Language;
  busy: boolean;
  onChange: (body: Parameters<typeof changeCase>[1]) => Promise<void>;
}) {
  const outcomes = ADVICE_OUTCOMES_BY_SIDE[row.my_side];
  const [outcome, setOutcome] = useState<AdviceOutcome>(outcomes[0]!);

  return (
    <div className={styles.box}>
      {row.my_side === 'provider' && row.status === 'open' ? (
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => void onChange({ action: 'start' })}>
            {t('advice.start', lang)}
          </Button>
        </div>
      ) : null}
      <Field label={t('advice.closeAs', lang)}>
        {(ids) => (
          <Select
            {...ids}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as AdviceOutcome)}
          >
            {outcomes.map((v) => (
              <option key={v} value={v}>
                {t(OUTCOME_KEY[v], lang)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('advice.closeConfirm', lang))) {
              void onChange({ action: 'close', outcome });
            }
          }}
        >
          {t('advice.closeAs', lang)}: {t(OUTCOME_KEY[outcome], lang)}
        </Button>
      </div>
    </div>
  );
}

/** One to five stars and an optional comment, once, after the request is closed. */
function Feedback({
  row,
  lang,
  busy,
  onChange,
}: {
  row: AdviceCaseView;
  lang: Language;
  busy: boolean;
  onChange: (body: Parameters<typeof changeCase>[1]) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const given = row.feedback_rating;

  return (
    <div className={styles.box}>
      <h2>{t(given === null ? 'advice.feedbackTitle' : 'advice.feedbackGiven', lang)}</h2>
      {given === null ? (
        <>
          <div
            className={styles.stars}
            role="radiogroup"
            aria-label={t('advice.feedbackTitle', lang)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} ${t('advice.stars', lang)}`}
                className={`${styles.star} ${n <= rating ? styles.starOn : ''}`}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <Field label={t('advice.feedbackComment', lang)}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                dir="auto"
                maxLength={ADVICE_LIMITS.commentMax}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              disabled={busy || rating === 0}
              onClick={() =>
                void onChange({
                  action: 'feedback',
                  rating,
                  ...(comment.trim() ? { comment: comment.trim() } : {}),
                })
              }
            >
              {t('advice.feedbackSend', lang)}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p aria-label={`${given} ${t('advice.stars', lang)}`}>
            {'★'.repeat(given)}
            {'☆'.repeat(5 - given)}
          </p>
          {row.feedback_comment ? (
            <p className={styles.prose} dir="auto">
              {row.feedback_comment}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  RATING_COMMENT_MAX,
  RATING_NOTE_MAX,
  REPORT_REASONS,
  submitRatingSchema,
  type DealToRate,
  type MyRatings,
  type RatingSummary,
  type ReceivedRating,
  type ReportReason,
} from '@agri-erp/shared';

import { Button, Field, Notice, Select, Skeleton, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, tCount, type Language, type TKey } from '@/lib/i18n';
import { MessagesError, myRatings, reportRating, submitRating } from '@/lib/messages/client';

import styles from './ratings.module.css';

/**
 * RATINGS AFTER A COMPLETED DEAL (2026-11-03, lane-trust). The stars shown on
 * public profiles, and the Ratings tab of Messages: the deals waiting for the
 * reader's rating, and the ratings they received, each with "Report".
 */

const REASON_KEY: Record<ReportReason, TKey> = {
  prohibited_content: 'report.prohibited_content',
  misleading_listing: 'report.misleading_listing',
  counterfeit_or_fraud: 'report.counterfeit_or_fraud',
  inappropriate_content: 'report.inappropriate_content',
  duplicate_or_spam: 'report.duplicate_or_spam',
  other: 'report.other',
};

const STAR_PATH = 'M8 1.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 12l-4.2 2.2.8-4.7L1.2 6.2l4.7-.7z';

function StarRow() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 16 16" aria-hidden focusable="false">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </>
  );
}

/**
 * Five stars, read out as "4 of 5". 2026-10-31 (delight, "trust you can
 * see"): drawn shapes, filled to the exact value (4.6 fills four and most of
 * the fifth) over a row of empty ones, instead of text glyphs.
 */
export function Stars({ value }: { value: number }) {
  const fill = Math.max(0, Math.min(5, value)) * 20;
  return (
    <span className={styles.stars} role="img" aria-label={`${value} / 5`}>
      <span className={styles.starsEmpty}>
        <StarRow />
      </span>
      <span className={styles.starsFill} style={{ width: `${fill}%` }}>
        <StarRow />
      </span>
    </span>
  );
}

/**
 * 2026-10-31 (delight): the compact mark for a name row -- "★ 4.6 · 12".
 * Nothing at all before the first rating: an empty mark reads as a bad one.
 */
export function RatingMark({
  summary,
  language,
}: {
  summary: RatingSummary | undefined;
  language: Language;
}) {
  if (!summary || summary.count === 0 || summary.average === null) return null;
  const average = summary.average.toFixed(1);
  return (
    <span
      className={styles.mark}
      role="img"
      aria-label={`${average} / 5 · ${tCount('rate.count', summary.count, language)}`}
    >
      <svg className={styles.markStar} viewBox="0 0 16 16" aria-hidden focusable="false">
        <path d={STAR_PATH} />
      </svg>
      <span className={styles.markValue}>{average}</span>
      <span className={styles.markCount}>· {summary.count}</span>
    </span>
  );
}

/** The public block on a profile: the average, the count and the latest comments. */
export function RatingsSummaryBlock({
  summary,
  language,
}: {
  summary: RatingSummary | undefined;
  language: Language;
}) {
  if (!summary) return null;
  return (
    <section className={styles.section} aria-label={t('rate.publicTitle', language)}>
      <h2>{t('rate.publicTitle', language)}</h2>
      {summary.count === 0 || summary.average === null ? (
        <p className={styles.lead}>{t('rate.publicNone', language)}</p>
      ) : (
        <>
          <div className={styles.average}>
            <span className={styles.averageValue}>{summary.average.toFixed(1)}</span>
            <Stars value={summary.average} />
            <span className={styles.meta}>{tCount('rate.count', summary.count, language)}</span>
          </div>
          {summary.latest.length > 0 ? (
            <ul className={styles.list}>
              {summary.latest.map((r, i) => (
                <li key={`${r.created_at}-${i}`} className={styles.card}>
                  <Stars value={r.stars} />
                  <p className={styles.comment} dir="auto">
                    {r.comment}
                  </p>
                  <span className={styles.meta}>
                    {r.rater_name ?? t('rate.member', language)} ·{' '}
                    {formatDate(r.created_at, language)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Five star buttons; the chosen number is announced. */
function StarPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <fieldset className={styles.picker}>
      <legend className="small muted">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`${styles.star} ${n <= value ? styles.starOn : ''}`}
          aria-pressed={n === value}
          aria-label={`${n} / 5`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </fieldset>
  );
}

function RateDeal({
  deal,
  language,
  onDone,
}: {
  deal: DealToRate;
  language: Language;
  onDone: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const parsed = submitRatingSchema.safeParse({
      deal_kind: deal.deal_kind,
      deal_id: deal.deal_id,
      stars,
      ...(comment.trim() ? { comment } : {}),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? t('rate.failed', language));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await submitRating(parsed.data);
      onDone();
    } catch (e) {
      setProblem(e instanceof MessagesError ? e.message : t('rate.failed', language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.card}>
      <strong dir="auto">
        {deal.deal_kind === 'purchase_order' ? `${t('rate.order', language)} · ` : ''}
        {deal.title}
      </strong>
      <span className={styles.meta}>
        {t('rate.with', language)} {deal.other_name} · {t('rate.rateBy', language)}{' '}
        {formatDate(deal.rate_by, language)}
      </span>
      <form className={styles.section} onSubmit={(e) => void send(e)}>
        <StarPicker value={stars} onChange={setStars} label={t('rate.stars', language)} />
        <Field label={t('rate.comment', language)}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              dir="auto"
              maxLength={RATING_COMMENT_MAX}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        {problem ? <Notice kind="error">{problem}</Notice> : null}
        <div className={styles.actions}>
          <Button type="submit" disabled={busy || stars === 0}>
            {t('rate.submit', language)}
          </Button>
        </div>
      </form>
    </li>
  );
}

function Received({
  rating,
  language,
  onReported,
}: {
  rating: ReceivedRating;
  language: Language;
  onReported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('inappropriate_content');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await reportRating(rating.id, { reason, ...(note.trim() ? { note } : {}) });
      setOpen(false);
      onReported();
    } catch (e) {
      setProblem(e instanceof MessagesError ? e.message : t('rate.failed', language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.card}>
      <Stars value={rating.stars} />
      {rating.comment ? (
        <p className={styles.comment} dir="auto">
          {rating.comment}
        </p>
      ) : null}
      <span className={styles.meta}>
        {rating.rater_name ?? t('rate.member', language)} ·{' '}
        {formatDate(rating.created_at, language)}
      </span>
      {rating.hidden ? <span className={styles.meta}>{t('rate.hidden', language)}</span> : null}
      {rating.reported ? (
        <span className={styles.meta}>{t('rate.reported', language)}</span>
      ) : open ? (
        <form className={styles.section} onSubmit={(e) => void send(e)}>
          <Field label={t('rate.reportReason', language)}>
            {(ids) => (
              <Select
                {...ids}
                value={reason}
                onChange={(e) => setReason(e.target.value as ReportReason)}
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(REASON_KEY[r], language)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('rate.reportNote', language)}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={2}
                dir="auto"
                maxLength={RATING_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {problem ? <Notice kind="error">{problem}</Notice> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="danger" size="small" disabled={busy}>
              {t('rate.reportSend', language)}
            </Button>
            <Button variant="ghost" size="small" onClick={() => setOpen(false)}>
              {t('rate.cancel', language)}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
            {t('rate.report', language)}
          </Button>
        </div>
      )}
    </li>
  );
}

/** The Ratings tab of Messages. */
export function MyRatingsPanel({ language }: { language: Language }) {
  const [data, setData] = useState<MyRatings | null>(null);
  const [problem, setProblem] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    myRatings()
      .then((got) => {
        setData(got);
        setProblem(false);
      })
      .catch(() => setProblem(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (problem && !data) return <Notice kind="warn">{t('rate.failed', language)}</Notice>;
  if (!data) return <Skeleton height={64} />;

  return (
    <div className={styles.section}>
      <section className={styles.section}>
        <h2>{t('rate.toRateTitle', language)}</h2>
        <p className={styles.lead}>{t('rate.toRateLead', language)}</p>
        {sent ? <Notice kind="success">{t('rate.sent', language)}</Notice> : null}
        {data.to_rate.length === 0 ? (
          <p className={styles.lead}>{t('rate.noneToRate', language)}</p>
        ) : (
          <ul className={styles.list}>
            {data.to_rate.map((deal) => (
              <RateDeal
                key={`${deal.deal_kind}-${deal.deal_id}`}
                deal={deal}
                language={language}
                onDone={() => {
                  setSent(true);
                  load();
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2>{t('rate.receivedTitle', language)}</h2>
        {data.summary.average !== null ? (
          <div className={styles.average}>
            <span className={styles.meta}>{t('rate.average', language)}</span>
            <span className={styles.averageValue}>{data.summary.average.toFixed(1)}</span>
            <Stars value={data.summary.average} />
            <span className={styles.meta}>
              {tCount('rate.count', data.summary.count, language)}
            </span>
          </div>
        ) : null}
        {data.received.length === 0 ? (
          <p className={styles.lead}>{t('rate.noneReceived', language)}</p>
        ) : (
          <ul className={styles.list}>
            {data.received.map((r) => (
              <Received key={r.id} rating={r} language={language} onReported={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

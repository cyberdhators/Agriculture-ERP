'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ADVICE_LANGUAGES,
  ADVICE_TOPICS,
  ADVISORY_NOTE_LIMITS,
  type AdvisoryNoteOwn,
  type AdvisoryNoteStatus,
  advisoryNoteInputSchema,
} from '@agri-erp/shared';

import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
  type Tone,
} from '@/components/ui';
import {
  AdviceError,
  getMyNotes,
  resubmitNote,
  submitNote,
  withdrawNote,
} from '@/lib/advice/client';
import { LANGUAGE_KEY, TOPIC_KEY } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import styles from './advice.module.css';

/**
 * OFFICIAL ADVISORY NOTES, THE ADVISER'S SIDE (2026-10-28, lane-security).
 * Shown only to an approved adviser. Write a note, send it for CORWADO's
 * review, see where each stands, edit and resend a returned one, or withdraw
 * one not yet published. The server decides whether a note may be sent
 * (approval standing and not suspended); this screen says what it answers.
 */

const STATUS_KEY: Record<AdvisoryNoteStatus, TKey> = {
  submitted: 'notes.status.submitted',
  returned: 'notes.status.returned',
  published: 'notes.status.published',
  unpublished: 'notes.status.unpublished',
  withdrawn: 'notes.status.withdrawn',
};

const STATUS_TONE: Record<AdvisoryNoteStatus, Tone> = {
  submitted: 'nile',
  returned: 'sorghum',
  published: 'leaf',
  unpublished: 'clay',
  withdrawn: 'neutral',
};

interface Draft {
  id: string | null;
  title: string;
  topics: string[];
  language: string;
  body: string;
}

const EMPTY: Draft = { id: null, title: '', topics: [], language: 'en', body: '' };

export function AdvisoryNotes({ lang }: { lang: Language }) {
  const [notes, setNotes] = useState<AdvisoryNoteOwn[] | null>(null);
  const [maySubmit, setMaySubmit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getMyNotes()
      .then((r) => {
        setNotes(r.notes);
        setMaySubmit(r.may_submit);
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  const send = async () => {
    if (!draft) return;
    const parsed = advisoryNoteInputSchema.safeParse({
      title: draft.title,
      topics: draft.topics,
      language: draft.language,
      body: draft.body,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (draft.id) await resubmitNote(draft.id, parsed.data);
      else await submitNote(parsed.data);
      setDraft(null);
      setErrors({});
      setDone(t('notes.sent', lang));
      load();
    } catch (e) {
      if (e instanceof AdviceError) {
        setErrors(e.fields);
        setFailure(e.message);
      } else setFailure(String(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await withdrawNote(id);
      load();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.formGrid} aria-labelledby="advisory-notes">
      <h3 id="advisory-notes">{t('notes.title', lang)}</h3>
      <p className="small">{t('notes.lead', lang)}</p>
      {!maySubmit && notes !== null ? <Notice kind="warn">{t('notes.paused', lang)}</Notice> : null}
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      {done ? <Notice kind="success">{done}</Notice> : null}

      {maySubmit && !draft ? (
        <div className={styles.actions}>
          <Button
            onClick={() => {
              setDone(null);
              setDraft({ ...EMPTY, language: lang === 'ar' ? 'ar' : 'en' });
            }}
          >
            {t('notes.new', lang)}
          </Button>
        </div>
      ) : null}

      {draft ? (
        <form
          className={styles.formGrid}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Field label={t('notes.titleField', lang)} error={errors.title || undefined}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                maxLength={ADVISORY_NOTE_LIMITS.titleMax}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            )}
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">{t('notes.topics', lang)}</legend>
            {ADVICE_TOPICS.map((v) => (
              <Checkbox
                key={v}
                label={t(TOPIC_KEY[v], lang)}
                checked={draft.topics.includes(v)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    topics: e.target.checked
                      ? [...draft.topics, v]
                      : draft.topics.filter((x) => x !== v),
                  })
                }
              />
            ))}
            {errors.topics ? (
              <p className="small" role="alert">
                {errors.topics}
              </p>
            ) : null}
          </fieldset>
          <Field label={t('notes.language', lang)} error={errors.language || undefined}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value })}
              >
                {ADVICE_LANGUAGES.map((v) => (
                  <option key={v} value={v}>
                    {t(LANGUAGE_KEY[v], lang)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('notes.body', lang)}
            hint={`${ADVISORY_NOTE_LIMITS.bodyMin}–${ADVISORY_NOTE_LIMITS.bodyMax}`}
            error={errors.body || undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={8}
                dir="auto"
                maxLength={ADVISORY_NOTE_LIMITS.bodyMax}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button type="submit" disabled={busy}>
              {draft.id ? t('notes.resend', lang) : t('notes.send', lang)}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>
              {t('msg.cancel', lang)}
            </Button>
          </div>
        </form>
      ) : null}

      {notes && notes.length === 0 ? <p className="small muted">{t('notes.none', lang)}</p> : null}
      {(notes ?? []).map((n) => (
        <div key={n.id} className={styles.formGrid}>
          <p className="small">
            <strong dir="auto">{n.title}</strong>{' '}
            <Badge tone={STATUS_TONE[n.status]}>{t(STATUS_KEY[n.status], lang)}</Badge> ·{' '}
            {formatDate(n.updated_at, lang)}
          </p>
          {n.review_note && (n.status === 'returned' || n.status === 'unpublished') ? (
            <p className="small">
              {t('notes.staffNote', lang)}: <span dir="auto">{n.review_note}</span>
            </p>
          ) : null}
          <div className={styles.actions}>
            {n.status === 'returned' && maySubmit ? (
              <Button
                size="small"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setDraft({
                    id: n.id,
                    title: n.title,
                    topics: n.topics,
                    language: n.language,
                    body: n.body,
                  })
                }
              >
                {t('notes.edit', lang)}
              </Button>
            ) : null}
            {n.status === 'submitted' || n.status === 'returned' ? (
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => void withdraw(n.id)}
              >
                {t('notes.withdraw', lang)}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

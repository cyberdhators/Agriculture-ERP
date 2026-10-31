'use client';

import { useEffect, useRef, useState } from 'react';

import { ASSISTANT_LIMITS, assistantRequestSchema } from '@agri-erp/shared';

import { useFarmerSession } from '@/lib/farmer-session';
import { t, type TKey } from '@/lib/i18n';
import { offlineNow } from '@/lib/offline/net';
import { readSnapshot, saveSnapshot } from '@/lib/offline/snapshot';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** A small copy of a photo the farmer sent, for this phone's screen only. */
  thumb?: string;
}

/** A photo ready to send: the shrunk JPEG for the model, a thumbnail for the screen. */
interface Photo {
  data: string;
  thumb: string;
}

/**
 * Shrink a photo on the phone before it is sent (2026-10-17): about 1024
 * pixels on the long side as JPEG, so it uploads on a weak signal and fits
 * the request limit. A second, smaller pass if the first is still too big.
 */
async function shrinkPhoto(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const draw = (max: number, quality: number) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  let full = draw(1024, 0.75);
  if (full.length > ASSISTANT_LIMITS.imageMaxChars) full = draw(768, 0.6);
  const thumb = draw(240, 0.6);
  bitmap.close();
  const data = full.slice(full.indexOf(',') + 1);
  if (data.length > ASSISTANT_LIMITS.imageMaxChars) throw new Error('too large');
  return { data, thumb };
}

/** Kept on this phone, per account, and cleared at sign-out with the other saved screens. */
const SAVED = 'farmer.assistant';

const SUGGESTIONS: readonly TKey[] = ['ai.suggest1', 'ai.suggest2', 'ai.suggest3', 'ai.suggest4'];

/**
 * AGRIONE AI (2026-10-17): the farmer's chat in place of the learning
 * library. Each question goes to POST /api/farmer/assistant with the recent
 * turns, and the answer is shown as it arrives. The conversation lives on
 * this phone only. With no signal, the earlier answers stay readable and
 * asking waits for signal.
 */
export function FarmerAssistant() {
  const { language } = useFarmerSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void readSnapshot<Turn[]>(SAVED)
      .then((kept) => {
        if (kept?.data?.length) setTurns(kept.data);
      })
      .catch(() => undefined);
    const update = () => setOffline(offlineNow());
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch {
      setError(t('ai.photoFailed', language));
    }
  }

  async function ask(question: string, withPhoto: Photo | null = photo) {
    const text = question.trim();
    if ((!text && !withPhoto) || busy) return;
    if (offlineNow()) {
      setOffline(true);
      return;
    }
    // The server takes the most recent turns, ending with this question. Only
    // this question carries its photo; earlier photos are not sent again.
    const asked: Turn = withPhoto
      ? { role: 'user', content: text, thumb: withPhoto.thumb }
      : { role: 'user', content: text };
    const history: Turn[] = [...turns, asked];
    const sent = history.slice(-ASSISTANT_LIMITS.historyMax);
    const startAt = sent.findIndex((x) => x.role === 'user');
    const wire = sent.slice(Math.max(startAt, 0)).map((x, i, all) =>
      i === all.length - 1 && withPhoto
        ? {
            role: x.role,
            content: text,
            image: { media_type: 'image/jpeg', data: withPhoto.data },
          }
        : { role: x.role, content: x.content || (x.thumb ? t('ai.photoEarlier', language) : '') },
    );
    const body = { messages: wire, language };
    const parsed = assistantRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('ai.failed', language));
      return;
    }

    setError(null);
    setDraft('');
    setPhoto(null);
    setBusy(true);
    setTurns([...history, { role: 'assistant', content: '' }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let answer = '';
    try {
      const res = await fetch('/api/farmer/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? t('ai.failed', language));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns([...history, { role: 'assistant', content: answer }]);
      }
      const done = [...history, { role: 'assistant' as const, content: answer.trim() }];
      setTurns(done);
      await saveSnapshot(SAVED, done).catch(() => undefined);
    } catch (e) {
      if (controller.signal.aborted) return;
      // Keep the question so it can be sent again; drop the empty answer.
      setTurns(turns);
      setDraft(text);
      setPhoto(withPhoto);
      setError(
        offlineNow()
          ? t('ai.offline', language)
          : e instanceof TypeError
            ? t('ai.failed', language)
            : e instanceof Error
              ? e.message
              : t('ai.failed', language),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setTurns([]);
    setPhoto(null);
    setError(null);
    void saveSnapshot(SAVED, []).catch(() => undefined);
  }

  return (
    <>
      <PageHead
        title={t('ai.title', language)}
        quiet
        actions={
          turns.length > 0 ? (
            <button type="button" className={styles.aiNew} onClick={newChat} disabled={busy}>
              {t('ai.newChat', language)}
            </button>
          ) : undefined
        }
      />

      {offline ? (
        <p className={styles.aiNotice} role="status">
          {t('ai.offline', language)}
        </p>
      ) : null}

      {turns.length === 0 ? (
        <div className={styles.aiHello}>
          <span className={styles.aiHelloIcon} aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5Z" />
              <path d="M9 9.5h6M9 12.5h4" />
            </svg>
          </span>
          <p className={styles.aiHelloText}>{t('ai.hello', language)}</p>
        </div>
      ) : null}

      <div className={styles.aiThread} aria-live="polite">
        {turns.length === 0 ? (
          <div className={styles.aiSuggest}>
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.aiChip}
                onClick={() => void ask(t(key, language), null)}
                disabled={busy || offline}
                dir="auto"
              >
                {t(key, language)}
              </button>
            ))}
          </div>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={turn.role === 'user' ? styles.aiUser : styles.aiBot} dir="auto">
              <span className={styles.aiWho}>
                {turn.role === 'user' ? t('ai.you', language) : t('ai.name', language)}
              </span>
              {turn.thumb ? (
                <img
                  className={styles.aiThumb}
                  src={turn.thumb}
                  alt={t('ai.photoSent', language)}
                />
              ) : null}
              <div className={styles.aiText}>
                {turn.content || (busy && i === turns.length - 1 ? t('ai.sending', language) : '')}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className={styles.aiError} role="alert">
          {error}
        </p>
      ) : null}

      {photo ? (
        <div className={styles.aiPreview}>
          <img className={styles.aiThumb} src={photo.thumb} alt={t('ai.photoSent', language)} />
          <button
            type="button"
            className={styles.aiNew}
            onClick={() => setPhoto(null)}
            disabled={busy}
          >
            {t('ai.removePhoto', language)}
          </button>
        </div>
      ) : null}

      <form
        className={styles.aiForm}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        {/* Android offers the camera and the gallery for this input. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pickPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={styles.aiPhoto}
          onClick={() => fileRef.current?.click()}
          disabled={busy || offline}
          aria-label={t('ai.photo', language)}
          title={t('ai.photo', language)}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
        <textarea
          className={styles.aiInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          placeholder={t('ai.placeholder', language)}
          aria-label={t('ai.placeholder', language)}
          maxLength={ASSISTANT_LIMITS.messageMax}
          rows={2}
          dir="auto"
          disabled={busy}
        />
        <button
          type="submit"
          className={styles.aiSend}
          disabled={busy || offline || (!draft.trim() && !photo)}
        >
          {busy ? t('ai.sending', language) : t('ai.send', language)}
        </button>
      </form>
      <p className={styles.aiDisclaimer}>{t('ai.disclaimer', language)}</p>
    </>
  );
}

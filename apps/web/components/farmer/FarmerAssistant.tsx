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

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    if (offlineNow()) {
      setOffline(true);
      return;
    }
    // The server takes the most recent turns, ending with this question.
    const history: Turn[] = [...turns, { role: 'user', content: text }];
    const sent = history.slice(-ASSISTANT_LIMITS.historyMax);
    const startAt = sent.findIndex((x) => x.role === 'user');
    const body = { messages: sent.slice(Math.max(startAt, 0)), language };
    const parsed = assistantRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('ai.failed', language));
      return;
    }

    setError(null);
    setDraft('');
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
    setError(null);
    void saveSnapshot(SAVED, []).catch(() => undefined);
  }

  return (
    <>
      <PageHead
        title={t('ai.title', language)}
        lead={t('ai.lead', language)}
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

      <div className={styles.aiThread} aria-live="polite">
        {turns.length === 0 ? (
          <div className={styles.aiSuggest}>
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.aiChip}
                onClick={() => void ask(t(key, language))}
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

      <form
        className={styles.aiForm}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
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
        <button type="submit" className={styles.aiSend} disabled={busy || offline || !draft.trim()}>
          {busy ? t('ai.sending', language) : t('ai.send', language)}
        </button>
      </form>
      <p className={styles.aiDisclaimer}>{t('ai.disclaimer', language)}</p>
    </>
  );
}

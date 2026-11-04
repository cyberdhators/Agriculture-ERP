'use client';

import { useEffect, useState } from 'react';

import { t, type Language } from '@/lib/i18n';
import { pushState, stopPushOnThisPhone, turnPushOn, type PushState } from '@/lib/push/client';

import css from './settings.module.css';

/**
 * Alerts on this phone (2026-11-03): one switch on Account, on the phone it is
 * flipped on. Nothing shows on a browser that cannot do it, or before the
 * site's keys are set.
 */
export function PushRow({ language }: { language: Language }) {
  const [state, setState] = useState<PushState>('hidden');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    pushState(language).then(
      (s) => {
        if (live) setState(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [language]);

  if (state === 'hidden') return null;

  async function flip(on: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      if (on) setState(await turnPushOn(language));
      else {
        await stopPushOnThisPhone();
        setState('off');
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const hint = failed
    ? t('push.row.failed', language)
    : state === 'install'
      ? t('push.row.install', language)
      : state === 'blocked'
        ? t('push.row.blocked', language)
        : null;

  return (
    <li>
      <label className={css.row}>
        <span className={css.rowIcon} aria-hidden>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2.2 2.2 0 0 0 4 0" />
          </svg>
        </span>
        <span className={css.rowText}>
          <span className={css.rowLabel}>{t('push.row.label', language)}</span>
          {hint ? <span className={css.rowHint}>{hint}</span> : null}
        </span>
        <input
          type="checkbox"
          role="switch"
          className={css.switch}
          checked={state === 'on'}
          disabled={busy || state === 'install' || state === 'blocked'}
          onChange={(e) => void flip(e.target.checked)}
        />
      </label>
    </li>
  );
}

'use client';

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';

import { clearCacheFor } from '@/lib/offline/db';
import {
  discard,
  retry,
  setAccount,
  signedInAgain,
  subscribeOutbox,
  summary,
  syncNow,
  type OutboxSummary,
} from '@/lib/offline/outbox';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * RUNS THE OUTBOX AND SHOWS ITS STATE (2026-10-10, PWA step 2), on every page.
 *
 * Follows the sign-in: the outbox in use is the signed-in account's own. At
 * sign-out, saved screens are cleared and unsent changes kept (they send when
 * that person signs in again). Syncs when signal returns, when the app comes
 * back to the front, once a minute, and when Android's background sync wakes
 * the service worker.
 *
 * Shows nothing while there is nothing to say. Otherwise a small indicator:
 * "3 changes waiting to send", "Sending…", "Sign in again to send", or
 * "1 change needs attention" opening the list with each reason.
 */
export function OfflineSync() {
  const [state, setState] = useState<OutboxSummary | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    void summary().then(setState);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOutbox(refresh);
    let previous: string | null = null;
    let auth: { subscription: { unsubscribe: () => void } } | null = null;

    try {
      const supabase = supabaseBrowser();
      // getSession reads the saved session, so the account is known offline too.
      void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
        previous = data.session?.user.id ?? null;
        setAccount(previous);
      });
      auth = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
        const id = session?.user.id ?? null;
        if (event === 'SIGNED_OUT') {
          if (previous) void clearCacheFor(previous);
          previous = null;
          setAccount(null);
          return;
        }
        if (id !== previous) {
          previous = id;
          setAccount(id);
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          signedInAgain();
        }
      }).data;
    } catch {
      // No sign-in service configured (local tests): the outbox stays off.
    }

    const kick = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'agrione-sync') kick();
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    const timer = window.setInterval(kick, 60_000);
    refresh();

    return () => {
      unsubscribe();
      auth?.subscription.unsubscribe();
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!state || !state.account) return null;
  const stopped = state.stopped.length;
  const waiting = state.waiting + state.held;
  if (!stopped && !waiting && !state.syncing && !state.needsSignIn) return null;

  const label = state.needsSignIn
    ? 'Sign in again to send your changes'
    : stopped
      ? `${stopped} change${stopped === 1 ? '' : 's'} need${stopped === 1 ? 's' : ''} attention`
      : state.syncing
        ? 'Sending…'
        : `${waiting} change${waiting === 1 ? '' : 's'} waiting to send`;

  return (
    <div
      style={{
        position: 'fixed',
        insetInlineStart: '1rem',
        bottom: '3rem',
        zIndex: 999,
        maxWidth: 'min(420px, calc(100vw - 2rem))',
        fontSize: '0.875rem',
      }}
    >
      {open && stopped ? (
        <div
          role="dialog"
          aria-label="Changes that need attention"
          style={{
            marginBottom: '0.5rem',
            background: '#fff',
            color: '#132a1c',
            border: '1px solid #d6dccf',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            padding: '0.75rem',
            display: 'grid',
            gap: '0.75rem',
            maxHeight: '50vh',
            overflowY: 'auto',
          }}
        >
          {state.stopped.map((r) => (
            <div key={r.id} style={{ display: 'grid', gap: '0.25rem' }}>
              <strong>{r.label}</strong>
              <span>{r.message}</span>
              <span style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={() => void retry(r.id)} style={linkButton}>
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Discard this change? It will not be sent.')) {
                      void discard(r.id);
                    }
                  }}
                  style={linkButton}
                >
                  Discard
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => (state.needsSignIn ? window.location.assign('/open') : setOpen((o) => !o))}
          style={{
            background: stopped || state.needsSignIn ? '#8a1f11' : 'var(--band, #0f2e1c)',
            color: '#fff',
            border: 0,
            borderRadius: 999,
            padding: '0.45rem 0.9rem',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          {label}
        </button>
        {!state.syncing && waiting && !state.needsSignIn ? (
          <button type="button" onClick={() => void syncNow()} style={linkButton}>
            Send now
          </button>
        ) : null}
      </span>
    </div>
  );
}

const linkButton = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

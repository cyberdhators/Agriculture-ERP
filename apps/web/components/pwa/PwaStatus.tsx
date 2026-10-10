'use client';

import { useEffect, useState } from 'react';

/**
 * PWA STATUS (2026-10-10, PWA step 1), on every page:
 *
 *   - a thin strip when the phone has no signal, so nobody mistakes an old
 *     saved page for the latest one;
 *   - an "Install AgriOne" button when the phone offers to install the app
 *     (Android Chrome's beforeinstallprompt). Dismissed once, it stays hidden
 *     on this phone.
 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'agrione.pwa.installDismissed';

export function PwaStatus() {
  const [online, setOnline] = useState(true);
  const [installable, setInstallable] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);

    const offer = (event: Event) => {
      event.preventDefault();
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(DISMISSED_KEY) === '1';
      } catch {
        // Storage blocked: offer every time.
      }
      if (!dismissed) setInstallable(event as InstallPrompt);
    };
    const installed = () => setInstallable(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const dismiss = () => {
    setInstallable(null);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  return (
    <>
      {online ? null : (
        <div
          role="status"
          style={{
            position: 'fixed',
            insetInline: 0,
            bottom: 0,
            zIndex: 1000,
            padding: '0.5rem 1rem',
            background: '#7a4b00',
            color: '#fff',
            fontSize: '0.875rem',
            textAlign: 'center',
          }}
        >
          No signal. You are seeing pages saved on this phone; they may be out of date.
        </div>
      )}
      {installable && online ? (
        <div
          style={{
            position: 'fixed',
            insetInlineEnd: '1rem',
            bottom: '1rem',
            zIndex: 1000,
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            padding: '0.5rem 0.75rem',
            background: 'var(--band, #0f2e1c)',
            color: 'var(--band-ink, #f2f6ee)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            fontSize: '0.875rem',
          }}
        >
          <button
            type="button"
            onClick={() => {
              void installable.prompt();
              void installable.userChoice.finally(() => setInstallable(null));
            }}
            style={{
              background: 'var(--green, #1f7a3f)',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '0.4rem 0.75rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Install AgriOne
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}

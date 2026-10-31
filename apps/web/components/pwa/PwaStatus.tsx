'use client';

import { useEffect, useState } from 'react';

/**
 * PWA STATUS (2026-10-10, PWA step 1), on every page:
 *
 *   - a thin strip when the phone has no signal, so nobody mistakes an old
 *     saved page for the latest one. Its ✕ (2026-10-17, the owner) hides it
 *     for this stretch without signal only: the next time the signal drops,
 *     it shows again, so a new outage is never silent;
 *   - an "Install AgriOne" button when the phone offers to install the app
 *     (Android Chrome's beforeinstallprompt). Dismissed once, it stays hidden
 *     on this phone.
 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'agrione.pwa.installDismissed';

/**
 * 2026-10-31 (Arabic pass): this sits in the root layout, outside the shells
 * that know the language, so it follows the page's own `lang` (which the
 * farmer, buyer and market shells set) and switches with it.
 */
function usePageArabic(): boolean {
  const [arabic, setArabic] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setArabic(root.lang === 'ar');
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => watch.disconnect();
  }, []);
  return arabic;
}

export function PwaStatus() {
  const [online, setOnline] = useState(true);
  /** The farmer closed the no-signal strip; cleared whenever the signal changes. */
  const [stripHidden, setStripHidden] = useState(false);
  const [installable, setInstallable] = useState<InstallPrompt | null>(null);
  const ar = usePageArabic();

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      setStripHidden(false);
    };
    const down = () => {
      setOnline(false);
      setStripHidden(false);
    };
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
      {online || stripHidden ? null : (
        <div
          role="status"
          style={{
            position: 'fixed',
            insetInline: 0,
            bottom: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            paddingBlock: '0.5rem',
            paddingInline: '1rem 0.5rem',
            background: '#7a4b00',
            color: '#fff',
            fontSize: '0.875rem',
          }}
        >
          <span style={{ flex: 1, textAlign: 'center' }}>
            {ar
              ? 'لا توجد إشارة. تعرض صفحات محفوظة على هذا الهاتف، وقد لا تكون محدّثة.'
              : 'No signal. You are seeing pages saved on this phone; they may be out of date.'}
          </span>
          <button
            type="button"
            onClick={() => setStripHidden(true)}
            aria-label={ar ? 'إخفاء هذه الرسالة' : 'Hide this message'}
            title={ar ? 'إخفاء هذه الرسالة' : 'Hide this message'}
            style={{
              flex: '0 0 auto',
              width: 44,
              height: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 0,
              borderRadius: 6,
              color: 'inherit',
              fontSize: '1.25rem',
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
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
            {ar ? 'ثبّت أجري ون' : 'Install AgriOne'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={ar ? 'ليس الآن' : 'Not now'}
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}

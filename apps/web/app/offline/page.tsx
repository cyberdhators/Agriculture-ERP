import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'No signal' };

/**
 * THE OFFLINE PAGE (2026-10-10, PWA step 1). The service worker shows it in
 * place of a page that was never opened on this phone while there is no
 * signal. Pages opened before still work offline.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '1rem',
        background: 'var(--paper)',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: '0.75rem' }}>
        <h1 style={{ fontSize: '1.5rem' }}>No signal</h1>
        <p>
          This page has not been opened on this phone before, so it is not saved for offline use.
        </p>
        <p>Pages you have opened before still work. Go back, or try again when you have signal.</p>
        <p>
          <a href="/open">Open my home page</a>
        </p>
      </div>
    </main>
  );
}

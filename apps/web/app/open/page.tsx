'use client';

import { useEffect, useState } from 'react';

import { rememberHome, lastHome } from '@/lib/pwa/home';

/**
 * WHERE THE INSTALLED APP OPENS (2026-10-10, PWA step 1).
 *
 * The manifest's start_url. One app serves every role, so this page sends each
 * person to their own home: a farmer to their dashboard, an extension officer
 * to the field desk, other staff to the dashboard, a buyer to the buyer side,
 * and anyone signed out to the join page. With no signal it opens the last home
 * used on this phone, which the service worker has kept.
 */
export default function OpenApp() {
  const [note, setNote] = useState('Opening AgriOne…');

  useEffect(() => {
    let on = true;
    const go = (path: string) => {
      if (!on) return;
      rememberHome(path);
      window.location.replace(path);
    };
    void (async () => {
      if (!navigator.onLine) {
        setNote('No signal: opening the last page you used.');
        window.location.replace(lastHome() ?? '/farmer/account');
        return;
      }
      try {
        const farmer = await fetch('/api/farmer/me', { cache: 'no-store' });
        if (farmer.ok) return go('/farmer/account');
        const me = await fetch('/api/me', { cache: 'no-store' });
        if (me.ok) {
          const body = (await me.json().catch(() => ({}))) as { data?: { role?: string } };
          const role = body.data?.role;
          if (role === 'officer') return go('/desk');
          if (role === 'buyer') return go('/buyer/dashboard');
          return go('/dashboard');
        }
        go('/join');
      } catch {
        // The network dropped between the check and the call.
        window.location.replace(lastHome() ?? '/join');
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1rem' }}>
      <p>{note}</p>
    </main>
  );
}

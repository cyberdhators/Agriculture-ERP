'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { usePreview } from '@/lib/preview';

import { Wordmark } from '../brand/Wordmark';
import { ToastProvider } from '../ui/feedback';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './shell.module.css';

/**
 * THE STAFF SHELL: a standing rail, a quiet header, one content well.
 *
 * It replaces a row of text tabs in a dark masthead. The reason is not taste.
 * A national administrator's remit is eleven destinations across six groups,
 * and a row of tabs can only show them by hiding the grouping — so the reader
 * had to already know what the platform could do in order to find it. A rail
 * shows the whole remit at once, grouped and labelled, which is the
 * specification's "discoverability over density" in one component.
 *
 * "The Register" is unchanged underneath: same tokens, same type, same 2px
 * controls, same hairline structure. This is a rearrangement, not a reskin.
 *
 * ONE SHELL, FOUR ROLES. Nothing here is administrator-specific. What each
 * person sees comes from lib/portal/nav.ts, which copies its role lists from
 * the routes themselves, and the server re-checks every one of them anyway.
 */

const COLLAPSE_KEY = 'agrione.rail.collapsed';

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, me, authError, signOut } = usePreview();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Read the stored preference after mount: reading it during render would
  // make the server's HTML and the browser's first paint disagree.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // A browser refusing storage is not a reason to fail to render a menu.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Preference not kept; the menu still works for this session.
      }
      return next;
    });
  }, []);

  // The drawer is a per-page affordance on a narrow screen: navigating closes it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes the drawer, the way every other dismissible layer behaves.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    // The toast region lives at the shell so any screen can report the outcome
    // of a write without mounting its own. It is a polite live region: the
    // outcome is announced without taking focus off what the reader was doing.
    <ToastProvider>
      <div className={styles.shell}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <Sidebar
          role={role}
          pathname={pathname}
          name={me?.name ?? (authError ? 'Account not loaded' : '…')}
          collapsed={collapsed}
          open={drawerOpen}
          onToggleCollapsed={toggleCollapsed}
          onSignOut={() => void signOut()}
        />

        {drawerOpen ? (
          <button
            type="button"
            className={styles.scrimOpen}
            aria-label="Close the menu"
            onClick={() => setDrawerOpen(false)}
          />
        ) : (
          <span className={styles.scrim} />
        )}

        <div className={styles.main}>
          <TopBar pathname={pathname} role={role} onOpenMenu={() => setDrawerOpen(true)} />

          <main id="main" className={styles.content} tabIndex={-1}>
            {children}
          </main>

          <footer className={`${styles.footer} no-print`}>
            <Wordmark size={16} />
            <span>© {new Date().getFullYear()} AgriOne South Sudan · CORWADO</span>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}

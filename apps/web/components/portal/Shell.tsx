'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ROLE_LABELS, usePreview } from '@/lib/preview';

import { Wordmark } from '../brand/Wordmark';
import { IconSearch } from '../ui/icons';
import styles from './portal.module.css';

/**
 * The staff masthead. A forest band carries the AgriOne wordmark, the primary
 * navigation as plain text tabs and a global search field. There is no
 * sidebar: this is a register, read across, not an admin console. The
 * role-preview select is design tooling — it renders only when the page is
 * opened with `?preview`, never in the product chrome.
 */

// Only the screens that exist today. Cooperatives (C-12), Marketplace (phase 5)
// and Reports (phase 7) rejoin the nav when their screens are built; a nav item
// with no route behind it is a 404, so it does not ship early.
const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/farmers', label: 'Farmers' },
  { href: '/desk', label: 'Field desk' },
  { href: '/visits', label: 'Visits' },
  { href: '/directories', label: 'Directories' },
  { href: '/library', label: 'Library' },
  { href: '/reports', label: 'Reports' },
  { href: '/admin', label: 'Administration' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, me, authError, signOut } = usePreview();
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // The mobile menu is a per-page affordance: close it on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // "/" and ⌘K focus the register search, the way a working tool is driven
  // from the keyboard. Ignored while typing in another field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (
        (event.key === '/' && !typing) ||
        (event.key === 'k' && (event.metaKey || event.ctrlKey))
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={`${styles.masthead} no-print`}>
        <div className={styles.mastheadInner}>
          <div className={styles.wordmark}>
            <Wordmark size={22} tagline onBand href="/dashboard" />
          </div>

          <button
            type="button"
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-controls="portal-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              {menuOpen ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>

          <form
            className={styles.search}
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const q = searchRef.current?.value.trim() ?? '';
              router.push(q ? `/farmers?q=${encodeURIComponent(q)}` : '/farmers');
            }}
          >
            <span className={styles.searchIcon} aria-hidden>
              <IconSearch size={18} />
            </span>
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder="Search the register: farmers, cooperatives, directories"
              aria-label="Search the register by name, phone or number"
            />
            <button type="submit" className={styles.searchBtn} aria-label="Search the register">
              <IconSearch size={18} />
            </button>
          </form>

          <nav
            id="portal-nav"
            className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}
            aria-label="Primary"
          >
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.navTab}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={`${styles.roleSwitch} ${menuOpen ? styles.roleSwitchOpen : ''}`}>
            <span className={styles.who} dir="auto" title={authError}>
              {me?.name ?? (authError ? 'Account not loaded' : '…')}
            </span>
            <span className={styles.roleSwitchLabel}>{ROLE_LABELS[role]}</span>
            <button type="button" className={styles.signOut} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="main" className={styles.content} tabIndex={-1}>
        {children}
      </main>

      <footer className={`${styles.footer} no-print`}>
        <Wordmark size={18} tagline />
        <span>© {new Date().getFullYear()} AgriOne South Sudan</span>
      </footer>
    </div>
  );
}

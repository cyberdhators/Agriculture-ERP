'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ROLES, ROLE_LABELS, usePreview, type Role } from '@/lib/preview';

import { IconSearch } from '../ui/icons';
import styles from './portal.module.css';

/**
 * The masthead. A dark band carries the wordmark, the primary navigation as
 * plain text tabs, a global search field, and the role-preview select. There
 * is no sidebar: this is a register, read across, not an admin console.
 */

const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/farmers', label: 'Farmers' },
  { href: '/cooperatives', label: 'Cooperatives' },
  { href: '/directories', label: 'Directories' },
  { href: '/market', label: 'Market' },
  { href: '/library', label: 'Library' },
  { href: '/reports', label: 'Reports' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, setRole } = usePreview();
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
          <Link href="/dashboard" className={styles.wordmark}>
            <span className={styles.wordmarkOrg}>CORWADO</span>
            <span className={styles.wordmarkRule} aria-hidden />
            <span className={styles.wordmarkName}>Agricultural Register</span>
          </Link>

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

          <form
            className={styles.search}
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const q = searchRef.current?.value.trim() ?? '';
              router.push(q ? `/farmers?q=${encodeURIComponent(q)}` : '/farmers');
            }}
          >
            <IconSearch size={16} />
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder="Search the register"
              aria-label="Search the register by name, phone or number"
            />
            <kbd className={styles.searchKbd} aria-hidden>
              /
            </kbd>
          </form>

          {/*
            PREVIEW ONLY. Switches which role the screens render for, so a
            reviewer can see what each role sees without four accounts. It
            grants nothing: there is no API behind these screens yet, and when
            there is, every route enforces the real role with requireRole (B3).
            Remove this control when Supabase Auth is wired in.
          */}
          <div className={`${styles.roleSwitch} ${menuOpen ? styles.roleSwitchOpen : ''}`}>
            <label htmlFor="role-preview" className={styles.roleSwitchLabel}>
              Preview as
            </label>
            <select
              id="role-preview"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main id="main" className={styles.content} tabIndex={-1}>
        {children}
      </main>

      <footer className={`${styles.footer} no-print`}>
        <span className={styles.footerFlag}>
          <span aria-hidden>●</span> Preview build — fixture data, nothing is saved
        </span>
        <span>LAST Project · CORWADO · Central Equatoria</span>
      </footer>
    </div>
  );
}

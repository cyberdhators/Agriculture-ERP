'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ROLES, ROLE_LABELS, usePreview, type Role } from '@/lib/preview';

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

const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/farmers', label: 'Farmers' },
  { href: '/cooperatives', label: 'Cooperatives' },
  { href: '/directories', label: 'Directories' },
  { href: '/market', label: 'Marketplace' },
  { href: '/library', label: 'Library' },
  { href: '/reports', label: 'Reports' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, setRole } = usePreview();
  const searchRef = useRef<HTMLInputElement>(null);
  const [previewTools, setPreviewTools] = useState(false);

  useEffect(() => {
    setPreviewTools(new URLSearchParams(window.location.search).has('preview'));
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

          <nav className={styles.nav} aria-label="Primary">
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
            Design tooling only, shown with `?preview` in the address. Switches
            which role the screens render for, so a reviewer can see what each
            role sees without four accounts. It grants nothing: every route
            enforces the real role with requireRole (B3).
          */}
          {previewTools ? (
            <div className={styles.roleSwitch}>
              <label htmlFor="role-preview" className={styles.roleSwitchLabel}>
                Role
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
          ) : null}
        </div>
      </header>

      <main id="main" className={styles.content} tabIndex={-1}>
        {children}
      </main>

      <footer className={`${styles.footer} no-print`}>
        <Wordmark size={18} tagline />
        <span>© {new Date().getFullYear()} AgriOne</span>
      </footer>
    </div>
  );
}

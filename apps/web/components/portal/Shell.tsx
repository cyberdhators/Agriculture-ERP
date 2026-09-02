'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { ROLES, ROLE_LABELS, usePreview, type Role } from '@/lib/preview';

import { Avatar } from '../ui';
import { IconDashboard, IconDirectory, IconFarmers, IconLibrary, IconPalette } from '../ui/icons';
import styles from './portal.module.css';

/**
 * The portal shell: wordmark, primary navigation, top bar, content, footer.
 *
 * Navigation follows the web design document's sidebar (Dashboard, Farmers,
 * Verification, Cooperatives, Officers, Reports) with the two P1 sections
 * added. Sections that belong to other units are present as placeholders so
 * the shape of the finished portal is visible; they are marked as such.
 */

const NAV: ReadonlyArray<{
  href: string;
  label: string;
  icon: ReactNode;
  placeholder?: boolean;
}> = [
  { href: '/dashboard', label: 'Dashboard', icon: <IconDashboard />, placeholder: true },
  { href: '/farmers', label: 'Farmers', icon: <IconFarmers />, placeholder: true },
  { href: '/directories', label: 'Directories', icon: <IconDirectory /> },
  { href: '/library', label: 'Learning library', icon: <IconLibrary /> },
];

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/farmers': 'Farmers',
  '/directories': 'Directories',
  '/library': 'Learning library',
  '/design': 'Design system',
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, setRole, hydrated } = usePreview();
  const section = Object.keys(TITLES).find((key) => pathname.startsWith(key));

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className={styles.sidebar}>
        <Link
          href="/directories"
          className={styles.wordmark}
          aria-label="Agri, LAST Project, CORWADO"
        >
          <span className={styles.wordmarkTile} aria-hidden>
            A
          </span>
          <span className={styles.wordmarkText}>
            <span className={styles.wordmarkName}>Agri</span>
            <span className={styles.wordmarkSub}>LAST Project · CORWADO</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navLink}
                aria-current={active ? 'page' : undefined}
              >
                {item.icon}
                {item.label}
                {item.placeholder ? <span className={styles.navBadge}>soon</span> : null}
              </Link>
            );
          })}
          <p className={`${styles.navGroup} label`}>Reference</p>
          <Link
            href="/design"
            className={styles.navLink}
            aria-current={pathname.startsWith('/design') ? 'page' : undefined}
          >
            <IconPalette />
            Design system
          </Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.user}>
            <Avatar text="NA" tone="leaf" />
            <span className={styles.userText}>
              <span className={styles.userName}>Preview user</span>
              <span className="small muted">
                {hydrated ? ROLE_LABELS[role] : ROLE_LABELS.admin}
              </span>
            </span>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={`${styles.topbar} no-print`}>
          <p className={styles.topbarTitle}>
            CORWADO Agriculture ERP{section ? ` · ${TITLES[section]}` : ''}
          </p>
          <div className={styles.topbarRight}>
            {/*
              PREVIEW ONLY. Switches which role the screens render for, so a
              reviewer can see what an officer sees without four accounts. It
              grants nothing: there is no API behind these screens yet, and when
              there is, every route enforces the real role with requireRole.
              Remove this control when Supabase Auth is wired in (B3).
            */}
            <div className={styles.roleSwitch}>
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
    </div>
  );
}

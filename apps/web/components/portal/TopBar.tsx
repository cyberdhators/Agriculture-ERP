'use client';

import { pageTitleFor } from '@/lib/portal/nav';
import { type Role } from '@/lib/preview';

import { IconMenu } from '../ui/icons';
import { Breadcrumbs } from './Breadcrumbs';
import styles from './shell.module.css';

/**
 * The header: where you are on one side, what you may see on the other.
 *
 * WHAT IS DELIBERATELY ABSENT.
 *
 * A global search box. No route can answer it. `farmerFilterSchema` accepts a
 * status, a payam, a county, a sex, a date range and a duplicate flag — and
 * no free text, no name, no phone, no farmer number. A search field in the
 * chrome of every page would promise the one thing the register cannot yet
 * do, and the reader would read an empty result as "no such farmer" rather
 * than "not implemented". The Farmers screen keeps its own filter, which is
 * honest about filtering the page it has already loaded.
 *
 * A notification bell and a language selector, for the same reason: neither
 * has anything behind it yet, and the Arabi Juba script question is still
 * open in the scope document.
 *
 * What IS here instead is the scope chip: the reach the server granted this
 * caller, in words. An administrator who cannot tell whether they are seeing
 * one state or ten is the reporting failure this platform exists to avoid.
 */

const SCOPE_NOTE: Record<Role, string> = {
  admin: 'National scope · all states',
  supervisor: 'Your assigned state',
  read_only: 'Your assigned state · read only',
  officer: 'Your caseload',
};

export interface TopBarProps {
  pathname: string;
  role: Role;
  onOpenMenu: () => void;
}

export function TopBar({ pathname, role, onOpenMenu }: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.menuToggle}
        onClick={onOpenMenu}
        aria-controls="portal-rail"
        aria-label="Open the menu"
      >
        <IconMenu size={20} />
      </button>

      <div className={styles.topbarText}>
        <Breadcrumbs pathname={pathname} />
        {/*
         * A span, not an <h1>. Every screen already renders its own <h1>
         * through PageHeader, and two first-level headings on one page make a
         * screen reader's document outline lie about which one is the page.
         * When the individual screens are redesigned, this becomes the single
         * <h1> and PageHeader drops to the subtitle-and-actions row it really
         * is; until then the page keeps the heading and this keeps the look.
         */}
        <span className={styles.pageTitle}>{pageTitleFor(pathname)}</span>
      </div>

      <div className={styles.topbarSide}>
        <span className={styles.scopeChip} title="What the server lets this account see">
          {SCOPE_NOTE[role]}
        </span>
      </div>
    </header>
  );
}

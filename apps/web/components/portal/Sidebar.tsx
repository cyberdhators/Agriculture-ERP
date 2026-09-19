'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { navFor, activeHref, type IconKey } from '@/lib/portal/nav';
import { getUnreadReportCount } from '@/lib/product-reports/api';
import { ROLE_LABELS, type Role } from '@/lib/preview';

import { Wordmark } from '../brand/Wordmark';
import {
  IconAudit,
  IconDashboard,
  IconDesk,
  IconDirectory,
  IconExport,
  IconFarmers,
  IconFlag,
  IconLibrary,
  IconMail,
  IconMap,
  IconOfficer,
  IconReports,
  IconSidebarCollapse,
  IconSignOut,
  IconStaff,
  IconVisits,
} from '../ui/icons';
import styles from './shell.module.css';

/**
 * The standing rail.
 *
 * WHAT IT SHOWS IS DECIDED IN lib/portal/nav.ts, NOT HERE. This file renders
 * a list; it does not know who may see what. That separation is the point:
 * the permission question is answered in a pure module with a test that
 * asserts both directions, and a component cannot quietly widen it.
 *
 * The role in the foot is the role the SERVER reported from GET /api/me. It is
 * never hard-coded, because this shell is the same shell a supervisor, a
 * read-only user and an officer sign in to.
 */

const ICONS: Record<IconKey, (p: { size?: number }) => ReactNode> = {
  dashboard: IconDashboard,
  farmers: IconFarmers,
  map: IconMap,
  visits: IconVisits,
  desk: IconDesk,
  officer: IconOfficer,
  staff: IconStaff,
  reports: IconReports,
  export: IconExport,
  mail: IconMail,
  flag: IconFlag,
  directory: IconDirectory,
  library: IconLibrary,
  audit: IconAudit,
};

export interface SidebarProps {
  role: Role;
  pathname: string;
  name: string;
  collapsed: boolean;
  open: boolean;
  onToggleCollapsed: () => void;
  onSignOut: () => void;
}

export function Sidebar({
  role,
  pathname,
  name,
  collapsed,
  open,
  onToggleCollapsed,
  onSignOut,
}: SidebarProps) {
  const sections = navFor(role);
  const active = activeHref(pathname, role);

  /**
   * THE PRODUCT-REPORTS BADGE, AND ITS ONLY PERMITTED SOURCE.
   *
   * `GET /api/admin/product-reports/unread-count` counts live reports still in
   * the `new` state, in the database. It is never derived from a loaded page,
   * never from browser storage, and never defaulted: `null` means the count is
   * not known, and NO BADGE IS DRAWN. A zero badge would claim nothing has been
   * reported when the truth may be that nobody could look.
   */
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    if (role !== 'admin') return;
    let live = true;
    getUnreadReportCount()
      .then((count) => live && setUnread(count.unread))
      .catch(() => live && setUnread(null));
    return () => {
      live = false;
    };
  }, [role, pathname]);

  return (
    <nav
      id="portal-rail"
      aria-label="Primary"
      className={[styles.rail, collapsed ? styles.railCollapsed : '', open ? styles.railOpen : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.railHead}>
        {collapsed ? null : (
          <span className={styles.railWordmark}>
            <Wordmark size={20} onBand href="/dashboard" />
          </span>
        )}
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="portal-rail"
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
        >
          <IconSidebarCollapse size={18} />
          <span className="visually-hidden">
            {collapsed ? 'Expand the menu' : 'Collapse the menu'}
          </span>
        </button>
      </div>

      <div className={styles.railNav}>
        {sections.map((section, index) => (
          <div key={section.heading}>
            {index > 0 ? <hr className={styles.sectionRule} /> : null}
            <h2 className={styles.sectionHeading}>{section.heading}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const isActive = active !== null && item.href.split('#')[0] === active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className={styles.itemIcon}>
                        <Icon size={19} />
                      </span>
                      <span className={styles.itemLabel}>{item.label}</span>
                      {item.href === '/product-reports' && unread !== null && unread > 0 ? (
                        <span className={styles.badge} aria-label={`${unread} new`}>
                          {unread}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={styles.railFoot}>
        {collapsed ? null : (
          <>
            <span className={styles.whoName} dir="auto">
              {name}
            </span>
            <span className={styles.whoRole}>{ROLE_LABELS[role]}</span>
          </>
        )}
        <button type="button" className={styles.signOut} onClick={onSignOut}>
          <IconSignOut size={16} />
          {collapsed ? <span className="visually-hidden">Sign out</span> : <span>Sign out</span>}
        </button>
      </div>
    </nav>
  );
}

import Link from 'next/link';

import { crumbsFor } from '@/lib/portal/nav';

import styles from './shell.module.css';

/**
 * Where you are, and the way back. Built from the path in lib/portal/nav.ts,
 * which also decides that a record identifier is never printed here.
 *
 * The separator is a character rather than an icon so it inherits the
 * direction of the text around it; the stylesheet turns it for RTL.
 */
export function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = crumbsFor(pathname);
  if (crumbs.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className={styles.crumbs}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className={styles.crumb}>
              {crumb.href && !last ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span className={styles.crumbCurrent} aria-current={last ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
              {last ? null : (
                <span className={styles.crumbSep} aria-hidden>
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

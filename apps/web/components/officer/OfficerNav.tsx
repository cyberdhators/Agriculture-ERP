'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { IconFarmers, IconVisits, IconDesk, IconLibrary } from '@/components/ui/icons';

import styles from './officer-nav.module.css';

/**
 * THE OFFICER'S NAVIGATION, FOR A PHONE HELD IN ONE HAND.
 *
 * Not the administrator's sidebar made narrow. A sidebar assumes a pointer and
 * a lot of vertical space; an officer is standing in a field, in sunlight,
 * holding a phone, and the thing they need is reachable by one thumb at the
 * bottom of the screen. Four destinations, because a fifth is a menu nobody
 * reads, and the labels are one word each.
 *
 * WHY THESE FOUR AND NOT THE OBVIOUS FOUR. The brief asks for Home, Farmers,
 * Visits and Farms. **Farms is not here, and that is not an omission.** The
 * farms screen cannot render without `GET /api/farms/geojson`, which accepts
 * administrators and supervisors only -- it is the one route that serves
 * boundary coordinates across farms. Putting Farms here would offer an officer
 * a door that answers 403, which is the exact failure
 * `nav-roles-match-routes.test.ts` exists to prevent. An officer reaches the
 * farms they mapped through the farmer who owns them, which is also how the
 * work actually goes. The contract that would change this is named in the
 * report.
 *
 * Every destination below is a screen that exists and a route this role may
 * call. Nothing is offered that the server would refuse.
 */
const ITEMS = [
  { href: '/desk', label: 'Home', Icon: IconDesk },
  { href: '/farmers', label: 'Farmers', Icon: IconFarmers },
  { href: '/visits', label: 'Visits', Icon: IconVisits },
  { href: '/library', label: 'Learning', Icon: IconLibrary },
] as const;

const isCurrent = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export function OfficerNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav className={styles.bar} aria-label="Officer navigation">
      <ul className={styles.list}>
        {ITEMS.map(({ href, label, Icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href} className={styles.item}>
              <Link
                href={href}
                className={`${styles.link} ${current ? styles.current : ''}`}
                aria-current={current ? 'page' : undefined}
              >
                <Icon size={24} />
                <span className={styles.label}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

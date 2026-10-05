import type { Role } from '@agri-erp/shared';

/**
 * THE PORTAL'S NAVIGATION, AS DATA.
 *
 * One model, read by the sidebar, the breadcrumbs and the page title, so the
 * three cannot disagree about what exists or who may see it. No React here:
 * it is plain data and three pure functions, which is why it can be tested
 * without a browser or a database.
 *
 * TWO RULES GOVERN EVERY ENTRY, AND NEITHER IS NEGOTIABLE.
 *
 * 1. A destination appears only if the SCREEN EXISTS. A nav item with no page
 *    behind it is a 404 wearing a label, and the reader cannot tell the
 *    difference between "not built" and "broken". Every entry below has a page
 *    under app/(portal); nothing is listed ahead of its screen.
 *
 * 2. A destination appears only for the ROLES THE ROUTES BEHIND IT ACCEPT.
 *    `roles` on each item below is copied from the `roles:` declaration of the
 *    route the screen cannot render without — not from what feels reasonable.
 *    The server is still the authority: this only decides what is offered, and
 *    every route re-checks. Showing a supervisor a door that answers 403 is
 *    the failure this exists to prevent.
 */

export type IconKey =
  | 'dashboard'
  | 'farmers'
  | 'map'
  | 'mail'
  | 'flag'
  | 'visits'
  | 'desk'
  | 'officer'
  | 'staff'
  | 'reports'
  | 'export'
  | 'directory'
  | 'library'
  | 'audit';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconKey;
  /** Exactly the roles the routes behind this screen accept. */
  readonly roles: readonly Role[];
  /**
   * The route this screen cannot render without, as `METHOD /api/path`.
   *
   * NOT PROSE, BECAUSE A GATE HAS TO READ IT. `because` explains the decision
   * to a person; this is the machine-checkable half. `nav-roles-match-routes`
   * opens the file this names, reads its `roles:` declaration, and fails if it
   * disagrees with `roles` above -- and fails just as loudly if the route
   * named here does not exist, because a mapping that can name nothing is a
   * mapping that can quietly check nothing.
   */
  readonly route: string;
  /** Why these roles, naming the route. Read by nav.test.ts and by the next reader. */
  readonly because: string;
}

export interface NavSection {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

const ALL: readonly Role[] = ['admin', 'supervisor', 'read_only', 'officer'];
/** The three staff roles that hold a state or the nation; an officer holds a caseload. */
const STAFF: readonly Role[] = ['admin', 'supervisor', 'read_only'];

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    heading: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        route: 'GET /api/reports/summary',
        roles: ALL,
        because: 'GET /api/reports/summary accepts every role; the server scopes the figures.',
      },
    ],
  },
  {
    heading: 'Field operations',
    items: [
      {
        href: '/farmers',
        label: 'Farmers',
        icon: 'farmers',
        route: 'GET /api/farmers',
        roles: ALL,
        because: 'GET /api/farmers accepts every role.',
      },
      {
        href: '/farms',
        label: 'Farms & maps',
        icon: 'map',
        route: 'GET /api/farms/geojson',
        roles: ['admin', 'supervisor'],
        because:
          'GET /api/farms/geojson is admin and supervisor only — it is the one route that ' +
          'serves boundary coordinates across farms, and the screen cannot render without it.',
      },
      {
        href: '/visits',
        label: 'Visits',
        icon: 'visits',
        route: 'GET /api/visits',
        roles: ALL,
        because: 'GET /api/visits accepts every role.',
      },
      {
        href: '/desk',
        label: 'Field desk',
        icon: 'desk',
        route: 'GET /api/sync/caseload',
        roles: ['officer'],
        because:
          'GET /api/sync/caseload is officer-only. Without this an officer has no home in the nav.',
      },
      {
        href: '/admin/users#officers',
        label: 'Extension officers',
        icon: 'officer',
        route: 'GET /api/users',
        roles: STAFF,
        because:
          'The officers table shares a screen with staff accounts, and that screen also reads ' +
          'GET /api/users, which refuses an officer. GET /api/officers alone would allow all four.',
      },
    ],
  },
  {
    heading: 'People & access',
    items: [
      {
        href: '/admin/users',
        label: 'Staff accounts',
        icon: 'staff',
        route: 'GET /api/users',
        roles: STAFF,
        because: 'GET /api/users accepts admin, supervisor and read_only. Writes are admin-only.',
      },
    ],
  },
  {
    heading: 'Communications',
    items: [
      {
        href: '/communications',
        label: 'Communications',
        icon: 'mail',
        route: 'POST /api/admin/communications',
        roles: ['admin'],
        because:
          'POST /api/admin/communications is administrator-only. Email reaches staff accounts ' +
          'only, because no farmer or officer record holds an email address.',
      },
    ],
  },
  {
    heading: 'Reporting',
    items: [
      {
        href: '/reports',
        label: 'Reports',
        icon: 'reports',
        route: 'GET /api/reports/summary',
        roles: ALL,
        because: 'GET /api/reports/summary accepts every role.',
      },
      {
        href: '/reports#exports',
        label: 'Exports',
        icon: 'export',
        route: 'GET /api/reports/exports',
        roles: ['admin', 'supervisor'],
        because: 'GET and POST /api/reports/exports accept admin and supervisor only.',
      },
    ],
  },
  {
    heading: 'Reference',
    items: [
      /*
       * DIRECTORIES IS DELIBERATELY ABSENT FROM THIS NAVIGATION.
       *
       * The owner decided the directory module is not part of the redesigned
       * administrator experience. Only the DESTINATION is withdrawn: the
       * route, its screens, its API and its data are untouched and still
       * reachable by URL, so nothing is destroyed and the decision is one line
       * to reverse. `IconDirectory` is likewise kept — the icon map still
       * names it — so restoring the entry needs no archaeology.
       *
       * The portal gate's three lists are unaffected: `/directories` remains a
       * screen on disk, remains in PORTAL_PREFIXES and remains in the
       * middleware matcher, which is what keeps it behind the staff session.
       * A navigation entry and a gated prefix are different things, and this
       * removes only the first.
       */
      {
        href: '/library',
        label: 'Learning library',
        icon: 'library',
        route: 'GET /api/learning-resources',
        roles: ALL,
        because: 'GET /api/learning-resources accepts every role; writing is admin-only.',
      },
    ],
  },
  {
    heading: 'Governance',
    items: [
      {
        href: '/admin/audit',
        label: 'Audit trail',
        icon: 'audit',
        route: 'GET /api/audit',
        roles: ['admin'],
        because: 'GET /api/audit is admin-only (C-4.8).',
      },
      {
        // NOT the agricultural "Reports" module, which is deliverable (t).
        // This is marketplace moderation, and the two are kept apart in name
        // and in section so nobody has to guess which is which.
        href: '/product-reports',
        label: 'Product reports',
        icon: 'flag',
        route: 'GET /api/admin/product-reports',
        roles: ['admin'],
        because:
          'GET /api/admin/product-reports is administrator-only, and so are the detail and the ' +
          'unread count the queue reads beside it.',
      },
    ],
  },
];

/** The sections this role may see, with the items it may not removed and empty sections dropped. */
export function navFor(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    heading: section.heading,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Every destination, flattened — for the breadcrumb and title lookups. */
export const ALL_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

const pathOf = (href: string): string => href.split('#')[0] ?? href;

/**
 * Whether a nav item is the one the reader is looking at.
 *
 * Longest match wins, so `/admin/users` does not light up while the reader is
 * on `/admin/audit`, and a hash-only destination never steals the highlight
 * from the page it lives on.
 */
export function activeHref(pathname: string, role: Role): string | null {
  const candidates = navFor(role)
    .flatMap((s) => s.items)
    .map((i) => pathOf(i.href))
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (p.length > best.length ? p : best));
}

export interface Crumb {
  readonly label: string;
  /** Absent on the last crumb: the page you are on is not a link to itself. */
  readonly href?: string;
}

/** Labels for path segments that are not nav destinations of their own. */
const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Administration',
  users: 'Staff accounts',
  audit: 'Audit trail',
  farmers: 'Farmers',
  farms: 'Farms & maps',
  communications: 'Communications',
  'product-reports': 'Product reports',
  visits: 'Visits',
  reports: 'Reports',
  directories: 'Directories',
  library: 'Learning library',
  desk: 'Field desk',
  dashboard: 'Dashboard',
  design: 'Design system',
  new: 'New',
  edit: 'Edit',
  review: 'Review queue',
};

const titleCase = (segment: string): string =>
  segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

/**
 * Breadcrumbs from the path, with Dashboard as the root of everything else.
 *
 * A segment that looks like a record id — a UUID, or anything with a digit —
 * is rendered as "Record" rather than printed. A farmer's identifier in the
 * chrome of every page is personal data travelling further than it needs to,
 * and the page itself already names the record properly.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0 || segments[0] === 'dashboard') {
    return [{ label: 'Dashboard' }];
  }
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/dashboard' }];
  let href = '';
  segments.forEach((segment, index) => {
    href += `/${segment}`;
    const looksLikeId = /\d/.test(segment) || segment.length > 24;
    const label = looksLikeId ? 'Record' : (SEGMENT_LABELS[segment] ?? titleCase(segment));
    crumbs.push(index === segments.length - 1 ? { label } : { label, href });
  });
  return crumbs;
}

/** The page title in the header: the last crumb, which is the page you are on. */
export function pageTitleFor(pathname: string): string {
  const crumbs = crumbsFor(pathname);
  return crumbs[crumbs.length - 1]?.label ?? 'Dashboard';
}

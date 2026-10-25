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
  | 'audit'
  | 'settings';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconKey;
  /** Exactly the roles the routes behind this screen accept. */
  readonly roles: readonly Role[];
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

/*
 * THE TEN TABS OF CORWADO'S ADMIN PORTAL (2026-10-19; the owner: "reorganize
 * the menu into the ten tabs"), from the specification of 16 October 2026:
 * Overview, Users and organizations, Marketplace, Advice and learning,
 * Reports and support, Communications, Analytics and exports, Staff and
 * permissions, Access and audit logs, Settings.
 *
 * Every screen that was here stays: the farmer register, farms, visits and the
 * field desk are contracted deliverables (c) and (d), so they move under the
 * tab they belong to rather than leave. SETTINGS joined on 2026-10-25, when
 * its screen (/admin/settings, phase 1) existed -- rule 1 above: a tab with no
 * page behind it is a 404 wearing a label.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    heading: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        roles: ALL,
        because:
          'Every role has a dashboard. For staff it reads GET /api/admin/overview (admin, ' +
          'supervisor and read_only, then reports.view, scoped by state); an officer keeps the ' +
          'caseload overview from GET /api/reports/summary, which accepts every role.',
      },
    ],
  },
  {
    heading: 'Users and organizations',
    items: [
      {
        // 2026-10-28: every account in one list, and each account's page.
        href: '/admin/accounts',
        label: 'All accounts',
        icon: 'staff',
        roles: ['admin'],
        because:
          'GET /api/admin/accounts and GET /api/admin/accounts/:kind/:id are administrator-only ' +
          'and then require support.handle or content.moderate; revealing a contact requires ' +
          'support.handle, disabling content.moderate, re-enabling superadmin.grant.',
      },
      {
        href: '/farmers',
        label: 'Farmers',
        icon: 'farmers',
        roles: ALL,
        because: 'GET /api/farmers accepts every role.',
      },
      /*
       * FARMS & MAPS IS HIDDEN FROM THIS NAVIGATION (the owner, 2026-10-19:
       * "keep farm and map invisible") until GIS mapping is finished. Only
       * the destination is withdrawn: /farms, its routes and its data are
       * untouched and reachable by URL; restoring the entry is one block.
       */
      {
        href: '/admin/users#officers',
        label: 'Extension officers',
        icon: 'officer',
        roles: STAFF,
        because:
          'The officers table shares a screen with staff accounts, and that screen also reads ' +
          'GET /api/users, which refuses an officer. GET /api/officers alone would allow all four.',
      },
      {
        href: '/admin/buyers',
        label: 'Buyer accounts',
        icon: 'staff',
        roles: ['admin'],
        because:
          'GET and PATCH /api/admin/buyers are administrator-only (B13, C-14B.3): only an ' +
          'administrator verifies, rejects or suspends a buyer organisation.',
      },
    ],
  },
  {
    heading: 'Marketplace',
    items: [
      {
        // 2026-10-28: the marketplace console.
        href: '/admin/marketplace',
        label: 'Marketplace console',
        icon: 'directory',
        roles: ['admin'],
        because:
          'GET /api/admin/marketplace, its inspect and removed routes and POST ' +
          '/api/admin/marketplace/:kind/:id/remove are administrator-only and then require ' +
          'content.moderate.',
      },
      {
        // 2026-10-19: the live marketplace, where staff withdraw a listing with
        // a reason (the moderate panel on each product page).
        href: '/market',
        label: 'Live marketplace',
        icon: 'directory',
        roles: ['admin', 'supervisor'],
        because:
          'POST /api/listings/:id/withdraw accepts admin and supervisor (a supervisor in the ' +
          "listing's state); the page itself is public.",
      },
      {
        href: '/admin/procurement',
        label: 'Buyer requests',
        icon: 'desk',
        roles: ['admin'],
        because:
          '/api/admin/purchase-requests and /api/admin/orders are administrator-only (B13): ' +
          'CORWADO decides requests and arranges orders against listings.',
      },
    ],
  },
  {
    heading: 'Advice and learning',
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
        href: '/visits',
        label: 'Visits',
        icon: 'visits',
        roles: ALL,
        because: 'GET /api/visits accepts every role.',
      },
      {
        href: '/desk',
        label: 'Field desk',
        icon: 'desk',
        roles: ['officer'],
        because:
          'GET /api/sync/caseload is officer-only. Without this an officer has no home in the nav.',
      },
      {
        href: '/library',
        label: 'Learning library',
        icon: 'library',
        roles: ALL,
        because: 'GET /api/learning-resources accepts every role; writing is admin-only.',
      },
      {
        // 2026-10-24: the optional approved-adviser pathway.
        href: '/admin/advisers',
        label: 'Approved advisers',
        icon: 'staff',
        roles: ['admin'],
        because:
          'GET /api/admin/advisers and POST /api/admin/advisers/:id/decision are ' +
          'administrator-only and then require content.moderate.',
      },
    ],
  },
  {
    heading: 'Reports and support',
    items: [
      {
        // NOT the agricultural "Reports" module, which is deliverable (t).
        // This is marketplace moderation, and the two are kept apart in name
        // and in section so nobody has to guess which is which.
        href: '/product-reports',
        label: 'Product reports',
        icon: 'flag',
        roles: ['admin'],
        because:
          'GET /api/admin/product-reports is administrator-only, and so are the detail and the ' +
          'unread count the queue reads beside it.',
      },
      {
        // 2026-10-21: "Contact CORWADO" messages from the help page; support
        // cases since 2026-10-28 (the specification's line 103).
        href: '/admin/support',
        label: 'Support cases',
        icon: 'mail',
        roles: ['admin'],
        because:
          'GET /api/admin/support, GET and PATCH /api/admin/support/:id and POST ' +
          '/api/admin/support/:id/entries are administrator-only and then require ' +
          'support.handle, which every administrator holds.',
      },
      {
        // 2026-10-27: organisational profiles, their teams, exceptional recovery.
        href: '/admin/organizations',
        label: 'Organisations',
        icon: 'staff',
        roles: ['admin'],
        because:
          'GET /api/admin/organizations and POST /api/admin/organizations/:id/recover are ' +
          'administrator-only and then require support.handle.',
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
        roles: ['admin'],
        because:
          'POST /api/admin/communications is administrator-only. Email reaches staff accounts ' +
          'only, because no farmer or officer record holds an email address.',
      },
    ],
  },
  {
    heading: 'Analytics and exports',
    items: [
      {
        href: '/reports',
        label: 'Reports',
        icon: 'reports',
        roles: ALL,
        because: 'GET /api/reports/summary accepts every role.',
      },
      {
        href: '/reports#exports',
        label: 'Exports',
        icon: 'export',
        roles: ['admin', 'supervisor'],
        because: 'GET and POST /api/reports/exports accept admin and supervisor only.',
      },
      {
        href: '/analytics',
        label: 'Marketplace analytics',
        icon: 'reports',
        roles: STAFF,
        because:
          'GET /api/analytics/summary accepts admin, supervisor and read_only, and then requires ' +
          'reports.view, which every administrator holds; other staff through the Analyst or ' +
          'Administrator preset. POST /api/analytics/export is admin and supervisor only.',
      },
    ],
  },
  {
    heading: 'Staff and permissions',
    items: [
      {
        href: '/admin/users',
        label: 'Staff accounts',
        icon: 'staff',
        roles: STAFF,
        because: 'GET /api/users accepts admin, supervisor and read_only. Writes are admin-only.',
      },
      {
        href: '/admin/staff-access',
        label: 'Staff permissions',
        icon: 'staff',
        roles: ['admin'],
        because:
          'GET /api/admin/staff-access requires staff.manage, which every administrator holds; ' +
          'other roles only through the Administrator preset.',
      },
      {
        // 2026-10-28: your own two-step sign-in. Every staff role may enrol;
        // administrators are required to (STAFF_MFA_ENFORCEMENT).
        href: '/admin/sign-in-security',
        label: 'Your sign-in security',
        icon: 'staff',
        roles: STAFF,
        because:
          'GET and POST /api/staff/mfa accept admin, supervisor and read_only, each for their own ' +
          'account only.',
      },
    ],
  },
  {
    heading: 'Access and audit logs',
    items: [
      {
        // 2026-10-19. The route admits all three staff roles and then asks for
        // `audit.view` platform-wide, which an administrator always holds and a
        // supervisor or read-only account holds only through a preset. The nav
        // offers it to administrators; a granted colleague reaches it by link.
        href: '/admin/access-logs',
        label: 'Access logs',
        icon: 'audit',
        roles: ['admin'],
        because:
          'GET /api/admin/access-logs requires audit.view across the platform, which every ' +
          'administrator holds; other roles only through a preset.',
      },
      {
        href: '/admin/audit',
        label: 'Audit trail',
        icon: 'audit',
        roles: ['admin'],
        because: 'GET /api/audit is admin-only (C-4.8).',
      },
    ],
  },
  {
    heading: 'Settings',
    items: [
      {
        // 2026-10-25: settings, phase 1.
        href: '/admin/settings',
        label: 'Settings',
        icon: 'settings',
        roles: ['admin'],
        because:
          'GET and PUT /api/admin/settings, /api/admin/notices and /api/admin/settings/status ' +
          'are administrator-only and then require settings.manage, which every administrator ' +
          'holds; other roles only through the Administrator preset.',
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
  buyers: 'Buyer accounts',
  procurement: 'Buyer requests',
  audit: 'Audit trail',
  'staff-access': 'Staff permissions',
  'access-logs': 'Access logs',
  'sign-in-security': 'Your sign-in security',
  settings: 'Settings',
  farmers: 'Farmers',
  farms: 'Farms & maps',
  communications: 'Communications',
  'product-reports': 'Product reports',
  support: 'Support cases',
  // 2026-10-28: the admin console.
  accounts: 'Users and organizations',
  marketplace: 'Marketplace console',
  programme: 'Farmer verification programme',
  visits: 'Visits',
  reports: 'Reports',
  analytics: 'Marketplace analytics',
  directories: 'Directories',
  library: 'Learning library',
  desk: 'Field desk',
  dashboard: 'Dashboard',
  design: 'Design system',
  new: 'New',
  edit: 'Edit',
  review: 'Verify farmers',
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

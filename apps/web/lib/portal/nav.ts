import type { PermissionKey, Role } from '@agri-erp/shared';

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
 *
 * 3. (2026-10-30, presets are binding.) A destination whose routes ask for a
 *    PERMISSION appears only to someone who holds it. `permissions` on an item
 *    is the set the routes behind it accept (any one of them will do), copied
 *    from their requirePermission calls. The role alone no longer implies a
 *    permission, so an administrator holding only Moderator + Editor sees the
 *    moderation screens and not Settings, Staff permissions or the audit trail.
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
  | 'settings'
  // 2026-10-31: one glyph per destination (the phone menu read as duplicates).
  | 'users'
  | 'cart'
  | 'store'
  | 'clipboard'
  | 'lightbulb'
  | 'help'
  | 'building'
  | 'trend'
  | 'key'
  | 'shield'
  | 'clock';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconKey;
  /** Exactly the roles the routes behind this screen accept. */
  readonly roles: readonly Role[];
  /** Why these roles, naming the route. Read by nav.test.ts and by the next reader. */
  readonly because: string;
  /**
   * 2026-10-30. The permissions the routes behind this screen ask for; holding
   * ANY one of them platform-wide is enough. Absent: the role alone decides.
   */
  readonly permissions?: readonly PermissionKey[];
  /**
   * The routes behind this screen accept the permission over some states (they
   * filter to the states held), so a state-limited grant is enough to be offered it.
   */
  readonly statesEnough?: boolean;
}

/**
 * What the signed-in person holds, from GET /api/admin/staff-access/me: each
 * permission and whether it reaches the whole platform.
 * - `null`: not known yet (or the answer failed). Every permission-gated item
 *   is hidden: offering a door before knowing is the failure rule 2 prevents.
 * - `undefined` (the argument omitted): roles only, for callers that ask
 *   "what could this role ever be offered?".
 */
export type HeldPermissions = ReadonlyMap<PermissionKey, { readonly platform: boolean }>;

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
        icon: 'users',
        roles: STAFF,
        because:
          'GET /api/admin/accounts and GET /api/admin/accounts/:kind/:id accept the staff roles ' +
          'and then require support.handle, content.moderate or staff.manage; revealing a ' +
          'contact requires support.handle, disabling content.moderate, re-enabling ' +
          'superadmin.grant.',
        permissions: ['support.handle', 'content.moderate', 'staff.manage'],
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
        icon: 'cart',
        roles: ['admin'],
        because:
          'GET and PATCH /api/admin/buyers are administrator-only (B13, C-14B.3) and then ' +
          'require content.moderate: an administrator holding Moderator + Editor verifies, ' +
          'rejects or suspends a buyer organisation.',
        permissions: ['content.moderate'],
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
        roles: STAFF,
        because:
          'GET /api/admin/marketplace, its inspect and removed routes accept the staff roles ' +
          '(POST /api/admin/marketplace/:kind/:id/remove admin and supervisor) and then require ' +
          'content.moderate.',
        permissions: ['content.moderate'],
      },
      {
        // 2026-10-19: the live marketplace, where staff withdraw a listing with
        // a reason (the moderate panel on each product page).
        href: '/market',
        label: 'Live marketplace',
        icon: 'store',
        roles: ['admin', 'supervisor'],
        because:
          'POST /api/listings/:id/withdraw accepts admin and supervisor (a supervisor in the ' +
          "listing's state); the page itself is public.",
      },
      {
        href: '/admin/procurement',
        label: 'Buyer requests',
        icon: 'clipboard',
        roles: ['admin'],
        because:
          '/api/admin/purchase-requests and /api/admin/orders are administrator-only (B13) and ' +
          'then require content.moderate: CORWADO decides requests and arranges orders against ' +
          'listings.',
        permissions: ['content.moderate'],
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
        icon: 'lightbulb',
        roles: STAFF,
        because:
          'GET /api/admin/advisers requires content.moderate and GET /api/admin/advisory-notes ' +
          'content.moderate or content.publish; both accept the staff roles (decisions admin ' +
          'and supervisor).',
        permissions: ['content.moderate', 'content.publish'],
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
        roles: STAFF,
        because:
          'GET /api/admin/product-reports, the detail and the unread count accept the staff ' +
          'roles and then require content.moderate (PATCH admin and supervisor).',
        permissions: ['content.moderate'],
      },
      {
        // 2026-10-21: "Contact CORWADO" messages from the help page; support
        // cases since 2026-10-28 (the specification's line 103).
        href: '/admin/support',
        label: 'Support cases',
        icon: 'help',
        roles: STAFF,
        because:
          'GET /api/admin/support and GET /api/admin/support/:id accept the staff roles (PATCH ' +
          'and POST entries admin and supervisor) and then require support.handle, held through ' +
          'the Support or Super Admin preset.',
        permissions: ['support.handle'],
      },
      {
        // 2026-10-27: organisational profiles, their teams, exceptional recovery.
        href: '/admin/organizations',
        label: 'Organisations',
        icon: 'building',
        roles: STAFF,
        because:
          'GET /api/admin/organizations accepts the staff roles (POST ' +
          '/api/admin/organizations/:id/recover admin and supervisor) and then requires ' +
          'support.handle.',
        permissions: ['support.handle'],
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
        roles: STAFF,
        because:
          'GET /api/admin/announcements, /api/admin/message-templates and ' +
          '/api/admin/communications/farmers accept the staff roles (sending admin and ' +
          'supervisor) and then require communications.send, held through the Administrator or ' +
          'Super Admin preset.',
        permissions: ['communications.send'],
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
        icon: 'trend',
        roles: STAFF,
        because:
          'GET /api/analytics/summary accepts admin, supervisor and read_only, and then ' +
          'requires reports.view somewhere (Analyst, Administrator or Super Admin preset), ' +
          'filtered to the states held. POST /api/analytics/export accepts the same roles ' +
          'and the same permission.',
        permissions: ['reports.view'],
        statesEnough: true,
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
        icon: 'key',
        roles: STAFF,
        because:
          'GET /api/admin/staff-access and GET /api/admin/staff-invitations accept the staff ' +
          'roles and then require staff.manage somewhere (Administrator or Super Admin preset), ' +
          'filtered to the states held.',
        permissions: ['staff.manage'],
        statesEnough: true,
      },
      {
        // 2026-10-28: your own two-step sign-in. Every staff role may enrol;
        // administrators are required to (STAFF_MFA_ENFORCEMENT).
        href: '/admin/sign-in-security',
        label: 'Your sign-in security',
        icon: 'shield',
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
        icon: 'clock',
        roles: STAFF,
        because:
          'GET /api/admin/access-logs accepts the staff roles and then requires audit.view ' +
          'across the platform (Administrator or Super Admin preset).',
        permissions: ['audit.view'],
      },
      {
        href: '/admin/audit',
        label: 'Audit trail',
        icon: 'audit',
        roles: STAFF,
        because:
          'GET /api/audit accepts the staff roles and then requires audit.view across the ' +
          'platform (C-4.8; Administrator or Super Admin preset).',
        permissions: ['audit.view'],
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
        roles: STAFF,
        because:
          'GET and PUT /api/admin/settings, /api/admin/notices and /api/admin/settings/status ' +
          'accept the staff roles (writes admin and supervisor) and then require ' +
          'settings.manage (Administrator or Super Admin preset).',
        permissions: ['settings.manage'],
      },
    ],
  },
];

/** Whether this person may be offered this item: the role, then any permission it needs. */
export function offered(item: NavItem, role: Role, held?: HeldPermissions | null): boolean {
  if (!item.roles.includes(role)) return false;
  if (!item.permissions || held === undefined) return true;
  if (held === null) return false;
  return item.permissions.some((key) => {
    const h = held.get(key);
    return h !== undefined && (h.platform || item.statesEnough === true);
  });
}

/**
 * The sections this person may see, with the items they may not removed and
 * empty sections dropped. Pass what they hold (HeldPermissions); `null` while
 * it is not known hides every permission-gated item.
 */
export function navFor(role: Role, held?: HeldPermissions | null): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    heading: section.heading,
    items: section.items.filter((item) => offered(item, role, held)),
  })).filter((section) => section.items.length > 0);
}

/** HeldPermissions from the `permissions` list GET /api/admin/staff-access/me returns. */
export function heldFrom(
  permissions: readonly { readonly key: PermissionKey; readonly platform: boolean }[],
): HeldPermissions {
  return new Map(permissions.map((p) => [p.key, { platform: p.platform }]));
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
export function activeHref(
  pathname: string,
  role: Role,
  held?: HeldPermissions | null,
): string | null {
  const candidates = navFor(role, held)
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

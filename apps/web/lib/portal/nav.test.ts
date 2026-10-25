import { describe, expect, it } from 'vitest';

import type { PermissionKey } from '@agri-erp/shared';

import {
  ALL_ITEMS,
  NAV_SECTIONS,
  activeHref,
  crumbsFor,
  heldFrom,
  navFor,
  pageTitleFor,
} from './nav';

/**
 * The navigation is role-aware, and this asserts it IN BOTH DIRECTIONS.
 *
 * A nav that offers a supervisor the audit trail sends them to a 403 they did
 * nothing to deserve. A nav that offers nobody anything passes every
 * "is it hidden?" test perfectly — the B1.3 lesson, which is why every case
 * below has a matching case saying who DOES see the item.
 */

const ROLES = ['admin', 'supervisor', 'read_only', 'officer'] as const;

/** What someone holds, platform-wide, as GET /api/admin/staff-access/me reports it. */
const holding = (...keys: PermissionKey[]) => heldFrom(keys.map((key) => ({ key, platform: true })));
const hrefsOf = (sections: ReturnType<typeof navFor>) =>
  sections.flatMap((s) => s.items.map((i) => i.href));

describe('who sees which destination', () => {
  it('offers every destination to somebody', () => {
    // Without this the table could go empty and every refusal test below would
    // pass by describing nothing.
    expect(ALL_ITEMS.length).toBeGreaterThan(8);
    for (const item of ALL_ITEMS) {
      expect(item.roles.length, `${item.label} is offered to no role at all`).toBeGreaterThan(0);
    }
  });

  it('an administrator sees every section', () => {
    const headings = navFor('admin').map((s) => s.heading);
    // CORWADO's ten tabs (2026-10-19). Settings joined with its screen (2026-10-25).
    expect(headings).toEqual([
      'Overview',
      'Users and organizations',
      'Marketplace',
      'Advice and learning',
      'Reports and support',
      'Communications',
      'Analytics and exports',
      'Staff and permissions',
      'Access and audit logs',
      'Settings',
    ]);
  });

  it('offers Settings to the staff roles, under its own tab, and then only to holders', () => {
    // 2026-10-25, widened 2026-10-30. Every settings route admits the staff
    // roles and then asks for settings.manage; the nav agrees with them, it is
    // not the control.
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/admin/settings')),
    );
    expect(offered).toEqual(['admin', 'supervisor', 'read_only']);
    expect(hrefsOf(navFor('admin', holding('settings.manage')))).toContain('/admin/settings');
    expect(hrefsOf(navFor('admin', holding('content.moderate')))).not.toContain('/admin/settings');
    const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.href === '/admin/settings'));
    expect(section?.heading).toBe('Settings');
    expect(pageTitleFor('/admin/settings')).toBe('Settings');
  });

  it('only a holder of audit.view is offered the audit trail (C-4.8)', () => {
    const offered = ROLES.filter((role) =>
      navFor(role, holding('audit.view')).some((s) => s.items.some((i) => i.href === '/admin/audit')),
    );
    expect(offered).toEqual(['admin', 'supervisor', 'read_only']);
    for (const role of ROLES) {
      expect(hrefsOf(navFor(role, holding('support.handle'))), role).not.toContain('/admin/audit');
    }
  });

  it('only an administrator and a supervisor are offered exports', () => {
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/reports#exports')),
    );
    expect(offered).toEqual(['admin', 'supervisor']);
  });

  it('offers marketplace analytics to the three staff roles the route admits, never an officer', () => {
    // 2026-10-22. The route then asks for reports.view: an administrator holds
    // it; a supervisor or read-only user only through a preset, and the page
    // says so when the route refuses.
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/analytics')),
    );
    expect(offered).toEqual(['admin', 'supervisor', 'read_only']);
    const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.href === '/analytics'));
    expect(section?.heading).toBe('Analytics and exports');
    expect(pageTitleFor('/analytics')).toBe('Marketplace analytics');
  });

  it('the map is offered to nobody while GIS mapping is unfinished (owner, 2026-10-19)', () => {
    // Hidden from the menu, not removed: /farms and GET /api/farms/geojson
    // stay, and when the entry returns it is admin and supervisor only --
    // the route refuses an officer and a read-only user outright.
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/farms')),
    );
    expect(offered).toEqual([]);
  });

  it('an officer is offered no staff-account screen, and every other role is', () => {
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/admin/users')),
    );
    expect(offered).toEqual(['admin', 'supervisor', 'read_only']);
  });

  it('the field desk is the officer’s alone, and they are not left without a home', () => {
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/desk')),
    );
    expect(offered).toEqual(['officer']);
    expect(navFor('officer').flatMap((s) => s.items).length).toBeGreaterThan(3);
  });

  it('every role keeps a dashboard, the register and the library', () => {
    for (const role of ROLES) {
      const hrefs = navFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs, `${role} lost the dashboard`).toContain('/dashboard');
      expect(hrefs, `${role} lost the register`).toContain('/farmers');
      expect(hrefs, `${role} lost the library`).toContain('/library');
    }
  });

  it('offers buyer review and buyer requests to administrators alone (B13 routes)', () => {
    for (const href of ['/admin/buyers', '/admin/procurement']) {
      const offered = ROLES.filter((role) =>
        navFor(role).some((s) => s.items.some((i) => i.href === href)),
      );
      expect(offered, `${href} was offered beyond administrators`).toEqual(['admin']);
    }
  });

  it('offers the preset screens to every staff role the routes admit, never an officer', () => {
    // 2026-10-30: these routes admit admin, supervisor and read_only, then ask
    // for the permission. The defect was that they admitted role admin alone.
    for (const href of [
      '/communications',
      '/product-reports',
      '/admin/support',
      '/admin/advisers',
      '/admin/organizations',
      '/admin/accounts',
      '/admin/marketplace',
      '/admin/staff-access',
      '/admin/access-logs',
    ]) {
      const offered = ROLES.filter((role) =>
        navFor(role).some((s) => s.items.some((i) => i.href === href)),
      );
      expect(offered, href).toEqual(['admin', 'supervisor', 'read_only']);
    }
  });

  it('keeps agricultural Reports and marketplace Product reports distinct', () => {
    // Two different things that would otherwise both be called "reports":
    // deliverable (t) is agricultural reporting and export; the other is
    // marketplace moderation.
    const admin = navFor('admin').flatMap((s) => s.items);
    const reports = admin.find((i) => i.href === '/reports');
    const productReports = admin.find((i) => i.href === '/product-reports');
    expect(reports?.label).toBe('Reports');
    expect(productReports?.label).toBe('Product reports');
    expect(reports?.href).not.toBe(productReports?.href);
  });

  it('offers no directories destination to anybody', () => {
    // The owner's decision: the directory module is not part of the redesigned
    // administrator experience. Only the DESTINATION is withdrawn — the route,
    // its screens and its data are untouched and still reachable by URL — so
    // this asserts the navigation, not the existence of the feature.
    for (const role of ROLES) {
      const hrefs = navFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs, `${role} was offered directories`).not.toContain('/directories');
    }
    expect(ALL_ITEMS.some((i) => i.href.startsWith('/directories'))).toBe(false);
    expect(ALL_ITEMS.some((i) => /director/i.test(i.label))).toBe(false);
  });

  it('drops a section rather than showing an empty heading', () => {
    const officer = navFor('officer');
    expect(officer.map((s) => s.heading)).not.toContain('Access and audit logs');
    expect(officer.every((s) => s.items.length > 0)).toBe(true);
  });

  it('every item says why its roles are what they are', () => {
    // The reason names the route. Without it the next session edits the list
    // from memory, which is how a door opens to a role the server refuses.
    for (const item of ALL_ITEMS) {
      expect(item.because, `${item.label} has no reason recorded`).toMatch(/api|officer|screen/i);
    }
  });

  it('names no destination twice', () => {
    const hrefs = ALL_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size, 'the same destination is listed twice').toBe(hrefs.length);
  });
});

describe('presets decide what is offered (2026-10-30)', () => {
  const PRESET_GATED = ALL_ITEMS.filter((i) => i.permissions).map((i) => i.href);

  it('an administrator holding nothing is offered no permission-gated destination', () => {
    const hrefs = hrefsOf(navFor('admin', holding()));
    for (const href of PRESET_GATED) expect(hrefs, href).not.toContain(href);
    // ...and keeps the registry, which no preset describes.
    expect(hrefs).toContain('/farmers');
    expect(hrefs).toContain('/admin/users');
  });

  it('while the answer is not known, permission-gated destinations are hidden', () => {
    const hrefs = hrefsOf(navFor('admin', null));
    for (const href of PRESET_GATED) expect(hrefs, href).not.toContain(href);
  });

  it('Moderator + Editor: the moderation screens, not support, settings, staff or the audit trail', () => {
    const hrefs = hrefsOf(navFor('admin', holding('content.moderate', 'content.publish')));
    for (const href of ['/admin/marketplace', '/product-reports', '/admin/advisers', '/admin/accounts']) {
      expect(hrefs, href).toContain(href);
    }
    for (const href of [
      '/admin/support',
      '/admin/settings',
      '/admin/staff-access',
      '/admin/audit',
      '/admin/access-logs',
      '/communications',
      '/analytics',
    ]) {
      expect(hrefs, href).not.toContain(href);
    }
  });

  it('Support: support cases, organisations and accounts, nothing of moderation or administration', () => {
    const hrefs = hrefsOf(navFor('supervisor', holding('support.handle')));
    for (const href of ['/admin/support', '/admin/organizations', '/admin/accounts']) {
      expect(hrefs, href).toContain(href);
    }
    for (const href of ['/admin/marketplace', '/product-reports', '/admin/settings', '/admin/audit']) {
      expect(hrefs, href).not.toContain(href);
    }
  });

  it('Analyst: analytics, even when limited to states', () => {
    const states = heldFrom([{ key: 'reports.view', platform: false }]);
    expect(hrefsOf(navFor('read_only', states))).toContain('/analytics');
    expect(hrefsOf(navFor('read_only', states))).not.toContain('/admin/support');
  });

  it('a state-limited grant does not open a platform-wide screen', () => {
    const states = heldFrom([{ key: 'support.handle', platform: false }]);
    expect(hrefsOf(navFor('supervisor', states))).not.toContain('/admin/support');
  });

  it('every permission-gated item names keys and reasons that agree', () => {
    for (const item of ALL_ITEMS.filter((i) => i.permissions)) {
      expect(item.permissions!.length, item.href).toBeGreaterThan(0);
      for (const key of item.permissions!) expect(item.because, item.href).toContain(key);
    }
  });
});

describe('the highlighted destination', () => {
  it('lights the longest match, so a child page does not light its parent too', () => {
    expect(activeHref('/admin/audit', 'admin')).toBe('/admin/audit');
    expect(activeHref('/admin/users', 'admin')).toBe('/admin/users');
    expect(activeHref('/farmers/abc-123', 'admin')).toBe('/farmers');
  });

  it('lights nothing on a page the person cannot reach', () => {
    expect(activeHref('/admin/audit', 'officer')).toBeNull();
    expect(activeHref('/admin/audit', 'supervisor', holding())).toBeNull();
    expect(activeHref('/admin/audit', 'supervisor', holding('audit.view'))).toBe('/admin/audit');
  });

  it('does not light a prefix that merely starts the same', () => {
    expect(activeHref('/farmersomething', 'admin')).toBeNull();
  });
});

describe('breadcrumbs', () => {
  it('the dashboard is its own root and is not a link to itself', () => {
    expect(crumbsFor('/dashboard')).toEqual([{ label: 'Dashboard' }]);
  });

  it('builds a trail and leaves the last crumb unlinked', () => {
    const crumbs = crumbsFor('/admin/audit');
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Administration', 'Audit trail']);
    expect(crumbs[0]?.href).toBe('/dashboard');
    expect(crumbs[crumbs.length - 1]?.href).toBeUndefined();
  });

  it('never prints a record identifier in the page chrome', () => {
    // C-5.8's spirit: a farmer's identifier does not need to travel into the
    // breadcrumb of every page to get the reader where they are going.
    const crumbs = crumbsFor('/farmers/7a1b2c3d-0000-4000-8000-000000000001');
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Farmers', 'Record']);
    expect(JSON.stringify(crumbs)).not.toContain('7a1b2c3d');
  });

  it('titles the page from the last crumb', () => {
    expect(pageTitleFor('/farmers/review')).toBe('Verify farmers');
    expect(pageTitleFor('/dashboard')).toBe('Dashboard');
    expect(pageTitleFor('/')).toBe('Dashboard');
  });
});

describe('the table itself', () => {
  it('points every destination at a path, not a bare hash', () => {
    for (const item of ALL_ITEMS) {
      expect(item.href.startsWith('/'), `${item.label} is not an absolute path`).toBe(true);
    }
  });

  it('has no empty section', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.items.length, `${section.heading} is empty`).toBeGreaterThan(0);
    }
  });
});

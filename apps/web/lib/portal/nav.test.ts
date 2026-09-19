import { describe, expect, it } from 'vitest';

import { ALL_ITEMS, NAV_SECTIONS, activeHref, crumbsFor, navFor, pageTitleFor } from './nav';

/**
 * The navigation is role-aware, and this asserts it IN BOTH DIRECTIONS.
 *
 * A nav that offers a supervisor the audit trail sends them to a 403 they did
 * nothing to deserve. A nav that offers nobody anything passes every
 * "is it hidden?" test perfectly — the B1.3 lesson, which is why every case
 * below has a matching case saying who DOES see the item.
 */

const ROLES = ['admin', 'supervisor', 'read_only', 'officer'] as const;

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
    expect(headings).toEqual([
      'Overview',
      'Field operations',
      'People & access',
      'Communications',
      'Reporting',
      'Reference',
      'Governance',
    ]);
  });

  it('only an administrator is offered the audit trail (C-4.8)', () => {
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/admin/audit')),
    );
    expect(offered).toEqual(['admin']);
  });

  it('only an administrator and a supervisor are offered exports', () => {
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/reports#exports')),
    );
    expect(offered).toEqual(['admin', 'supervisor']);
  });

  it('the map is offered to administrators and supervisors, and to nobody else', () => {
    // GET /api/farms/geojson is the only route serving boundary coordinates
    // across farms, and it refuses an officer and a read-only user outright.
    const offered = ROLES.filter((role) =>
      navFor(role).some((s) => s.items.some((i) => i.href === '/farms')),
    );
    expect(offered).toEqual(['admin', 'supervisor']);
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

  it('offers communications and product reports to administrators alone', () => {
    // Both routes exist and both are administrator-only on the server. This
    // asserts the nav agrees with them, not that the nav is the control.
    for (const href of ['/communications', '/product-reports']) {
      const offered = ROLES.filter((role) =>
        navFor(role).some((s) => s.items.some((i) => i.href === href)),
      );
      expect(offered, `${href} was offered beyond administrators`).toEqual(['admin']);
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
    expect(officer.map((s) => s.heading)).not.toContain('Governance');
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

describe('the highlighted destination', () => {
  it('lights the longest match, so a child page does not light its parent too', () => {
    expect(activeHref('/admin/audit', 'admin')).toBe('/admin/audit');
    expect(activeHref('/admin/users', 'admin')).toBe('/admin/users');
    expect(activeHref('/farmers/abc-123', 'admin')).toBe('/farmers');
  });

  it('lights nothing on a page the role cannot reach', () => {
    expect(activeHref('/admin/audit', 'supervisor')).toBeNull();
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
    expect(pageTitleFor('/farmers/review')).toBe('Review queue');
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

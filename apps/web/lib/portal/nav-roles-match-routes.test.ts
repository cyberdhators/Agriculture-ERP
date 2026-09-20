import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_ITEMS } from './nav';

/**
 * THE NAVIGATION'S ROLES AGAINST THE ROUTES THEY CLAIM TO COPY.
 *
 * `nav.ts` says its `roles` are "copied from the `roles:` declaration of the
 * route the screen cannot render without". That was a promise a person kept by
 * hand. Nothing checked it, and the census of 2026-09-20 named this the most
 * exposed ungated seam in the repository, for two reasons:
 *
 *   1. ONE SIDE CAN MOVE ALONE. Narrowing a route's roles is an API change with
 *      no reason to open this file. The exposure test is not "has it failed"
 *      but "can one side move alone, and does anything force the other" -- and
 *      nothing did.
 *   2. THE FAILURE IS USER-VISIBLE AND SILENT TO US. A supervisor is offered a
 *      door that answers 403. No log, no red run; just somebody clicking a
 *      thing that does not work and deciding the system is broken.
 *
 * THE MAPPING IS PART OF WHAT IS ASSERTED, and that is the point. `route` on
 * each item names a file; if that file does not exist, or declares no roles for
 * that method, this fails. A mapping that can name nothing is the manifest
 * exclusion bug -- a key that matched nothing for six weeks while the list
 * looked consistent (PROJECT-STATE, "an exclusion list is itself a claim").
 *
 * Pure: it reads route files. No database.
 */
const API = fileURLToPath(new URL('../../app/api', import.meta.url));

/** `GET /api/reports/summary` -> the file that should declare it. */
const routeFileFor = (route: string): { method: string; file: string } => {
  const [method = '', path = ''] = route.split(' ');
  return { method, file: join(API, path.replace(/^\/api\//, ''), 'route.ts') };
};

/** The roles a route file declares for one method, or null if it declares none. */
function declaredRoles(file: string, method: string): string[] | 'public' | null {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const at = source.indexOf(`${method}: {`);
  if (at === -1) return null;
  const rolesAt = source.indexOf('roles:', at);
  if (rolesAt === -1) return null;
  const line = source.slice(rolesAt, source.indexOf('\n', source.indexOf(']', rolesAt) + 1) + 1);
  if (/roles:\s*'public'/.test(line)) return 'public';
  return [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

describe('every navigation item agrees with the route it names', () => {
  it('there are items to check, so this cannot pass by checking nothing', () => {
    expect(ALL_ITEMS.length).toBeGreaterThan(8);
  });

  it('every item names a route that exists and declares roles for that method', () => {
    const broken = ALL_ITEMS.filter((item) => {
      const { method, file } = routeFileFor(item.route);
      return declaredRoles(file, method) === null;
    }).map((item) => `${item.label} -> ${item.route}`);
    expect(
      broken,
      'these navigation items name a route that has no file, or a method that file does not ' +
        'declare. The mapping is checked as well as the roles, because a mapping that names ' +
        `nothing checks nothing: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('every item offers exactly the roles its route accepts', () => {
    const disagreements: string[] = [];
    for (const item of ALL_ITEMS) {
      const { method, file } = routeFileFor(item.route);
      const onRoute = declaredRoles(file, method);
      if (onRoute === null || onRoute === 'public') continue;
      const inNav = [...item.roles].sort();
      if (JSON.stringify(inNav) !== JSON.stringify(onRoute)) {
        disagreements.push(
          `${item.label} (${item.href}) offers [${inNav.join(', ')}] but ${item.route} accepts [${onRoute.join(', ')}]`,
        );
      }
    }
    expect(
      disagreements,
      'a screen offered to a role its route refuses is a door that answers 403, found by the ' +
        'person who clicks it. A screen withheld from a role the route accepts is a capability ' +
        `nobody can reach. Both are here: ${disagreements.join(' | ')}`,
    ).toEqual([]);
  });
});

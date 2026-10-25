import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * THE ADMINISTRATION OVERVIEW (2026-10-28) reads the SQL text, as the
 * suspension scan does: the route is staff-only and asks for reports.view,
 * every figure leaves out soft-deleted rows, and a live post is counted only
 * when its poster is not suspended -- the market's own conditions.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('GET /api/admin/overview', () => {
  const route = read('app/api/admin/overview/route.ts');
  const lib = read('lib/api/admin-overview.ts');

  it('admits staff only and requires reports.view, scoped like analytics', () => {
    expect(route).toMatch(/roles: \['admin', 'supervisor', 'read_only'\]/);
    expect(route).toMatch(/requirePermissionCoverage\(auth, 'reports\.view'\)/);
    expect(route).toMatch(/analyticsStates\(auth\.scope, coverage/);
    expect(route).not.toMatch(/\b(POST|PATCH|PUT|DELETE): \{/);
  });

  it('names integrations only to a caller who holds settings.manage', () => {
    expect(route).toMatch(/seesSettings: holdsPermission\(permissions, 'settings\.manage'\)/);
    expect(lib).toMatch(/integrations: seesSettings \? integrationStatus\(\) : null/);
  });

  it('counts live produce listings only from a farmer neither removed nor suspended', () => {
    expect(lib).toMatch(
      /JOIN public\.farmer f ON f\.id = pl\.farmer_id AND f\.deleted_at IS NULL\s+AND f\.suspended_at IS NULL/,
    );
  });

  it('counts live services and buying requests through the market conditions', () => {
    expect(lib).toMatch(/\$\{SERVICE_FROM\} CROSS JOIN w\s+WHERE \$\{SERVICE_MARKET_WHERE\}/);
    expect(lib).toMatch(
      /\$\{BUYING_REQUEST_FROM\} CROSS JOIN w\s+WHERE \$\{BUYING_REQUEST_MARKET_WHERE\}/,
    );
  });

  it('leaves soft-deleted rows out of every table it counts', () => {
    for (const alias of ['f', 'b', 'o', 'og', 'pl', 'sv', 'r', 'sm', 'pr', 'mr', 'c', 'aa']) {
      expect(lib, `alias ${alias}`).toMatch(new RegExp(`\\b${alias}\\.deleted_at IS NULL`));
    }
  });

  it('selects no name, phone, email or message text', () => {
    for (const column of ['given_name', 'family_name', 'phone', 'email', 'display_name']) {
      expect(lib, column).not.toMatch(new RegExp(`\\.${column}\\b`));
    }
    expect(lib).not.toMatch(/\b(sm|m)\.body\b/);
  });
});

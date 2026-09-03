import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ROUTE_MARKER } from '../lib/api/route';

/**
 * A ROUTE THAT SKIPS THE WRAPPER FAILS THIS TEST BY EXISTING.
 *
 * The wrapper owns authentication, the Content-Type check, the size cap, the
 * JSON parse, the documented 405, the fixed 500, the correlation id and the
 * success envelope. A route that hand-rolls any of those will drift from the
 * others, and the drift test in packages/shared cannot see it: that one locks
 * documented sentences to exported constants, so a route returning 400 where
 * 415 belongs leaves every table matching and every test green.
 *
 * This walks every route file, imports it, and asserts that each exported HTTP
 * handler carries the mark only `defineRoutes` applies.
 */

const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url));
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const files = routeFiles(API_DIR);

describe('every API route goes through the shared wrapper', () => {
  it('finds route files to check, so this cannot pass by checking nothing', () => {
    // Without this, deleting every route would make the suite below vacuously
    // green -- the B1.3 lesson, applied to a test that walks a directory.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(API_DIR.length) || '/', f]))(
    'route %s exports only wrapped handlers',
    async (_label, file) => {
      const module_ = (await import(file)) as Record<string, unknown>;
      const exported = METHODS.filter((m) => typeof module_[m] === 'function');

      expect(exported.length, 'a route file that exports no handler is dead code').toBeGreaterThan(
        0,
      );

      for (const method of exported) {
        const handler = module_[method] as Record<symbol, unknown>;
        expect(
          handler[ROUTE_MARKER],
          `${method} in ${file} was not produced by defineRoutes. Every route must go ` +
            'through the wrapper: it owns authentication, the status-code order, the ' +
            'fixed 500 and the correlation id.',
        ).toBe(true);
      }
    },
  );

  it('the mark cannot be faked by exporting a plain function', () => {
    // Proves the assertion above actually discriminates, rather than passing
    // for anything callable.
    const impostor = async () => new Response(null);
    expect((impostor as unknown as Record<symbol, unknown>)[ROUTE_MARKER]).toBeUndefined();
  });
});

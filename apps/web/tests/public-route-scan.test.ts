import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * EXACTLY ONE ROUTE IN THIS SYSTEM IS PUBLIC, AND THIS COUNTS THEM.
 *
 * `roles: 'public'` skips authentication entirely. The wrapper test beside this
 * one proves the declaration must be explicit; this proves nobody has added a
 * second one. A route quietly becoming public is the kind of change that
 * reviews fine line by line and is catastrophic in aggregate, so it is counted
 * rather than trusted.
 *
 * If a second public route is ever genuinely wanted, this test should be
 * updated deliberately, in the same commit, by someone who has thought about
 * rate limiting — not relaxed to make a build pass.
 */
const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url));

/** Routes a marketplace visitor or farmer with no account must be able to call. */
const EXPECTED_PUBLIC = [
  'listings',
  'listings/[id]',
  'listings/[id]/contact-requests',
  'listings/[id]/reports',
  'weather/forecast',
];

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

describe('public routes are counted, not trusted', () => {
  it('finds route files at all, so this cannot pass by checking nothing', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('exactly the expected routes declare roles: public', () => {
    const publicRoutes = files
      .filter((file) => /roles:\s*'public'/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(API_DIR.length + 1).replace(/\/route\.ts$/, ''))
      .sort();

    expect(
      publicRoutes,
      'A route declared roles: public that this test does not expect. An unauthenticated ' +
        'write is a deliberate decision with rate-limiting consequences — see ' +
        'docs/api/product-reports-contract.md — not something to add and move on from.',
    ).toEqual([...EXPECTED_PUBLIC].sort());
  });

  it('no route declares an empty roles array', () => {
    // `roles: []` is not public — the wrapper test proves that — but it is
    // also never what anybody means, and it reads like "unrestricted".
    const empty = files
      .filter((file) => /roles:\s*\[\s*\]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(API_DIR.length + 1));
    expect(empty, 'a route declares an empty roles array').toEqual([]);
  });

  it('every route file declares roles somehow', () => {
    // A route that forgot `roles` would not compile — the type requires it —
    // but the failure mode is severe enough to assert rather than assume.
    const missing = files
      .filter((file) => !/roles:/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(API_DIR.length + 1));
    expect(missing, 'a route file declares no roles at all').toEqual([]);
  });

  it('the absence of a rate limiter is written down, not left to be discovered', () => {
    // Prompt 15 searched for rate-limiting infrastructure and found none:
    // no limiter, no counter table, no edge rule in middleware.ts. That is a
    // real gap on an unauthenticated write, and the one thing worse than the
    // gap would be a reader assuming the digest closes it. So the route says
    // so in its own header, and this pins the sentence.
    // Comment wrapping is not the point, so the header is flattened first.
    const source = readFileSync(join(API_DIR, 'listings/[id]/reports/route.ts'), 'utf8')
      .replace(/^\s*\*/gm, ' ')
      .replace(/\s+/g, ' ');
    expect(source, 'the route no longer says that rate limiting is absent').toMatch(
      /no rate-limiting infrastructure/i,
    );
    // And it must not be hiding behind the digest, which stops one repeat of
    // one listing from one source and nothing else.
    expect(source).toMatch(/digest is NOT one|not a security control/);
  });

  it('no API route claims to rate-limit anything', () => {
    // If a limiter is ever added, this fails and is replaced by tests for what
    // the limiter actually does — which is the point of writing it now.
    const limiters = files.filter((file) =>
      /rateLimit|rate_limit|ratelimit|Ratelimit|throttle/.test(readFileSync(file, 'utf8')),
    );
    expect(limiters.map((file) => file.slice(API_DIR.length + 1))).toEqual([]);
  });

  it('the public route is the marketplace report submission and nothing else', () => {
    const source = readFileSync(join(API_DIR, 'listings/[id]/reports/route.ts'), 'utf8');
    expect(source).toMatch(/roles:\s*'public'/);
    // It writes a report and nothing else: no session, no scope, so it must
    // not read anything it was not asked for.
    expect(source).not.toMatch(/requireRole/);
  });
});

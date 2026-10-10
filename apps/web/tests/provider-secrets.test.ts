import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * THE PROVIDER KEY MUST NOT BE REACHABLE FROM A BROWSER.
 *
 * `RESEND_API_KEY` is read in exactly one module. This walks the source and
 * proves it: nothing prefixes it with NEXT_PUBLIC_ (which would ship it to
 * every browser), no component reads it, and no component imports the module
 * that does.
 *
 * No secret VALUE is read or printed here — only the shape of the source. A
 * test that echoed a key to make a point would be the leak it was guarding.
 */
const WEB = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist'].includes(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sources(WEB);
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(WEB.length);

describe('the email provider key stays on the server', () => {
  it('found the source tree, so this cannot pass by scanning nothing', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no NEXT_PUBLIC_ variable carries a provider credential', () => {
    // The one prefix that guarantees a value reaches every browser.
    const offenders = files.filter((f) =>
      /NEXT_PUBLIC_[A-Z_]*(RESEND|API_KEY|SECRET|TOKEN|PASSWORD)/.test(read(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('RESEND_API_KEY is READ in exactly one module', () => {
    // `process.env.X` is the read. A doc comment naming the variable is not a
    // leak, and this test should not force comments to go vague.
    const readers = files
      .filter((f) => !rel(f).startsWith('tests/'))
      .filter((f) => /process\.env\.RESEND_API_KEY/.test(read(f)));
    expect(readers.map(rel)).toEqual(['lib/email/resend.ts']);
  });

  it('no component or client module imports the mailer', () => {
    // It carries a browser guard that throws on import, but the point is that
    // nothing should reach that guard in the first place.
    const importers = files
      .filter((f) => rel(f).startsWith('components/') || rel(f).startsWith('app/(portal)'))
      .filter((f) => /lib\/email\/resend/.test(read(f)));
    expect(importers.map(rel)).toEqual([]);
  });

  it('the mailer refuses to load in a browser', () => {
    const source = read(join(WEB, 'lib/email/resend.ts'));
    expect(source).toMatch(/typeof window !== 'undefined'/);
    expect(source).toMatch(/throw new Error/);
  });

  it('no credential is written into an audit row or a response', () => {
    // The route records counts and a subject. It must never touch the key, set
    // an authorization header, or put either into an audit payload. Matched on
    // code shapes rather than words, so prose about authorization is allowed.
    const route = read(join(WEB, 'app/api/admin/communications/route.ts'));
    for (const forbidden of [
      /config\.apiKey/,
      /process\.env\.RESEND_API_KEY/,
      /authorization:/i,
      /Bearer /,
    ]) {
      expect(route, `the email route matched ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('the mailer never logs, and never echoes the request it sent', () => {
    const source = read(join(WEB, 'lib/email/resend.ts'));
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
    // The provider's own sentence may be surfaced; our request body may not.
    expect(source).not.toMatch(/JSON\.stringify\(\s*\{[^}]*apiKey/);
  });

  it('EMAIL_FROM is read only on the server too', () => {
    const readers = files
      .filter((f) => !rel(f).startsWith('tests/'))
      .filter((f) => /process\.env\.EMAIL_FROM/.test(read(f)));
    expect(readers.map(rel)).toEqual(['lib/email/resend.ts']);
  });
});

describe('the SMS provider key stays on the server', () => {
  // Paths are compared with forward slashes so the test reads the same on
  // every machine.
  const relPosix = (f: string) => rel(f).replace(/\\/g, '/');

  it('every Bird setting is READ in exactly one module', () => {
    for (const name of ['BIRD_API_KEY', 'BIRD_API_BASE_URL', 'BIRD_SMS_SENDER_ID']) {
      const readers = files
        .filter((f) => !relPosix(f).startsWith('tests/') && !/\.test\.ts$/.test(f))
        .filter((f) => new RegExp(`process\\.env\\.${name}\\b`).test(read(f)));
      expect(readers.map(relPosix), name).toEqual(['lib/sms/bird.ts']);
    }
  });

  it('no component or client module imports the SMS client', () => {
    const importers = files
      .filter((f) => /^(components\/|app\/\(portal\))/.test(relPosix(f)))
      .filter((f) => /lib\/sms\/bird/.test(read(f)));
    expect(importers.map(relPosix)).toEqual([]);
  });

  it('the SMS client refuses to load in a browser, and never logs', () => {
    const source = read(join(WEB, 'lib/sms/bird.ts'));
    expect(source).toMatch(/typeof window !== 'undefined'/);
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it('the farmer picker never selects or returns a phone number', () => {
    const route = read(join(WEB, 'app/api/admin/communications/farmers/route.ts'));
    // The phone is MATCHED (inside a WHERE) and tested for reachability, but
    // never named in a select list or a response object.
    const selectLists = [...route.matchAll(/SELECT ([\s\S]*?)(\$\{from\}|FROM )/g)].map(
      (m) => m[1] ?? '',
    );
    expect(selectLists.length).toBeGreaterThanOrEqual(3);
    for (const list of selectLists) expect(list).not.toMatch(/phone/i);
    expect(route).not.toMatch(/\bphone:/);
  });
});

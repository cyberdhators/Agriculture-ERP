import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ar } from '../lib/i18n/ar';
import { en } from '../lib/i18n/en';
import { INTEGRATIONS, integrationStatus } from '../lib/api/settings';

/**
 * SETTINGS, PHASE 1, READ AS TEXT (2026-10-25).
 *
 * Who may change settings, what the public may read, and that no secret
 * value ever leaves the server, are each decided by a few lines of source.
 * This reads those lines and fails if a later edit drops the permission,
 * widens a public read, or lets an environment value through.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
// Line endings normalised: a Windows checkout writes CRLF, and the slices
// below look for '\n}\n'.
const read = (path: string) => readFileSync(join(web, path), 'utf8').replace(/\r\n/g, '\n');
const migration = readFileSync(
  join(web, '../../prisma/migrations/20261025100000_settings_phase1/migration.sql'),
  'utf8',
);

const sqlString = (text: string) => `'${text.replace(/'/g, "''")}'`;

describe('the seeded consent notice is the text the sign-up screens show', () => {
  it('seeds v1.3 in English word for word, as published', () => {
    expect(migration).toContain(
      `('consent', 'v1.3', 'en', ${sqlString(en['consent.body'])}, 'published', now())`,
    );
  });

  it('seeds v1.3 in Arabic word for word, as published', () => {
    const body = ar['consent.body'];
    expect(body).toBeDefined();
    expect(migration).toContain(
      `('consent', 'v1.3', 'ar', ${sqlString(body ?? '')}, 'published', now())`,
    );
  });

  it('the sign-up screens fall back to that same version', () => {
    expect(read('components/farmer/FarmerRegister.tsx')).toMatch(/en: 'v1\.3-en'/);
    expect(read('components/farmer/FarmerRegister.tsx')).toMatch(/ar: 'v1\.3-ar'/);
    expect(read('components/buyer/StartSelling.tsx')).toMatch(/CONSENT_VERSION = 'v1\.3-en'/);
    for (const file of [
      'components/farmer/FarmerRegister.tsx',
      'components/buyer/StartSelling.tsx',
    ]) {
      expect(read(file), file).toMatch(/useConsentText\(/);
    }
  });

  it('every new table has row-level security on', () => {
    const tables = [...migration.matchAll(/CREATE TABLE "public"\."([a-z_]+)"/g)].map((m) => m[1]);
    expect(tables).toEqual(['setting_version', 'notice']);
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('adds no audit CHECK: the owner writes the combined one', () => {
    expect(migration).not.toMatch(/audit_event_action/);
  });
});

describe('only staff holding settings.manage change settings', () => {
  for (const route of [
    'app/api/admin/settings/route.ts',
    'app/api/admin/settings/history/route.ts',
    'app/api/admin/settings/status/route.ts',
    'app/api/admin/notices/route.ts',
    'app/api/admin/notices/[id]/route.ts',
    'app/api/admin/notices/[id]/publish/route.ts',
    'app/api/admin/notices/acknowledgements/route.ts',
  ]) {
    it(`${route} admits the staff roles and asks for settings.manage before any data`, () => {
      const text = read(route);
      // 2026-10-30 (presets are binding): the permission is the control.
      expect(text).toMatch(/roles: \['admin', 'supervisor'(, 'read_only')?\]/);
      expect(text).not.toMatch(/roles: \['admin'\]/);
      expect(text).not.toMatch(/'public'/);
      const handlers = text.split('handler: async').slice(1);
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const permission = handler.indexOf("requirePermission(auth, 'settings.manage')");
        const firstData = handler.search(
          /\$queryRawUnsafe|\$executeRawUnsafe|audited\(|currentSettings\(|integrationStatus\(/,
        );
        expect(permission, 'no permission check').toBeGreaterThan(-1);
        expect(permission, 'data touched before the permission check').toBeLessThan(firstData);
      }
    });
  }

  it('every write is audited in the same transaction', () => {
    for (const route of [
      'app/api/admin/settings/route.ts',
      'app/api/admin/notices/route.ts',
      'app/api/admin/notices/[id]/route.ts',
      'app/api/admin/notices/[id]/publish/route.ts',
    ]) {
      const text = read(route);
      expect(text, route).toMatch(/audited\(prisma/);
      expect(text, route).toMatch(/writeAudit\(tx/);
    }
  });

  it('a setting is appended, never updated or deleted', () => {
    const text = read('app/api/admin/settings/route.ts');
    expect(text).toMatch(/INSERT INTO public\.setting_version/);
    expect(text).not.toMatch(/UPDATE public\.setting_version|DELETE FROM public\.setting_version/);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "public"\."setting_version"/);
  });

  it('a notice is never hard-deleted', () => {
    for (const route of [
      'app/api/admin/notices/route.ts',
      'app/api/admin/notices/[id]/route.ts',
      'app/api/admin/notices/[id]/publish/route.ts',
    ]) {
      expect(read(route), route).not.toMatch(/DELETE FROM/);
    }
  });

  it('the reason-code list for the dialogs asks for content.moderate', () => {
    const text = read('app/api/admin/reason-codes/route.ts');
    expect(text).toMatch(/roles: \['admin', 'supervisor'(, 'read_only')?\]/);
    expect(text).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
  });
});

describe('the public reads are whitelists', () => {
  it('the current notice never offers a draft, a retired text or who published it', () => {
    const text = read('app/api/notices/current/route.ts');
    expect(text).toMatch(/status = 'published' AND deleted_at IS NULL/);
    expect(text).not.toMatch(/published_by|created_by|SELECT \*/);
  });

  it('the public settings carry no version, staff name or reason code', () => {
    const text = read('lib/api/settings.ts');
    const fn = text.slice(text.indexOf('export async function publicSettings'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toMatch(/service_name/);
    expect(body).not.toMatch(/changed_by|version:|reason_codes/);
  });
});

describe('no secret value leaves the server', () => {
  const sentinel = 'zz-sentinel-value-never-shown';

  it('reports presence only, never a value or its length', () => {
    const env: Record<string, string> = {};
    for (const i of INTEGRATIONS) for (const v of i.variables) env[v] = sentinel;
    const status = integrationStatus(env);
    const text = JSON.stringify(status);
    expect(text).not.toContain(sentinel);
    expect(text).not.toContain(String(sentinel.length));
    expect(status.filter((i) => i.variables.length > 0).every((i) => i.configured)).toBe(true);
  });

  it('a blank variable is missing, not configured', () => {
    const status = integrationStatus({ RESEND_API_KEY: '  ', EMAIL_FROM: 'x' });
    const resend = status.find((i) => i.name === 'Resend');
    expect(resend?.configured).toBe(false);
    expect(resend?.variables).toEqual([
      { name: 'RESEND_API_KEY', present: false },
      { name: 'EMAIL_FROM', present: true },
    ]);
  });

  it('no settings route or screen reads process.env directly', () => {
    for (const file of [
      'app/api/admin/settings/route.ts',
      'app/api/admin/settings/status/route.ts',
      'app/api/settings/public/route.ts',
      'components/admin/settings/SecuritySection.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/process\.env/);
    }
  });
});

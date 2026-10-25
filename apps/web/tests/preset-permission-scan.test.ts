import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PRESETS ARE BINDING (2026-10-30, lane-perms), READ AS TEXT.
 *
 * The defect observed on production with the demo accounts: an account with
 * the role `admin` held every permission except Super Admin, so the Moderator
 * + Editor, Support, Analyst and Administrator presets restricted nothing; and
 * the moderation and support screens admitted only the role `admin`, so a
 * supervisor given those presets could not use them.
 *
 * The fix has two halves and this file holds both in place:
 *   1. No route grants a power by `roles: ['admin']` alone. Every handler that
 *      admits only administrators either asks for a permission, or is on the
 *      short, reasoned list of programme-registry operations below that no
 *      preset describes.
 *   2. A route whose work belongs to a preset admits every staff role that can
 *      hold that preset (reads: admin, supervisor, read_only; writes: admin and
 *      supervisor) and then asks for the permission, unless it is on the
 *      reasoned list of administrator-only routes below.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const api = join(web, 'app/api');

const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });

interface Handler {
  /** e.g. "admin/support/route.ts GET" */
  readonly id: string;
  readonly file: string;
  readonly method: string;
  readonly roles: string;
  readonly body: string;
}

/** Each method block of each route file, with its roles line and its text. */
const handlers: Handler[] = routeFiles(api).flatMap((full) => {
  const file = relative(api, full).replace(/\\/g, '/');
  // CRLF in a Windows checkout would otherwise hide a roles line from the match.
  const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const parts = text.split(/\n {2}(GET|POST|PUT|PATCH|DELETE): \{/);
  const out: Handler[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const method = parts[i] as string;
    const body = parts[i + 1] as string;
    const roles = /roles: ([^\n]*?),?\n/.exec(body)?.[1] ?? '';
    out.push({ id: `${file} ${method}`, file, method, roles, body });
  }
  return out;
});

const PERMISSION_CALL =
  /requirePermission(Coverage)?\(|permissionsOf\(|isSuperAdmin\(|requireContentWriter\(|contentAccess\(/;

/**
 * Administrator-only operations of the farmer registry and its directory,
 * contracted deliverables that predate the presets. No preset describes them,
 * so they stay with the role (docs/DECISIONS.md, 2026-10-30, OPEN TO THE OWNER).
 */
const REGISTRY_ADMIN_ONLY: Readonly<Record<string, string>> = {
  'directory-entries/route.ts POST': 'directory entries (module hidden from the nav)',
  'directory-entries/[id]/route.ts PATCH': 'directory entries',
  'directory-entries/[id]/route.ts DELETE': 'directory entries',
  'farmers/[id]/reassign/route.ts POST': 'farmer register: reassign a farmer to an officer',
  'farmers/[id]/route.ts DELETE': 'farmer register: remove a record',
  'farms/[id]/route.ts DELETE': 'farm register: remove a farm',
  'visits/[id]/route.ts DELETE': 'visit log: remove a visit',
};

/**
 * Administrator-only routes that DO ask for a permission, kept to the role on
 * purpose. Each must still ask for its permission (asserted below).
 */
const ADMIN_ROLE_BY_DESIGN: Readonly<Record<string, string>> = {
  // Super Admin counts only on an administrator account (effectivePermissions).
  'admin/accounts/reenable/route.ts POST': 'superadmin.grant',
  'admin/staff-access/super-admin/route.ts POST': 'superadmin.grant / bootstrap',
  'admin/staff-access/super-admin/[id]/revoke/route.ts POST': 'superadmin.grant',
  'admin/staff-access/users/[id]/mfa-reset/route.ts POST': 'superadmin.grant',
  'admin/staff-access/users/[id]/revoke-sessions/route.ts POST': 'superadmin.grant',
  // B13 procurement: the buyer state machines record the actor as `admin`.
  'admin/buyers/route.ts GET': 'content.moderate; B13 actor typing',
  'admin/buyers/[id]/route.ts PATCH': 'content.moderate; B13 actor typing',
  'admin/purchase-requests/route.ts GET': 'content.moderate; B13 actor typing',
  'admin/purchase-requests/[id]/route.ts PATCH': 'content.moderate; B13 actor typing',
  'admin/orders/route.ts GET': 'content.moderate; B13 actor typing',
  'admin/orders/route.ts POST': 'content.moderate; B13 actor typing',
  'admin/orders/[id]/route.ts PATCH': 'content.moderate; B13 actor typing',
  // Creating, changing the role of, or removing a staff or officer account is
  // national (an administrator has no state) -- and staff.manage on top.
  'users/route.ts POST': 'staff.manage, national',
  'users/[id]/route.ts PATCH': 'staff.manage, national',
  'users/[id]/route.ts DELETE': 'staff.manage, national',
  'officers/route.ts POST': 'staff.manage, national',
  'officers/[id]/route.ts PATCH': 'staff.manage, national',
  'officers/[id]/route.ts DELETE': 'staff.manage, national',
};

const ADMIN_ONLY = "['admin']";
const STAFF_READ = "['admin', 'supervisor', 'read_only']";
const STAFF_WRITE = "['admin', 'supervisor']";

describe('the scan found the routes', () => {
  it('reads every handler, not none', () => {
    expect(handlers.length).toBeGreaterThan(150);
    expect(handlers.some((h) => h.id === 'admin/support/route.ts GET')).toBe(true);
    for (const id of [...Object.keys(REGISTRY_ADMIN_ONLY), ...Object.keys(ADMIN_ROLE_BY_DESIGN)]) {
      expect(
        handlers.some((h) => h.id === id),
        `${id} is listed here but no longer exists`,
      ).toBe(true);
    }
  });
});

describe("no route grants a power by roles: ['admin'] alone", () => {
  it('every administrator-only handler asks for a permission, or is a listed registry operation', () => {
    const bare = handlers
      .filter((h) => h.roles === ADMIN_ONLY)
      .filter((h) => !PERMISSION_CALL.test(h.body))
      .map((h) => h.id)
      .filter((id) => !(id in REGISTRY_ADMIN_ONLY))
      .sort();
    expect(
      bare,
      'these handlers admit only role admin and ask for no permission: the role alone grants nothing since 2026-10-30',
    ).toEqual([]);
  });

  it('a listed registry operation really asks for no permission (else move it off the list)', () => {
    for (const id of Object.keys(REGISTRY_ADMIN_ONLY)) {
      const h = handlers.find((x) => x.id === id)!;
      expect(h.roles, id).toBe(ADMIN_ONLY);
      expect(PERMISSION_CALL.test(h.body), id).toBe(false);
    }
  });

  it('an administrator-only handler that asks for a permission is one of the reasoned exceptions', () => {
    const unexpected = handlers
      .filter((h) => h.roles === ADMIN_ONLY && PERMISSION_CALL.test(h.body))
      .map((h) => h.id)
      .filter((id) => !(id in ADMIN_ROLE_BY_DESIGN))
      .sort();
    expect(
      unexpected,
      'these ask for a permission but admit only role admin: a supervisor holding the preset is refused at the door. Admit the staff roles, or list the reason here.',
    ).toEqual([]);
  });

  it('every reasoned exception still asks for its permission', () => {
    for (const id of Object.keys(ADMIN_ROLE_BY_DESIGN)) {
      const h = handlers.find((x) => x.id === id)!;
      expect(h.roles, id).toBe(ADMIN_ONLY);
      expect(PERMISSION_CALL.test(h.body), `${id} lost its permission check`).toBe(true);
    }
  });
});

describe('the preset screens admit every staff role that can hold the preset', () => {
  const PRESET_AREAS = [
    'admin/accounts/',
    'admin/advisers',
    'admin/advisory-notes',
    'admin/announcements',
    'admin/message-templates',
    'admin/communications',
    'admin/corrections',
    'admin/marketplace',
    'admin/market-reports',
    'admin/product-reports',
    'admin/reason-codes',
    'admin/notices',
    'admin/settings',
    'admin/organizations',
    'admin/support',
    'admin/staff-invitations',
    'audit/',
  ];
  const inAreas = handlers.filter(
    (h) => PRESET_AREAS.some((a) => h.file.startsWith(a)) && !(h.id in ADMIN_ROLE_BY_DESIGN),
  );

  it('found them', () => {
    expect(inAreas.length).toBeGreaterThan(40);
  });

  it('reads admit admin, supervisor and read_only; writes admin and supervisor', () => {
    const wrong = inAreas
      .filter((h) => h.roles !== (h.method === 'GET' ? STAFF_READ : STAFF_WRITE))
      .map((h) => `${h.id}: ${h.roles}`);
    expect(wrong).toEqual([]);
  });

  it('and every one of them asks for a permission', () => {
    const unchecked = inAreas.filter((h) => !PERMISSION_CALL.test(h.body)).map((h) => h.id);
    expect(unchecked).toEqual([]);
  });

  it('the support and moderation queues ask for their own permission', () => {
    const asks = (id: string, key: string) =>
      expect(handlers.find((h) => h.id === id)?.body ?? '', id).toMatch(
        new RegExp(`requirePermission\\(auth, '${key.replace('.', '\\.')}'\\)`),
      );
    asks('admin/support/route.ts GET', 'support.handle');
    asks('admin/support/[id]/route.ts PATCH', 'support.handle');
    asks('admin/marketplace/route.ts GET', 'content.moderate');
    asks('admin/product-reports/route.ts GET', 'content.moderate');
    asks('admin/product-reports/unread-count/route.ts GET', 'content.moderate');
    asks('admin/market-reports/route.ts GET', 'content.moderate');
    asks('audit/route.ts GET', 'audit.view');
    asks('admin/communications/route.ts POST', 'communications.send');
    asks('admin/communications/farmers/route.ts GET', 'communications.send');
  });
});

describe('the permission comes from grants only', () => {
  it('effectivePermissions reads no role-wide rule', () => {
    const text = readFileSync(join(web, '../../packages/shared/src/staff-permissions.ts'), 'utf8');
    const fn = text.slice(text.indexOf('export function effectivePermissions'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toMatch(/LEGACY_ADMIN_PERMISSIONS/);
    // The only role test left is the Super Admin second line.
    expect(body.match(/subject\.role/g)?.length).toBe(2);
    expect(body).toMatch(/grant\.preset === 'super_admin' && subject\.role !== 'admin'/);
  });

  it('assignable support staff are those holding the permission, not every administrator', () => {
    const text = readFileSync(join(web, 'lib/api/support.ts'), 'utf8');
    const sql = text.slice(text.indexOf('ASSIGNABLE_STAFF_SQL'));
    expect(sql.slice(0, sql.indexOf('`;'))).not.toMatch(/WHERE u\.role = 'admin'\s*OR/);
  });

  it('the rollout migration gives the three presets to administrators without a grant, and nothing else', () => {
    const sql = readFileSync(
      join(
        web,
        '../../prisma/migrations/20261030090000_presets_binding_keep_admin_powers/migration.sql',
      ),
      'utf8',
    );
    const code = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(code).toMatch(/ARRAY\['administrator', 'moderator_editor', 'support'\]/);
    expect(code).toMatch(/u\.role = 'admin'/);
    expect(code).toMatch(/NOT EXISTS[\s\S]*revoked_at IS NULL/);
    expect(code).not.toMatch(/super_admin/);
    expect(code).toMatch(/'Kept their powers when presets became binding \(2026-10-30\)'/);
    expect(code).toMatch(/'staff\.permission_granted'/);
    expect(code).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/);
  });
});

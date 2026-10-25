import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DETAIL_SQL,
  KIND_SQL,
  REMOVAL_ACTIONS,
  REMOVED_SQL,
  REMOVE_TARGET_SQL,
  buildMarketplaceQuery,
  kindOf,
  presentRemovedRow,
} from './admin-marketplace';

const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('buildMarketplaceQuery: tab and filters to SQL', () => {
  it('the produce tab is live product listings that are not inputs', () => {
    const q = buildMarketplaceQuery({ tab: 'produce' });
    expect(q.from).toContain('FROM public.produce_listing pl');
    expect(q.from).not.toContain('buying_request br');
    expect(q.where).toContain(`p.category <> 'seeds_inputs'`);
    expect(q.params[0]).toEqual(['active']);
  });

  it('the inputs tab is live product listings that are inputs', () => {
    const q = buildMarketplaceQuery({ tab: 'inputs' });
    expect(q.where).toContain(`p.category = 'seeds_inputs'`);
  });

  it('Inactive reads all three kinds, by UNION, with the four inactive statuses', () => {
    const q = buildMarketplaceQuery({ tab: 'inactive' });
    expect(q.from.match(/UNION ALL/g)?.length).toBe(2);
    expect(q.params[0]).toEqual(['paused', 'expired', 'withdrawn', 'completed']);
  });

  it('a live status asked of Inactive matches nothing', () => {
    expect(buildMarketplaceQuery({ tab: 'inactive', status: 'active' }).where[0]).toBe('false');
  });

  it('every filter is a bound parameter; the search is escaped for ILIKE', () => {
    const q = buildMarketplaceQuery({
      tab: 'services',
      q: '50%_off',
      state_id: 'CE',
      category: 'transport',
      flag: 'reported',
    });
    expect(q.params).toEqual([['active'], '%50\\%\\_off%', 'CE', 'transport']);
    expect(q.where.join(' ')).not.toContain('50%');
    expect(q.where).toContain('p.open_reports > 0');
    expect(buildMarketplaceQuery({ tab: 'produce', flag: 'correction' }).where).toContain(
      'p.open_correction',
    );
  });
});

describe('what the console reads, and what it never reads', () => {
  for (const [kind, sql] of Object.entries(KIND_SQL)) {
    it(`${kind}: no draft, nothing soft-deleted, no phone`, () => {
      expect(sql).toMatch(/\.deleted_at IS NULL AND \w+\.status <> 'draft'/);
      expect(sql).not.toMatch(/contact_phone|\.phone\b/);
    });
  }

  for (const [kind, sql] of Object.entries(DETAIL_SQL)) {
    it(`${kind}: the inspected fields never include the contact phone`, () => {
      expect(sql).not.toMatch(/contact_phone/);
      expect(sql).toMatch(/deleted_at IS NULL/);
    });
  }

  it('a removal locks the live, published post only', () => {
    for (const sql of Object.values(REMOVE_TARGET_SQL)) {
      expect(sql).toMatch(/deleted_at IS NULL AND \w+\.status <> 'draft'/);
      expect(sql).toMatch(/FOR UPDATE OF/);
    }
  });

  it('removed posts come from the audit trail, never from the removed rows', () => {
    expect(REMOVED_SQL).toMatch(/FROM public\.audit_event ae/);
    expect(REMOVED_SQL).not.toMatch(/produce_listing pl|buying_request br|service_listing sl/);
    expect(REMOVAL_ACTIONS).toEqual(['listing.removed', 'product_report.listing_removed']);
  });

  it('a removal names where it was made', () => {
    const base = {
      audit_id: 'a',
      kind: 'produce_listing' as const,
      id: 'x',
      title: null,
      reason: null,
      reason_code: null,
      removed_at: new Date('2026-10-28T09:00:00Z'),
      removed_by: null,
    };
    expect(presentRemovedRow({ ...base, action: 'listing.removed' }).via).toBe('console');
    expect(presentRemovedRow({ ...base, action: 'product_report.listing_removed' }).via).toBe(
      'report',
    );
  });

  it('an unknown kind in an address is no kind at all', () => {
    expect(kindOf('produce_listing')).toBe('produce_listing');
    expect(kindOf('farmer')).toBeNull();
    expect(kindOf(undefined)).toBeNull();
  });
});

describe('the console’s routes', () => {
  const routes = [
    'app/api/admin/marketplace/route.ts',
    'app/api/admin/marketplace/removed/route.ts',
    'app/api/admin/marketplace/[kind]/[id]/route.ts',
    'app/api/admin/marketplace/[kind]/[id]/remove/route.ts',
  ];
  for (const file of routes) {
    it(`${file} admits the staff roles and then asks for content.moderate`, () => {
      const text = read(file);
      // 2026-10-30 (presets are binding): the permission is the control.
      expect(text).toMatch(/roles: \['admin', 'supervisor'(, 'read_only')?\]/);
      expect(text).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
    });
  }

  it('removing a post is audited, soft, tells the owner, and never touches the account', () => {
    const text = read('app/api/admin/marketplace/[kind]/[id]/remove/route.ts');
    expect(text).toMatch(/audited\(prisma/);
    expect(text).toMatch(/action: 'listing\.removed'/);
    expect(text).toMatch(/SET deleted_at = now\(\), deleted_by = \$2::uuid/);
    expect(text).not.toMatch(/DELETE FROM/);
    expect(text).toMatch(/'listing_removed'/);
    expect(text).not.toMatch(/suspended_at|disabled_at|public\.farmer\b|public\.buyer\b/);
  });
});

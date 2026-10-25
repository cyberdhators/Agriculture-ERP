import { describe, expect, it } from 'vitest';

import {
  ADMIN_MARKETPLACE_MESSAGES,
  INACTIVE_STATUSES,
  MARKETPLACE_KINDS,
  STAFF_PERMISSION_MESSAGES,
  adminMarketplaceQuerySchema,
  marketplaceRemoveSchema,
  marketplaceStatus,
  tabSelection,
} from '../src';

describe('marketplaceStatus: what staff see from what is stored', () => {
  const today = '2026-10-28';

  it('a live post is active until its end date has passed, then expired', () => {
    expect(marketplaceStatus('listed', null, today)).toBe('active');
    expect(marketplaceStatus('active', '2026-10-28', today)).toBe('active');
    expect(marketplaceStatus('active', '2026-10-27', today)).toBe('expired');
    expect(marketplaceStatus('listed', '2026-01-01', today)).toBe('expired');
  });

  it('sold and completed both read as completed; paused and withdrawn as themselves', () => {
    expect(marketplaceStatus('sold', null, today)).toBe('completed');
    expect(marketplaceStatus('completed', '2020-01-01', today)).toBe('completed');
    expect(marketplaceStatus('paused', '2020-01-01', today)).toBe('paused');
    expect(marketplaceStatus('withdrawn', null, today)).toBe('withdrawn');
  });

  it('a draft is the owner’s own and is never shown', () => {
    expect(marketplaceStatus('draft', null, today)).toBeNull();
    expect(marketplaceStatus('something-new', null, today)).toBeNull();
  });
});

describe('tabSelection: which posts a tab holds', () => {
  it('the four live tabs hold active posts of one kind', () => {
    expect(tabSelection({ tab: 'produce' })).toEqual({
      kinds: ['produce_listing'],
      inputs: false,
      statuses: ['active'],
    });
    expect(tabSelection({ tab: 'inputs' })).toEqual({
      kinds: ['produce_listing'],
      inputs: true,
      statuses: ['active'],
    });
    expect(tabSelection({ tab: 'buying_requests' }).kinds).toEqual(['buying_request']);
    expect(tabSelection({ tab: 'services' }).kinds).toEqual(['service_listing']);
  });

  it('a status sent with a live tab does not widen it', () => {
    expect(tabSelection({ tab: 'produce', status: 'withdrawn' }).statuses).toEqual(['active']);
  });

  it('Inactive holds every kind and every status that is not live', () => {
    const s = tabSelection({ tab: 'inactive' });
    expect(s.kinds).toEqual(MARKETPLACE_KINDS);
    expect(s.statuses).toEqual(INACTIVE_STATUSES);
    expect(s.statuses).not.toContain('active');
  });

  it('Inactive narrows by status and kind, and a live status there matches nothing', () => {
    expect(tabSelection({ tab: 'inactive', status: 'expired', kind: 'service_listing' })).toEqual({
      kinds: ['service_listing'],
      inputs: null,
      statuses: ['expired'],
    });
    expect(tabSelection({ tab: 'inactive', status: 'active' }).statuses).toEqual([]);
  });
});

describe('the console’s query string', () => {
  it('defaults to the produce tab', () => {
    expect(adminMarketplaceQuerySchema.parse({}).tab).toBe('produce');
  });

  it('accepts every filter it documents', () => {
    const parsed = adminMarketplaceQuerySchema.parse({
      tab: 'inactive',
      q: '  maize ',
      state_id: 'CE',
      category: 'tractor_hire',
      status: 'expired',
      kind: 'service_listing',
      flag: 'reported',
      limit: '20',
    });
    expect(parsed.q).toBe('maize');
    expect(parsed.category).toBe('tractor_hire');
  });

  it('refuses an unknown tab, status, category or flag with the pinned messages', () => {
    const msg = (input: Record<string, string>) =>
      adminMarketplaceQuerySchema.safeParse(input).error?.issues[0]?.message;
    expect(msg({ tab: 'everything' })).toBe(ADMIN_MARKETPLACE_MESSAGES.tabUnknown);
    expect(msg({ status: 'draft' })).toBe(ADMIN_MARKETPLACE_MESSAGES.statusUnknown);
    expect(msg({ category: 'gold' })).toBe(ADMIN_MARKETPLACE_MESSAGES.categoryUnknown);
    expect(msg({ flag: 'hidden' })).toBe(ADMIN_MARKETPLACE_MESSAGES.flagUnknown);
    expect(msg({ kind: 'profile' })).toBe(ADMIN_MARKETPLACE_MESSAGES.kindUnknown);
    expect(msg({ q: 'x'.repeat(101) })).toBe(ADMIN_MARKETPLACE_MESSAGES.searchTooLong);
  });

  it('refuses a filter it does not know rather than ignoring it', () => {
    expect(adminMarketplaceQuerySchema.safeParse({ owner_phone: '1' }).success).toBe(false);
  });
});

describe('removing a post needs a reason', () => {
  it('a reason of at least five characters, kept in the audit trail', () => {
    expect(marketplaceRemoveSchema.safeParse({ reason: 'Fake' }).error?.issues[0]?.message).toBe(
      STAFF_PERMISSION_MESSAGES.reasonRequired,
    );
    expect(marketplaceRemoveSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(marketplaceRemoveSchema.safeParse({ reason: 'Counterfeit seed' }).success).toBe(true);
  });

  it('takes nothing about the account', () => {
    expect(
      marketplaceRemoveSchema.safeParse({ reason: 'Counterfeit seed', suspend_account: true })
        .success,
    ).toBe(false);
  });
});

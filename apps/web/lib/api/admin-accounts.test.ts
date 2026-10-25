import { describe, expect, it } from 'vitest';

import {
  accountListQuery,
  accountRowQuery,
  presentAccountRow,
  type AccountSqlRow,
} from './admin-accounts';

/**
 * THE ACCOUNTS LIST'S SQL, READ AS TEXT (2026-10-28). No database: the
 * builders' output is checked for the rules that matter -- nothing deleted,
 * contact search only when permitted, every value a parameter.
 */

const base = { mayUseContact: false, limit: 25, cursor: null };

describe('the accounts list query', () => {
  it('never reads a deleted or merged-away record', () => {
    const { sql } = accountListQuery({}, base);
    expect(sql).toMatch(/deleted_at IS NULL AND merged_into IS NULL/);
    expect(sql).toMatch(/public\.buyer_active/);
    expect(sql).toMatch(/FROM public\.organization o\s+WHERE o\.deleted_at IS NULL/);
  });

  it('puts every filter value in a parameter, never in the text', () => {
    const { sql, params } = accountListQuery(
      { q: "O'Brien", state: 'SS-CE', actor: 'trader', status: 'suspended', from: '2026-10-01' },
      base,
    );
    expect(sql).not.toContain("O'Brien");
    expect(sql).not.toContain('SS-CE');
    expect(params).toEqual(expect.arrayContaining(['SS-CE', 'trader', 'suspended', '2026-10-01']));
  });

  it('searches a phone only for staff permitted to search by contact', () => {
    expect(accountListQuery({ q: '0912345678' }, base).sql).not.toMatch(/r\.phone/);
    const permitted = accountListQuery({ q: '0912345678' }, { ...base, mayUseContact: true });
    expect(permitted.sql).toMatch(/regexp_replace\(COALESCE\(r\.phone/);
    expect(permitted.params).toContain('%0912345678%');
  });

  it('escapes LIKE wildcards typed into the search box', () => {
    const { params } = accountListQuery({ q: '50%_off' }, base);
    expect(params).toContain('%50\\%\\_off%');
  });

  it('pages by joined time and id, newest first, one extra row to see if more follow', () => {
    const { sql, params } = accountListQuery(
      {},
      { ...base, limit: 10, cursor: { createdAt: '2026-10-01T00:00:00.000Z', id: 'x' } },
    );
    expect(sql).toMatch(/ORDER BY r\.joined_at DESC, r\.id DESC\s+LIMIT 11/);
    expect(sql).toMatch(/\(r\.joined_at, r\.id\) </);
    expect(params).toEqual(['2026-10-01T00:00:00.000Z', 'x']);
  });

  it('narrows to people or organisations, and to sign-in or not', () => {
    expect(accountListQuery({ kind: 'organisation' }, base).sql).toMatch(
      /r\.kind = 'organisation'/,
    );
    expect(accountListQuery({ sign_in: 'no' }, base).sql).toMatch(/r\.sign_in = 'none'/);
  });

  it('opens one account by either of its records', () => {
    expect(accountRowQuery('buyer', 'id').sql).toMatch(/r\.buyer_id = \$1::uuid/);
    expect(accountRowQuery('farmer', 'id').sql).toMatch(/r\.farmer_id = \$1::uuid/);
    expect(accountRowQuery('organisation', 'id').sql).toMatch(/r\.kind = 'organisation'/);
  });
});

describe('a row as the list shows it', () => {
  const row: AccountSqlRow = {
    kind: 'farmer',
    id: 'f1',
    auth_user_id: 'a1',
    farmer_id: 'f1',
    buyer_id: 'b1',
    name: 'Amina',
    sign_in: 'phone',
    farmer_number: 'SS-0001',
    phone: '+211912345678',
    actor_types: ['buyer', 'farmer', 'processor'],
    organisations: ['Jur River Co-op'],
    state_id: 'SS-WB',
    joined_at: new Date('2026-03-12T08:24:00Z'),
    first_sign_in_at: null,
    last_seen_at: new Date('2026-10-27T10:00:00Z'),
    suspended_at: new Date('2026-10-01T00:00:00Z'),
    disabled_at: null,
    closed: false,
    verification: 'verified',
    phone_verified: true,
    publication: 'published',
    provider_status: 'published',
    adviser_approved: false,
    application_status: null,
  };

  it('carries no phone, and reads the status and advisory words', () => {
    const shown = presentAccountRow(row);
    expect(JSON.stringify(shown)).not.toContain('912345678');
    expect(shown.status).toBe('suspended');
    expect(shown.advisory).toBe('published');
    expect(shown.first_sign_in_at).toBeNull();
    expect(shown.joined_at).toBe('2026-03-12T08:24:00.000Z');
  });
});

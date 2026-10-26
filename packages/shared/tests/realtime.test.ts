import { describe, expect, it } from 'vitest';

import {
  LIVE_NOTICE_KINDS,
  REALTIME_PAYLOAD_FIELDS,
  accountChannel,
  mayJoinChannel,
  organizationChannel,
  parseChannel,
  presenceChannel,
  realtimeAuthSchema,
  type ChannelAuthFacts,
  type MemberLike,
} from '../src';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';

const member = (over: Partial<MemberLike> = {}): MemberLike => ({
  id: '44444444-4444-4444-8444-444444444444',
  preset: 'contributor',
  permissions: ['inbox.read'],
  status: 'active',
  ...over,
});

const facts = (over: Partial<ChannelAuthFacts> = {}): ChannelAuthFacts => ({
  authUserId: ME,
  memberships: new Map(),
  showActivity: true,
  ...over,
});

describe('channel names', () => {
  it('round-trip through parseChannel', () => {
    expect(parseChannel(accountChannel(ME))).toEqual({ kind: 'account', id: ME });
    expect(parseChannel(organizationChannel(ORG))).toEqual({ kind: 'organization', id: ORG });
    expect(parseChannel(presenceChannel(ME))).toEqual({ kind: 'presence', id: ME });
  });

  it('refuses names that are not ours or carry no uuid', () => {
    for (const name of [
      'orders',
      'private-acct-',
      'private-acct-not-a-uuid',
      `private-staff-${ME}`,
      `presence-org-${ORG}`,
      `private-acct-${ME}-extra`,
      `private-encrypted-acct-${ME}`,
    ]) {
      expect(parseChannel(name), name).toBeNull();
    }
  });
});

describe('the channel rule', () => {
  it('no session joins nothing', () => {
    expect(mayJoinChannel(accountChannel(ME), facts({ authUserId: null }))).toBe(false);
  });

  it('an account joins its own channel and no one else’s', () => {
    expect(mayJoinChannel(accountChannel(ME), facts())).toBe(true);
    expect(mayJoinChannel(accountChannel(OTHER), facts())).toBe(false);
  });

  it('an organisation inbox needs an active membership with inbox.read', () => {
    const name = organizationChannel(ORG);
    expect(mayJoinChannel(name, facts())).toBe(false);
    expect(mayJoinChannel(name, facts({ memberships: new Map([[ORG, member()]]) }))).toBe(true);
    expect(
      mayJoinChannel(name, facts({ memberships: new Map([[ORG, member({ permissions: [] })]]) })),
    ).toBe(false);
    expect(
      mayJoinChannel(
        name,
        facts({ memberships: new Map([[ORG, member({ permissions: [], preset: 'administrator' })]]) }),
      ),
    ).toBe(true);
    expect(
      mayJoinChannel(name, facts({ memberships: new Map([[ORG, member({ status: 'revoked' })]]) })),
    ).toBe(false);
  });

  it('presence is one’s own only, and only while showing activity', () => {
    expect(mayJoinChannel(presenceChannel(ME), facts())).toBe(true);
    expect(mayJoinChannel(presenceChannel(ME), facts({ showActivity: false }))).toBe(false);
    expect(mayJoinChannel(presenceChannel(OTHER), facts())).toBe(false);
  });

  it('there are no staff channels', () => {
    expect(mayJoinChannel(`private-staff-support.read`, facts())).toBe(false);
  });
});

describe('payloads', () => {
  it('carry no text, title, body, name or phone field', () => {
    for (const f of REALTIME_PAYLOAD_FIELDS) {
      expect(f).not.toMatch(/text|title|body|name|phone|email|preview/);
    }
  });

  it('a promotional kind exists, so marketing needs no channel change', () => {
    expect(LIVE_NOTICE_KINDS).toContain('promotional');
  });

  it('the auth body is exactly Bird’s two fields', () => {
    expect(realtimeAuthSchema.safeParse({ connection_id: '1.2', channel_name: 'x' }).success).toBe(
      true,
    );
    expect(
      realtimeAuthSchema.safeParse({ connection_id: '1.2', channel_name: 'x', extra: 1 }).success,
    ).toBe(false);
    expect(realtimeAuthSchema.safeParse({ connection_id: '', channel_name: 'x' }).success).toBe(
      false,
    );
  });
});

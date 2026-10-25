import { describe, expect, it } from 'vitest';

import {
  accountHref,
  actorLabel,
  eventLabel,
  formatDateTime,
  publicationLabel,
  statusStamp,
  timeAgo,
  verificationLabel,
} from './accounts-view';

describe('words for the accounts screens (2026-10-28)', () => {
  it('shows a date and time in Juba time', () => {
    expect(formatDateTime('2026-03-12T08:24:00Z')).toBe('12 Mar 2026, 10:24');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('says how long ago', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(timeAgo('2026-10-28T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-27T12:00:00Z', now)).toBe('1 day ago');
    expect(timeAgo('2026-10-28T11:59:40Z', now)).toBe('just now');
    expect(timeAgo(null, now)).toBe('—');
  });

  it('names actor types in the singular', () => {
    expect(actorLabel('processor')).toBe('Processor');
    expect(actorLabel('input_supplier')).toBe('Input supplier');
    expect(actorLabel('financial_services')).toBe('Financial services');
    expect(actorLabel('something_new')).toBe('Something new');
  });

  it('reads verification and publication plainly', () => {
    expect(verificationLabel({ verification: 'verified', phone_verified: true })).toBe(
      'Phone confirmed · Buyer organisation verified',
    );
    // 2026-10-31: an individual is never verified, so nothing is printed.
    expect(verificationLabel({ verification: null, phone_verified: false })).toBe('');
    expect(
      verificationLabel({ kind: 'organisation', verification: 'verified', phone_verified: false }),
    ).toBe('Verified organisation');
    expect(
      verificationLabel({ kind: 'organisation', verification: 'unverified', phone_verified: false }),
    ).toBe('Organisation not verified');
    expect(publicationLabel('published')).toBe('Profile published');
    expect(publicationLabel('none')).toBe('No public profile');
  });

  it('labels a timeline event from either source', () => {
    expect(eventLabel('access', 'first_sign_in')).toBe('First sign-in');
    expect(eventLabel('action', 'listing.created')).toBe('Listing created');
  });

  it('stamps disabled as refused and suspended as waiting', () => {
    expect(statusStamp('disabled')).toBe('rejected');
    expect(statusStamp('suspended')).toBe('pending');
  });

  it('opens a person on the account page, an organisation on its screen', () => {
    expect(accountHref({ kind: 'buyer', id: 'b1', name: 'X' })).toBe('/admin/accounts/buyer/b1');
    expect(accountHref({ kind: 'organisation', id: 'o1', name: 'Jur Co-op' })).toBe(
      '/admin/organizations?q=Jur%20Co-op',
    );
  });
});

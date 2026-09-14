import { describe, expect, it } from 'vitest';

import { eligibleOfficers } from './eligible';

const officers = [
  { id: 'o-1', name: 'Peter Lomeling', payam_id: 'CE-JUB-REJ', status: 'active' },
  { id: 'o-2', name: 'Grace Poni', payam_id: 'CE-JUB-REJ', status: 'active' },
  { id: 'o-3', name: 'Sarah Nyakuma', payam_id: 'CE-JUB-KAT', status: 'active' },
  { id: 'o-4', name: 'Aaron Wani', payam_id: 'CE-JUB-REJ', status: 'inactive' },
];

describe('eligibleOfficers (C-8R.2)', () => {
  it('offers only active officers in the farmer’s payam, sorted by name', () => {
    expect(eligibleOfficers(officers, 'CE-JUB-REJ', null).map((o) => o.name)).toEqual([
      'Grace Poni',
      'Peter Lomeling',
    ]);
  });

  it('never offers the officer who already holds the farmer (the route refuses a no-op)', () => {
    expect(eligibleOfficers(officers, 'CE-JUB-REJ', 'o-1').map((o) => o.id)).toEqual(['o-2']);
  });

  it('never offers an inactive officer or one in another payam', () => {
    const ids = eligibleOfficers(officers, 'CE-JUB-REJ', null).map((o) => o.id);
    expect(ids).not.toContain('o-3');
    expect(ids).not.toContain('o-4');
  });

  it('is empty when nobody else works that payam', () => {
    expect(eligibleOfficers(officers, 'CE-JUB-KAT', 'o-3')).toEqual([]);
  });
});

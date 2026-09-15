import { describe, expect, it } from 'vitest';

import { validateContactRequest } from './validate';

const good = {
  buyer_name: ' Deng Majok ',
  buyer_phone: '0926 004 400',
  message: '',
  quantity: '3 bags',
};

describe('validateContactRequest', () => {
  it('normalises a good request: trimmed name, E.164 phone, empty message as null', () => {
    const r = validateContactRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.body).toEqual({
        buyer_name: 'Deng Majok',
        buyer_phone: '+211926004400',
        message: null,
        quantity: '3 bags',
      });
  });

  it('refuses a missing name and a non-South-Sudan phone, naming each field', () => {
    const r = validateContactRequest({ ...good, buyer_name: 'D', buyer_phone: '+254700000000' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['buyer_name', 'buyer_phone']);
  });

  it('caps the message', () => {
    const r = validateContactRequest({ ...good, message: 'x'.repeat(301) });
    expect(r.ok).toBe(false);
  });
});

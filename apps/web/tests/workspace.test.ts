import { describe, expect, it } from 'vitest';

import { phoneSchema } from '@agri-erp/shared';

// Resolved through the pnpm workspace link, not a path alias. If apps/web
// cannot see packages/shared, this test fails to import and the suite is red.
//
// It used to import a placeholder `add` function. That placeholder existed to
// give this test something real to import until the first schema landed; the
// first schemas landed in B1.4, so it imports one of those instead.
//
// The phone number is FABRICATED.
describe('workspace wiring', () => {
  it('imports packages/shared from apps/web', () => {
    expect(phoneSchema.parse('0912345678')).toBe('+211912345678');
  });
});

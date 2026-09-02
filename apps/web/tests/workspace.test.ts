import { describe, expect, it } from 'vitest';

import { add } from '@agri-erp/shared';

// Resolved through the pnpm workspace link, not a path alias. If apps/web
// cannot see packages/shared, this test fails to import and the suite is red.
describe('workspace wiring', () => {
  it('imports packages/shared from apps/web', () => {
    expect(add(2, 3)).toBe(5);
  });
});

import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  // DELIBERATELY BROKEN -- unit B1.2 step 5, to prove CI goes red on a failing
  // test. Restored in the next commit.
  it('runs a test', () => {
    expect(true).toBe(false);
  });
});

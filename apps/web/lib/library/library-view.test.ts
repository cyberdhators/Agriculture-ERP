import { describe, expect, it } from 'vitest';

import { canSeeUnpublished } from './library-view';

/**
 * Only `canSeeUnpublished` is asserted here. `canEdit` and `canSeeHidden` live
 * in lib/preview.tsx, which carries JSX the no-database test config cannot
 * parse — which is also why no pure test imports that module at runtime. The
 * divergence between this rule and `canSeeHidden` is documented in
 * library-view.ts rather than pinned by a test that cannot run.
 */
describe('who is sent an unpublished learning resource', () => {
  it('only an administrator, because only their scope is "all"', () => {
    // `GET /api/learning-resources` adds `published = true` for any caller
    // whose scope is not `all`. A supervisor's scope is `state`, so no draft
    // can reach them however the screen asks — which is what the old
    // "Show unpublished" switch promised a supervisor it could do.
    expect(canSeeUnpublished('admin')).toBe(true);
  });

  it('nobody else, whatever the shared canSeeHidden helper says', () => {
    for (const role of ['supervisor', 'read_only', 'officer'] as const) {
      expect(canSeeUnpublished(role), `${role} was promised drafts`).toBe(false);
    }
  });
});

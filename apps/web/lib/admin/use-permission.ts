'use client';

import type { PermissionKey } from '@agri-erp/shared';
import { useEffect, useState } from 'react';

import { usePreview } from '@/lib/preview';

import { myAccess } from './staff-access-api';

/**
 * WHETHER THE SIGNED-IN STAFF MEMBER HOLDS A PERMISSION (2026-10-30, presets
 * are binding), so a screen offers only what its routes will accept. It asks
 * GET /api/admin/staff-access/me; the routes still decide (requirePermission).
 *
 * - `null`: not known yet. Render nothing rather than a refusal that may be wrong.
 * - `true`: held platform-wide (or anywhere, with `{ statesEnough: true }`).
 * - `false`: not held, an officer, or the answer failed.
 *
 * Without a live session (the fixture preview) there is no server to ask, so
 * the preview's administrator is treated as holding it, as before.
 */
export function useHolds(
  key: PermissionKey,
  options: { readonly statesEnough?: boolean } = {},
): boolean | null {
  const { role, me, hydrated } = usePreview();
  const statesEnough = options.statesEnough === true;
  const [holds, setHolds] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (role === 'officer') {
      setHolds(false);
      return;
    }
    if (!me) {
      setHolds(role === 'admin');
      return;
    }
    let on = true;
    setHolds(null);
    myAccess()
      .then((a) => {
        if (!on) return;
        const p = a.permissions.find((x) => x.key === key);
        setHolds(p !== undefined && (p.platform || (statesEnough && p.state_ids.length > 0)));
      })
      .catch(() => on && setHolds(false));
    return () => {
      on = false;
    };
  }, [role, me, hydrated, key, statesEnough]);

  return holds;
}

'use client';

import { useEffect, useState } from 'react';

import { myAccess } from '@/lib/admin/staff-access-api';
import { usePreview } from '@/lib/preview';

import { LIVE_LIBRARY } from './api';

/**
 * WHAT THE SIGNED-IN STAFF MEMBER MAY DO WITH GUIDES (2026-10-22).
 *
 * Publishing authority is separately assignable: writing and submitting need
 * "Moderate content and listings" or "Publish content"; returning, publishing
 * and unpublishing need "Publish content". The routes decide (lib/api/
 * learning.ts); this only decides which buttons to offer, from
 * GET /api/admin/staff-access/me, so a screen does not offer what the server
 * will refuse.
 *
 * Administrators and supervisors reach the library's write routes, and then
 * only with the permission (2026-10-30: presets are binding; the role alone
 * grants neither). In the preview (fixtures, NEXT_PUBLIC_USE_LIVE_LIBRARY off)
 * the preview's administrator holds both, as before.
 */
export interface ContentAccessView {
  readonly write: boolean;
  readonly publish: boolean;
}

const NONE: ContentAccessView = { write: false, publish: false };
const BOTH: ContentAccessView = { write: true, publish: true };

export function useContentAccess(): ContentAccessView {
  const { role, me, hydrated } = usePreview();
  const [access, setAccess] = useState<ContentAccessView>(NONE);

  useEffect(() => {
    if (!hydrated || (role !== 'admin' && role !== 'supervisor')) {
      setAccess(NONE);
      return;
    }
    if (!LIVE_LIBRARY) {
      setAccess(role === 'admin' ? BOTH : NONE);
      return;
    }
    if (!me) return;
    let on = true;
    myAccess()
      .then((a) => {
        if (!on) return;
        const held = new Set(a.permissions.filter((p) => p.platform).map((p) => p.key));
        const publish = held.has('content.publish');
        setAccess({ publish, write: publish || held.has('content.moderate') });
      })
      .catch(() => on && setAccess(NONE));
    return () => {
      on = false;
    };
  }, [role, me, hydrated]);

  return access;
}

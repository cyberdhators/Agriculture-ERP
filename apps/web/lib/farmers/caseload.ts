'use client';

import { useEffect, useMemo, useState } from 'react';

import { listOfficers, LIVE_ADMIN, type Officer } from '@/lib/admin/api';
import { OFFICERS, type Officer as FixtureOfficer } from '@/lib/fixtures/farmers';

export { eligibleOfficers, type CaseloadOfficer } from './eligible';

/**
 * The officer list the reassign picker filters from. In live mode it is
 * GET /api/officers (LIVE_ADMIN), which the admin — the only role that may
 * reassign — can always read. Off live, the fixture officers, so the dossier
 * can be walked with nobody signed in.
 */
export function useOfficers(enabled: boolean): {
  officers: readonly { id: string; name: string; payam_id: string; status: string }[];
  loading: boolean;
  error?: string;
  nameOf: (id: string | null) => string | null;
} {
  const live = LIVE_ADMIN;
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(live && enabled);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!live || !enabled) return;
    let on = true;
    setLoading(true);
    // The officer picker wants every officer who could take the caseload, and
    // the route pages. MAX_LIMIT in one request keeps the picker a single
    // request rather than a loop, and the eligibility filter below narrows it
    // to the farmer's own payam anyway. If a payam ever holds more officers
    // than one page, this needs paging — noted rather than assumed away.
    listOfficers({ limit: 200 })
      .then((r) => on && (setOfficers(r.rows), setError(undefined)))
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : 'Could not load officers.');
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [live, enabled]);

  return useMemo(() => {
    const list: readonly { id: string; name: string; payam_id: string; status: string }[] = live
      ? officers
      : (OFFICERS as readonly FixtureOfficer[]);
    const byId = new Map(list.map((o) => [o.id, o.name]));
    return {
      officers: list,
      loading,
      error,
      nameOf: (id) => (id ? (byId.get(id) ?? null) : null),
    };
  }, [live, officers, loading, error]);
}

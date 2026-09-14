'use client';

import { useEffect, useMemo, useState } from 'react';

import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import { farmerPayamName, officerById } from '@/lib/fixtures/farmers';

import { LIVE_VISITS } from './api';
import { farmerName, officerName, payamName, type FarmerOption } from './fixtures';

/**
 * Names for the ids a visit carries. A visit row holds `farmer_id`,
 * `officer_id` and `payam_id`; the screens show people and places. In live
 * mode the caseload (GET /api/farmers, already scoped to the caller) is read
 * once and indexed; it is also the list an officer picks from when recording,
 * so a chosen farmer is one the route will accept. Off live, the fixtures
 * answer, so the screens can be walked with nobody signed in.
 *
 * Officers are not listed by a route the portal calls yet, so a live officer
 * name falls back to the fixture table and then to the id itself — never
 * blank, never invented.
 */
export interface VisitNames {
  farmer: (id: string) => string;
  officer: (id: string) => string;
  payam: (id: string) => string;
  /** The farmers the caller may record a visit for. Empty until loaded in live mode. */
  farmers: readonly FarmerOption[];
  loading: boolean;
  error?: string;
}

export function useVisitNames(): VisitNames {
  const live = LIVE_VISITS || LIVE_FARMERS;
  const [farmers, setFarmers] = useState<readonly FarmerOption[]>([]);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!live) return;
    let on = true;
    listFarmers({ limit: 200 })
      .then((r) => {
        if (!on) return;
        setFarmers(
          r.farmers
            .filter((f) => f.merged_into === null)
            .map((f) => ({
              id: f.id,
              name: `${f.given_name} ${f.family_name}`,
              payam_id: f.payam_id,
              // The route derives county from the farmer row; the form never sends it.
              county_id: '',
              state_id: f.state_id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : 'Could not load the caseload.');
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [live]);

  return useMemo(() => {
    const byId = new Map(farmers.map((f) => [f.id, f.name]));
    return {
      farmer: (id) => byId.get(id) ?? farmerName(id),
      officer: (id) => officerById(id)?.name ?? officerName(id),
      payam: (id) => (live ? farmerPayamName(id) : payamName(id)),
      farmers,
      loading,
      error,
    };
  }, [farmers, live, loading, error]);
}

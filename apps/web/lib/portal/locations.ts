'use client';

import { useEffect, useState } from 'react';

/**
 * NAMES FOR THE HIERARCHY'S IDENTIFIERS, FETCHED ONCE.
 *
 * `GET /api/reports/summary` breaks figures down by state, county and payam
 * as identifiers — `CE`, `CE-JUB`, `CE-JUB-MUN`. A national dashboard that
 * labels its bars `CE` is asking the reader to hold a codebook in their head.
 * This reads the location bundle every role may already read, once per page
 * load, and hands back a lookup.
 *
 * ONE REQUEST, SHARED. The promise is cached at module scope, so four
 * breakdowns on one screen cause one fetch, not four. A failure is not an
 * error state: the charts fall back to the identifier, which is still correct,
 * just terser.
 */

export interface LocationRow {
  id: string;
  name: string;
  state_id?: string;
  county_id?: string;
}

export interface LocationNames {
  state: (id: string) => string | undefined;
  county: (id: string) => string | undefined;
  payam: (id: string) => string | undefined;
  /**
   * The lists themselves, for dependent pickers: choosing a state narrows the
   * counties, choosing a county narrows the payams. Empty until the bundle
   * arrives, and empty for good if it never does — a picker with no options is
   * better than a picker with invented ones.
   */
  states: LocationRow[];
  countiesIn: (stateId: string) => LocationRow[];
  payamsIn: (stateId: string, countyId: string) => LocationRow[];
}

type Row = LocationRow;

interface Bundle {
  states?: Row[];
  counties?: Row[];
  payams?: Row[];
}

let cached: Promise<Bundle> | null = null;

function load(): Promise<Bundle> {
  cached ??= fetch('/api/locations', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : { data: {} }))
    .then((body: { data?: Bundle }) => body.data ?? {})
    .catch(() => ({}));
  return cached;
}

const lookup = (rows: Row[] | undefined) => {
  const map = new Map((rows ?? []).map((row) => [row.id, row.name]));
  return (id: string) => map.get(id);
};

const EMPTY: LocationNames = {
  state: () => undefined,
  county: () => undefined,
  payam: () => undefined,
  states: [],
  countiesIn: () => [],
  payamsIn: () => [],
};

export function useLocationNames(enabled: boolean): LocationNames {
  const [names, setNames] = useState<LocationNames>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let on = true;
    void load().then((bundle) => {
      if (!on) return;
      const counties = bundle.counties ?? [];
      const payams = bundle.payams ?? [];
      setNames({
        state: lookup(bundle.states),
        county: lookup(counties),
        payam: lookup(payams),
        states: bundle.states ?? [],
        countiesIn: (stateId) =>
          stateId ? counties.filter((row) => row.state_id === stateId) : counties,
        payamsIn: (stateId, countyId) =>
          payams.filter(
            (row) =>
              (countyId ? row.county_id === countyId : true) &&
              (stateId && !countyId ? row.state_id === stateId : true),
          ),
      });
    });
    return () => {
      on = false;
    };
  }, [enabled]);

  return names;
}

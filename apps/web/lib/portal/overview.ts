'use client';

import { useEffect, useMemo, useState } from 'react';

import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import { canReview, daysWaiting, isEscalated, scopeFarmers } from '@/lib/farmers/presentation';
import { LIVE_VERIFICATION, listQueue, type QueueItem } from '@/lib/farmers/verification';
import { FARMERS, type Farmer } from '@/lib/fixtures/farmers';
import type { Role } from '@/lib/preview';
import { getSummary, LIVE_REPORTS, type Summary } from '@/lib/reports/api';

/**
 * The dashboard's data (C-10). Live, three routes the server has already
 * scoped to the caller: GET /api/reports/summary for every count, the review
 * queue for what is waiting (admin, supervisor and read-only; an officer's
 * scope has no queue), and GET /api/farmers, newest first, for recent
 * registrations. Off live, the fixtures scoped the way the preview scopes
 * them. The screen renders the same shape either way, and never a fixture
 * value beside a live one: a figure the routes do not serve is absent.
 */
export const LIVE_OVERVIEW = LIVE_REPORTS && LIVE_FARMERS;

export { kpisFrom, queueRows, type QueueRow } from './overview-pure';
import { kpisFrom, queueRows, type QueueRow } from './overview-pure';

export interface OverviewData {
  live: boolean;
  loading: boolean;
  error?: string;
  /** Counts as the server computed them; off live, counted from the scoped fixtures. */
  counts: { in_scope: number; verified: number; pending: number; rejected: number };
  /** Reach and land figures exist live only (C-10.2, C-10.5). */
  reach: Summary['reach'] | null;
  land: Summary['land'] | null;
  as_of: string | null;
  queue: QueueRow[] | null;
  /** True when the queue was not asked for (officer scope) rather than empty. */
  queueUnavailable: boolean;
  recent: Farmer[];
  /** Live: verified and reached per payam. Off live: verified against verified+pending. */
  coverage: CoverageRow[];
}

export interface CoverageRow {
  payamId: string;
  verified: number;
  /** Live: farmers reached by a visit. Off live: verified + pending (the honest denominator, C-6.8). */
  other: number;
}

function fixtureOverview(role: Role): OverviewData {
  const scoped = scopeFarmers(FARMERS, role).filter((f) => f.merged_into === null);
  const by = (s: Farmer['verification_status']) =>
    scoped.filter((f) => f.verification_status === s);
  const pending = by('pending');
  const queue: QueueRow[] = [...pending]
    .sort((a, b) => {
      const ea = isEscalated(a) ? 1 : 0;
      const eb = isEscalated(b) ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return daysWaiting(b) - daysWaiting(a);
    })
    .map((f) => ({
      id: f.id,
      farmer_number: f.farmer_number,
      given_name: f.given_name,
      family_name: f.family_name,
      payam_id: f.payam_id,
      registered_by: f.registered_by,
      days: daysWaiting(f),
      escalated: isEscalated(f),
    }));
  const cov = new Map<string, CoverageRow>();
  for (const f of scoped) {
    if (f.verification_status === 'rejected') continue;
    const row = cov.get(f.payam_id) ?? { payamId: f.payam_id, verified: 0, other: 0 };
    row.other += 1;
    if (f.verification_status === 'verified') row.verified += 1;
    cov.set(f.payam_id, row);
  }
  return {
    live: false,
    loading: false,
    counts: {
      in_scope: scoped.length,
      verified: by('verified').length,
      pending: pending.length,
      rejected: by('rejected').length,
    },
    reach: null,
    land: null,
    as_of: null,
    queue,
    queueUnavailable: false,
    recent: [...scoped].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8),
    coverage: [...cov.values()].sort((a, b) => b.other - a.other),
  };
}

export function useOverview(role: Role, enabled: boolean): OverviewData {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [recent, setRecent] = useState<Farmer[]>([]);
  const [loading, setLoading] = useState(LIVE_OVERVIEW);
  const [error, setError] = useState<string | undefined>();
  const wantsQueue = LIVE_VERIFICATION && (canReview(role) || role === 'read_only');

  useEffect(() => {
    if (!LIVE_OVERVIEW || !enabled) return;
    let on = true;
    setLoading(true);
    Promise.all([
      getSummary(),
      listFarmers({ limit: 8 }),
      wantsQueue ? listQueue() : Promise.resolve(null),
    ])
      .then(([s, r, q]) => {
        if (!on) return;
        setSummary(s);
        setRecent(r.farmers);
        setQueue(q);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (on) setError(e instanceof Error ? e.message : 'Could not read the register.');
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [enabled, wantsQueue]);

  return useMemo<OverviewData>(() => {
    if (!LIVE_OVERVIEW) return fixtureOverview(role);
    if (!summary) {
      return {
        live: true,
        loading,
        error,
        counts: { in_scope: 0, verified: 0, pending: 0, rejected: 0 },
        reach: null,
        land: null,
        as_of: null,
        queue: null,
        queueUnavailable: !wantsQueue,
        recent: [],
        coverage: [],
      };
    }
    return {
      live: true,
      loading,
      error,
      counts: kpisFrom(summary),
      reach: summary.reach,
      land: summary.land,
      as_of: summary.as_of,
      queue: queue ? queueRows(queue) : null,
      queueUnavailable: !wantsQueue,
      recent,
      coverage: summary.by.payam
        .map((b) => ({ payamId: b.key, verified: b.verified, other: b.reached }))
        .sort((a, b) => b.verified - a.verified),
    };
  }, [role, summary, queue, recent, loading, error, wantsQueue]);
}

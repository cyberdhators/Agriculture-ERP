'use client';

import { useEffect, useState } from 'react';

import { listAudit, LIVE_ADMIN, type AuditEvent } from '@/lib/admin/api';
import { getFarmer, LIVE_FARMERS } from '@/lib/farmers/api';
import { listFarmerFarms, LIVE_FARMS, type FarmWithCrops } from '@/lib/farms/api';
import {
  auditForEntity,
  consentForFarmer,
  cropsForFarm,
  eventsForFarmer,
  farmerById,
  farmsForFarmer,
  membershipsForFarmer,
  type Consent,
  type CooperativeMember,
  type Farmer,
  type VerificationEvent,
} from '@/lib/fixtures/farmers';
import { isNoSignal } from '@/lib/offline/net';
import { farmerOnPhone, pendingFarmsFor } from '@/lib/offline/officer';
import { loadWithSnapshot } from '@/lib/offline/snapshot';
import { listFarmerVisits, LIVE_VISITS, type Visit } from '@/lib/visits/api';

/**
 * Everything the farmer dossier shows, from one place. In live mode each
 * section reads its own route and fails on its own: a farms route that is
 * down leaves the identity section standing. What no route serves yet is
 * `null`, and the screen says so rather than showing fixture rows as if they
 * were the farmer's. Off live, the fixtures answer, so the dossier can be
 * walked with nobody signed in.
 *
 * Route per section (deliverable, criterion):
 *   farmer   GET /api/farmers/:id          (c, C-5)   LIVE_FARMERS
 *   farms    GET /api/farmers/:id/farms    (c, C-7)   LIVE_FARMS
 *   visits   GET /api/farmers/:id/visits   (d, C-8)   LIVE_VISITS
 *   audit    GET /api/audit?entity_id=     (s, C-4)   LIVE_ADMIN — admin only; others get []
 *   consent, verification events, cooperatives, sync: no route yet → null
 */
export interface DossierData {
  farmer: Farmer | null | undefined; // undefined = loading, null = not found / out of scope
  farms: FarmWithCrops[];
  visits: Visit[] | null;
  audit: AuditEvent[] | null;
  consent: Consent | null | undefined; // undefined = no source yet (live), null = none on file
  events: VerificationEvent[] | null;
  memberships: CooperativeMember[] | null;
  live: boolean;
  loading: boolean;
  /** PWA: set when what is shown is this phone's saved copy (no signal); when it was saved. */
  savedAt: number | null;
  errors: Partial<Record<'farmer' | 'farms' | 'visits' | 'audit', string>>;
}

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function useDossier(id: string, role: string): DossierData {
  const live = LIVE_FARMERS;
  const [farmer, setFarmer] = useState<Farmer | null | undefined>(live ? undefined : null);
  const [farms, setFarms] = useState<FarmWithCrops[]>([]);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = useState(live);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<DossierData['errors']>({});

  useEffect(() => {
    if (!live) return;
    let on = true;
    setLoading(true);
    setErrors({});
    setSavedAt(null);
    const fail = (key: keyof DossierData['errors'], e: unknown, fallback: string) =>
      on && setErrors((prev) => ({ ...prev, [key]: msg(e, fallback) }));

    // PWA (2026-10-10): each section falls back to the copy saved on this
    // phone when there is no signal, and only then; a real refusal still shows.
    const older = (at: number) => on && setSavedAt((prev) => Math.min(prev ?? at, at));
    loadWithSnapshot(`dossier.farmer.${id}`, () => getFarmer(id), isNoSignal)
      .then((got) => {
        if (!on || !got) return;
        setFarmer(got.data);
        if (!got.fresh) older(got.savedAt);
      })
      .catch(async (e) => {
        const kept = isNoSignal(e) ? await farmerOnPhone(id) : null;
        if (!on) return;
        if (kept?.farmer) {
          setFarmer(kept.farmer);
          older(Date.now());
          return;
        }
        setFarmer(null);
        // 404 is the honest answer for out-of-scope (C-5.8); no error banner for it.
        if (!(e instanceof Error && 'status' in e && e.status === 404))
          fail('farmer', e, 'Could not load this farmer.');
      })
      .finally(() => on && setLoading(false));

    if (LIVE_FARMS)
      Promise.all([
        loadWithSnapshot(`dossier.farms.${id}`, () => listFarmerFarms(id), isNoSignal),
        pendingFarmsFor(id),
      ])
        .then(([got, waiting]) => {
          if (!on) return;
          const sent = new Set((got?.data ?? []).map((f) => f.farm.id));
          setFarms([...waiting.filter((w) => !sent.has(w.farm.id)), ...(got?.data ?? [])]);
          if (got && !got.fresh) older(got.savedAt);
        })
        .catch((e) => fail('farms', e, 'Could not load farms.'));

    if (LIVE_VISITS)
      loadWithSnapshot(
        `dossier.visits.${id}`,
        async () => (await listFarmerVisits(id, { limit: 50 })).visits,
        isNoSignal,
      )
        .then((got) => {
          if (!on || !got) return;
          setVisits(got.data);
          if (!got.fresh) older(got.savedAt);
        })
        .catch((e) => fail('visits', e, 'Could not load visits.'));

    if (LIVE_ADMIN && role === 'admin')
      listAudit({ entity_type: 'farmer', entity_id: id, limit: 100 })
        .then((r) => on && setAudit(r.events))
        .catch((e) => fail('audit', e, 'Could not load the audit trail.'));

    return () => {
      on = false;
    };
  }, [id, live, role]);

  if (!live) {
    const f = farmerById(id) ?? null;
    return {
      farmer: f,
      farms: f
        ? farmsForFarmer(f.id).map((farm) => ({
            farm,
            crops: [...new Set(cropsForFarm(farm.id).map((c) => c.crop))],
          }))
        : [],
      visits: null,
      audit: f ? (auditForEntity(f.id) as unknown as AuditEvent[]) : null,
      consent: f ? (consentForFarmer(f.id) ?? null) : null,
      events: f ? eventsForFarmer(f.id) : null,
      memberships: f ? membershipsForFarmer(f.id) : null,
      live: false,
      loading: false,
      savedAt: null,
      errors: {},
    };
  }

  return {
    farmer,
    farms,
    visits: LIVE_VISITS ? visits : null,
    audit: LIVE_ADMIN && role === 'admin' ? audit : null,
    consent: undefined,
    events: null,
    memberships: null,
    live: true,
    loading,
    savedAt,
    errors,
  };
}

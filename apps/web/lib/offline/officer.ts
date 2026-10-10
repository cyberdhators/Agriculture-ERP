'use client';

import type { CreateFarmer, RecordFarmInput, RecordVisit } from '@agri-erp/shared';

import { listFarmers } from '@/lib/farmers/api';
import type { FarmWithCrops } from '@/lib/farms/api';
import type { Farmer } from '@/lib/fixtures/farmers';

import { isNoSignal } from './net';
import { enqueue, queuedOf } from './outbox';
import { loadWithSnapshot, readSnapshot } from './snapshot';

/**
 * THE EXTENSION OFFICER OFFLINE (2026-10-10, PWA step 4).
 *
 * The officer's caseload is kept on the phone; a farmer registered and a
 * visit recorded with no signal go to the outbox. The server routes already
 * take a phone-made id and treat a repeat as the same record (C-9.2), so a
 * retry is safe. A visit for a farmer registered on this phone waits for that
 * registration to be acknowledged first (the outbox's parent rule), and so
 * does a farm recorded by hand. Farm MAPPING is not here: the GIS work is not
 * finished (the owner, 2026-10-10); a farm is recorded by hand and mapped later.
 */

export const REGISTRATION_KIND = 'farmer-registration';
export const VISIT_KIND = 'visit';
export const FARM_KIND = 'farm-record';

const regId = (farmerId: string) => `farmer:${farmerId}`;

/** The caseload: from the server, or with no signal the copy saved on this phone. */
export async function loadCaseload(): Promise<{ farmers: Farmer[]; savedAt: number | null }> {
  const got = await loadWithSnapshot(
    'officer.caseload',
    async () => (await listFarmers({ limit: 200 })).farmers,
    isNoSignal,
  );
  return { farmers: got?.data ?? [], savedAt: got && !got.fresh ? got.savedAt : null };
}

export interface PendingRegistration {
  id: string;
  name: string;
  phone: string;
  payam_id: string;
  createdAt: number;
  /** Set when the outbox stopped it: the reason, for the officer. */
  problem?: string;
}

/** Farmers registered on this phone that the server has not acknowledged yet. */
export async function pendingRegistrations(): Promise<PendingRegistration[]> {
  return (await queuedOf(REGISTRATION_KIND)).map((q) => {
    const b = (q.body ?? {}) as Partial<CreateFarmer>;
    return {
      id: b.id ?? q.id.replace(/^farmer:/, ''),
      name: `${b.given_name ?? ''} ${b.family_name ?? ''}`.trim(),
      phone: b.phone ?? '',
      payam_id: b.payam_id ?? '',
      createdAt: q.createdAt,
      problem: q.status === 'stopped' ? q.message : undefined,
    };
  });
}

/** Save a registration on the phone; the outbox sends it. */
export async function queueRegistration(body: CreateFarmer): Promise<void> {
  await enqueue({
    id: regId(body.id),
    kind: REGISTRATION_KIND,
    label: `Register: ${body.given_name} ${body.family_name}`,
    method: 'POST',
    path: '/api/farmers',
    body,
  });
}

/**
 * Save a visit on the phone; the outbox sends it. If the farmer was registered
 * on this phone and is not on the server yet, the visit waits for them.
 */
export async function queueVisit(
  farmerId: string,
  farmerName: string,
  body: RecordVisit,
): Promise<void> {
  const waitingFarmer = (await pendingRegistrations()).some((p) => p.id === farmerId);
  await enqueue({
    id: `visit:${body.id}`,
    kind: VISIT_KIND,
    label: `Visit: ${farmerName}`,
    method: 'POST',
    path: `/api/farmers/${encodeURIComponent(farmerId)}/visits`,
    body,
    ...(waitingFarmer ? { parentId: regId(farmerId) } : {}),
  });
}

/** Save a farm recorded by hand on the phone; the outbox sends it (after its farmer, if waiting). */
export async function queueFarm(
  farmerId: string,
  farmerName: string,
  body: RecordFarmInput,
): Promise<void> {
  const waitingFarmer = (await pendingRegistrations()).some((p) => p.id === farmerId);
  await enqueue({
    id: `farm:${body.id}`,
    kind: FARM_KIND,
    label: `Farm: ${body.name?.trim() || 'farm'} (${farmerName})`,
    method: 'POST',
    path: `/api/farmers/${encodeURIComponent(farmerId)}/farms/manual`,
    body,
    ...(waitingFarmer ? { parentId: regId(farmerId) } : {}),
  });
}

/**
 * The farms recorded on this phone for one farmer and not yet acknowledged, in
 * the shape the dossier draws, marked not mapped. The position is shown: the
 * officer who recorded it is the one reading it.
 */
export async function pendingFarmsFor(farmerId: string): Promise<FarmWithCrops[]> {
  const path = `/api/farmers/${encodeURIComponent(farmerId)}/farms/manual`;
  return (await queuedOf(FARM_KIND))
    .filter((q) => q.path === path)
    .map((q) => {
      const b = q.body as RecordFarmInput;
      return {
        farm: {
          id: b.id,
          farmer_id: farmerId,
          boundary: null,
          accuracy_flag: 'unusable',
          mapped_by: '',
          mapped_at: new Date(q.createdAt).toISOString(),
          season: b.season,
          mapped: false,
          pending: true,
          name: b.name ?? null,
          size:
            b.size_value != null && b.size_unit != null
              ? { value: b.size_value, unit: b.size_unit }
              : null,
          tenure: b.tenure ?? null,
          village: b.village ?? null,
          location_note: b.location_note ?? null,
          notes: b.notes ?? null,
          ...(b.location
            ? {
                location: {
                  latitude: b.location.latitude,
                  longitude: b.location.longitude,
                  accuracy_m: b.location.accuracy_m ?? null,
                },
              }
            : {}),
        },
        crops: b.crops ?? [],
      };
    });
}

/**
 * Who a farmer is, with no signal: the caseload copy on this phone, or a
 * registration still waiting to send. Null when this phone does not know them.
 */
export async function farmerOnPhone(
  id: string,
): Promise<{ farmer: Farmer | null; name: string; waiting: boolean } | null> {
  const saved = await readSnapshot<Farmer[]>('officer.caseload');
  const known = saved?.data.find((f) => f.id === id);
  if (known)
    return { farmer: known, name: `${known.given_name} ${known.family_name}`, waiting: false };
  const reg = (await pendingRegistrations()).find((p) => p.id === id);
  return reg ? { farmer: null, name: reg.name, waiting: true } : null;
}

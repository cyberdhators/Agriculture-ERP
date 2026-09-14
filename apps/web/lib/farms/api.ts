// Client data layer for farms and boundaries (deliverable (c), C-7). It calls
// the B7 route GET /api/farmers/:id/farms through the standard envelope and
// flattens the API's farm shape onto the `Farm` view type the dossier and the
// Boundary SVG already render: the API nests every mapping under
// `boundaries[]` with one flagged current; the screen wants one farm with its
// current boundary on it. Geometry is present only for the reader entitled to
// it (C-7.8); a farm the caller may not see the shape of renders as unmapped.

import type { Crop } from '@agri-erp/shared';

import type { AccuracyFlag, Farm, Ring } from '@/lib/fixtures/farmers';

export const LIVE_FARMS = process.env.NEXT_PUBLIC_USE_LIVE_FARMS === '1';

export class FarmApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'FarmApiError';
  }
}

/** One mapping, as `presentBoundary()` gives it. Geometry keys absent when hidden. */
interface BoundaryDto {
  id: string;
  season: string;
  area_ha: number;
  grade: AccuracyFlag;
  point_count: number;
  mapped_by: string;
  mapped_at: string;
  is_current: boolean;
  gps_accuracy_m?: number;
  boundary?: { type: 'Polygon'; coordinates: [Ring, ...Ring[]] };
  centroid?: { type: 'Point'; coordinates: [number, number] };
}

/** One farm, as `presentFarm()` gives it. */
interface FarmDto {
  id: string;
  farmer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  season: string;
  created_by: string;
  captured_at: string | null;
  created_at: string;
  updated_at: string;
  boundaries: BoundaryDto[];
  crops: { season: string; crop: Crop }[];
}

/** A farm with the crops declared on it, the two things the dossier shows together. */
export interface FarmWithCrops {
  farm: Farm;
  crops: Crop[];
}

/**
 * Flatten one API farm onto the view type. The current boundary supplies the
 * shape and figures; a farm with no current boundary, or whose geometry the
 * caller may not see, becomes `boundary: null` with an origin centroid, which
 * the Boundary SVG already renders as "not mapped".
 */
export function toFarm(row: FarmDto): FarmWithCrops {
  const current = row.boundaries.find((b) => b.is_current) ?? row.boundaries[0];
  const ring = current?.boundary?.coordinates[0];
  const farm: Farm = {
    id: row.id,
    farmer_id: row.farmer_id,
    boundary: ring ? { type: 'Polygon', coordinates: [ring] } : null,
    centroid: current?.centroid
      ? { lon: current.centroid.coordinates[0], lat: current.centroid.coordinates[1] }
      : { lon: 0, lat: 0 },
    area_ha: current?.area_ha ?? 0,
    point_count: current?.point_count ?? 0,
    gps_accuracy_m: current?.gps_accuracy_m ?? 0,
    accuracy_flag: current?.grade ?? 'unusable',
    mapped_by: current?.mapped_by ?? row.created_by,
    mapped_at: current?.mapped_at ?? row.created_at,
    season: current?.season ?? row.season,
  };
  const crops = [...new Set(row.crops.map((c) => c.crop))];
  return { farm, crops };
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; rule?: string };
}

async function request<T>(path: string): Promise<Envelope<T>> {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    const err = body.error;
    throw new FarmApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

/** GET /api/farmers/:id/farms — the farmer's farms, scoped; out of scope is 404 (C-7.8). */
export async function listFarmerFarms(farmerId: string): Promise<FarmWithCrops[]> {
  const body = await request<FarmDto[]>(`/api/farmers/${encodeURIComponent(farmerId)}/farms`);
  return (body.data ?? []).map(toFarm);
}

/** Total current area across a farmer's farms, in hectares. */
export function totalArea(farms: readonly FarmWithCrops[]): number {
  return farms.reduce((sum, f) => sum + f.farm.area_ha, 0);
}

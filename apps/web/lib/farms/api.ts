// Client data layer for farms and boundaries (deliverable (c), C-7). It calls
// the B7 route GET /api/farmers/:id/farms through the standard envelope and
// flattens the API's farm shape onto the `Farm` view type the dossier and the
// Boundary SVG already render: the API nests every mapping under
// `boundaries[]` with one flagged current; the screen wants one farm with its
// current boundary on it. Geometry is present only for the reader entitled to
// it (C-7.8); a farm the caller may not see the shape of renders as unmapped.

import {
  addBoundarySchema,
  createFarmSchema,
  declareCropsSchema,
  type AddBoundary,
  type CreateFarm,
  type Crop,
  type DeclareCrops,
} from '@agri-erp/shared';

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

/**
 * One mapping, as `presentBoundary()` gives it.
 *
 * `gps_accuracy_m`, `boundary` and `centroid` are ABSENT — the key missing
 * entirely — when the reader is not entitled to the geometry (C-7.8). That is
 * NOT the same fact as a farm with no boundary walked, and a screen that
 * cannot tell them apart will report "no boundary" to an officer who simply
 * was not shown one. `area_ha`, `grade` and `point_count` are always present.
 */
export interface FarmBoundaryRecord {
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
  boundaries: FarmBoundaryRecord[];
  crops: { season: string; crop: Crop }[];
}

/** A farm with the crops declared on it, the two things the dossier shows together. */
export interface FarmWithCrops {
  farm: Farm;
  crops: Crop[];
}

/**
 * Flatten one API farm onto the view type.
 *
 * The current boundary supplies the shape and the figures. When there is no
 * current boundary — or when the caller is not entitled to the geometry —
 * those keys are LEFT OFF rather than defaulted. They used to become an origin
 * centroid and zeroes, which put the farm in the Atlantic with a perfect GPS
 * fix; the screens now render nothing where nothing was sent (C-7.8).
 */
export function toFarm(row: FarmDto): FarmWithCrops {
  const current = row.boundaries.find((b) => b.is_current) ?? row.boundaries[0];
  const ring = current?.boundary?.coordinates[0];
  const farm: Farm = {
    id: row.id,
    farmer_id: row.farmer_id,
    boundary: ring ? { type: 'Polygon', coordinates: [ring] } : null,
    ...(current?.centroid
      ? {
          centroid: {
            lon: current.centroid.coordinates[0]!,
            lat: current.centroid.coordinates[1]!,
          },
        }
      : {}),
    ...(current?.area_ha === undefined ? {} : { area_ha: current.area_ha }),
    ...(current?.point_count === undefined ? {} : { point_count: current.point_count }),
    ...(current?.gps_accuracy_m === undefined ? {} : { gps_accuracy_m: current.gps_accuracy_m }),
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

/**
 * Total current area across a farmer's farms, in hectares.
 *
 * Sums only the farms whose area was actually reported. A withheld area
 * contributes nothing rather than a zero — the total is then "the area of the
 * farms you can see", which is the honest figure for a reader who was not sent
 * all of them.
 */
export function totalArea(farms: readonly FarmWithCrops[]): number {
  return farms.reduce((sum, f) => sum + (f.farm.area_ha ?? 0), 0);
}

/* ---- The national map and list (administrator workspace) -------------- */

/**
 * ONE FEATURE FROM `GET /api/farms/geojson`.
 *
 * The route is the map: administrator and supervisor only, scoped, current
 * boundaries only, `unusable` grades excluded, cursor-paginated. `grade` is the
 * BACKEND's own classification — `good`, `poor`, `unusable` from ACCURACY_FLAGS
 * — not a label invented here, and nothing in this client compares a metre
 * reading against a threshold of its own.
 */
export interface FarmFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | null;
  properties: {
    farm_id: string;
    boundary_id: string;
    farmer_id: string;
    payam_id: string;
    county_id: string;
    state_id: string;
    season: string;
    area_ha: number;
    grade: AccuracyFlag;
    mapped_at: string;
  };
}

export interface GeoJsonPage {
  features: FarmFeature[];
  cursor: string | null;
  hasMore: boolean;
}

/** The filters the geojson route accepts. Payam and season, and nothing else. */
export interface MapFilterParams {
  payam?: string;
  season?: string;
  cursor?: string;
  limit?: number;
}

const query = (params: Record<string, string | number | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const out = qs.toString();
  return out ? `?${out}` : '';
};

/**
 * The map's features, by cursor.
 *
 * This is the only route that serves boundary geometry across farms, and the
 * only place a supervisor sees coordinates at all — it is the state's map, not
 * a person's record. An officer is refused outright.
 */
export async function listFarmGeoJson(params: MapFilterParams = {}): Promise<GeoJsonPage> {
  const body = await requestPage<FarmFeature[]>(`/api/farms/geojson${query({ ...params })}`);
  return {
    features: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/** The filters `GET /api/farms` accepts. NOTE: no season — that is the map's alone. */
export interface FarmListParams {
  farmer?: string;
  payam?: string;
  updated_since?: string;
  cursor?: string;
  limit?: number;
}

export interface FarmListPage {
  farms: FarmWithCrops[];
  cursor: string | null;
  hasMore: boolean;
}

export async function listFarms(params: FarmListParams = {}): Promise<FarmListPage> {
  const body = await requestPage<FarmDto[]>(`/api/farms${query({ ...params })}`);
  return {
    farms: (body.data ?? []).map(toFarm),
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/* ---- Mapping: the officer's three writes ------------------------------- */

/**
 * CREATING A FARM IS MAPPING IT. `POST /api/farmers/:id/farms`, officer only.
 *
 * There is no draft farm and no empty farm: the schema requires the first
 * boundary in the same body, so a farm cannot exist without a walked ring.
 * `id` and `boundary_id` are both client-generated (C-9.1) -- a retry is the
 * same farm and the same boundary, never a second of either.
 *
 * The server computes the area, the centroid, the point count and the accuracy
 * grade. None of those are sent, and none may be.
 */
export async function createFarm(farmerId: string, input: CreateFarm): Promise<FarmWithCrops> {
  const body = await requestPage<FarmDto>(`/api/farmers/${encodeURIComponent(farmerId)}/farms`, {
    method: 'POST',
    body: JSON.stringify(createFarmSchema.parse(input)),
  });
  if (!body.data) throw new FarmApiError(500, 'empty', 'No farm in the response');
  return toFarm(body.data);
}

/**
 * RE-MAPPING. `POST /api/farms/:id/boundaries`, officer only.
 *
 * NOT a PATCH, and not an edit. A new boundary is INSERTED and becomes current
 * for its season; the one it replaces is kept with `is_current` false, so the
 * history of what the land was measured to be is never overwritten (C-7.5).
 * Mapping a season the farm has never had simply adds that season's first
 * boundary.
 */
export interface AddedBoundary {
  id: string;
  season: string;
  area_ha: number;
  grade: AccuracyFlag;
  point_count: number;
  is_current: boolean;
  /** The boundary this one replaced, when it replaced one. */
  superseded: string | null;
  gps_accuracy_m?: number;
}

export async function addBoundary(farmId: string, input: AddBoundary): Promise<AddedBoundary> {
  const body = await requestPage<FarmBoundaryRecord & { superseded: string | null }>(
    `/api/farms/${encodeURIComponent(farmId)}/boundaries`,
    { method: 'POST', body: JSON.stringify(addBoundarySchema.parse(input)) },
  );
  if (!body.data) throw new FarmApiError(500, 'empty', 'No boundary in the response');
  const d = body.data;
  return {
    id: d.id,
    season: d.season,
    area_ha: d.area_ha,
    grade: d.grade,
    point_count: d.point_count,
    is_current: d.is_current,
    superseded: d.superseded ?? null,
    // Absent when the caller is not entitled to it (C-7.8) -- not defaulted.
    ...(d.gps_accuracy_m === undefined ? {} : { gps_accuracy_m: d.gps_accuracy_m }),
  };
}

/** Every boundary of a farm, history included, newest season first (C-7.5). */
export async function listFarmBoundaries(farmId: string): Promise<FarmBoundaryRecord[]> {
  const body = await requestPage<FarmBoundaryRecord[]>(
    `/api/farms/${encodeURIComponent(farmId)}/boundaries`,
  );
  return body.data ?? [];
}

/**
 * DECLARING CROPS. `PUT /api/farms/:id/crops`, officer only.
 *
 * A REPLACE, not an append: the route deletes the season's declarations and
 * writes what it was given, so an empty list clears that season. Crops belong
 * to a farm AND a season, which is why the season travels with them.
 */
export async function declareCrops(
  farmId: string,
  input: DeclareCrops,
): Promise<{ season: string; crop: Crop }[]> {
  const body = await requestPage<{ season: string; crop: Crop }[]>(
    `/api/farms/${encodeURIComponent(farmId)}/crops`,
    { method: 'PUT', body: JSON.stringify(declareCropsSchema.parse(input)) },
  );
  return body.data ?? [];
}

/**
 * THE WHOLE FARM RECORD, unflattened. `GET /api/farms/:id`.
 *
 * `toFarm` exists for the screens that want one farm with one shape on it, and
 * it is LOSSY on purpose: it keeps a single current boundary and drops
 * `captured_at`. A farm mapped in both seasons of a year has TWO current
 * boundaries — one per season — and a review screen has to show both, so it
 * reads the record as the route actually returns it.
 *
 * Nothing is defaulted here. Keys the route omitted stay omitted.
 */
export interface FarmRecord {
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
  /** Current boundaries: one per season the farm has been mapped for. */
  boundaries: FarmBoundaryRecord[];
  crops: { season: string; crop: Crop }[];
}

export async function getFarmRecord(id: string): Promise<FarmRecord> {
  const body = await requestPage<FarmRecord>(`/api/farms/${encodeURIComponent(id)}`);
  if (!body.data) throw new FarmApiError(500, 'empty', 'No farm in the response');
  return body.data;
}

/** GET /api/farms/:id — one farm, scoped; out of scope is 404. */
export async function getFarm(id: string): Promise<FarmWithCrops> {
  const body = await requestPage<FarmDto>(`/api/farms/${encodeURIComponent(id)}`);
  if (!body.data) throw new FarmApiError(500, 'empty', 'No farm in the response');
  return toFarm(body.data);
}

/**
 * SOFT REMOVAL of a farm. `DELETE /api/farms/:id`, administrator only.
 *
 * The route stamps `deleted_at`. The farm leaves every list, count and export;
 * the row, its boundaries and its history remain. There is no hard delete in
 * this system and no route that restores a removed farm, so no screen should
 * offer either.
 */
export async function removeFarm(id: string): Promise<void> {
  await requestPage<unknown>(`/api/farms/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

interface PagedEnvelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string; rule?: string };
}

async function requestPage<T>(path: string, init?: RequestInit): Promise<PagedEnvelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return {};
  const body = (await res.json().catch(() => ({}))) as PagedEnvelope<T>;
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

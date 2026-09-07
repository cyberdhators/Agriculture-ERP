// Client data layer for farm boundaries and crop declarations. It calls the B7
// routes (`/api/farmers/:id/farms`, `/api/farms/:id`, `/api/farms/geojson`)
// through the standard response envelope (CONVENTIONS §3) and maps the API's
// `present()` shape onto the view types the screens render, so switching a
// screen from fixtures to live data is a source swap, not a rewrite.
// Authorization, scope and validation all live on the server; this module never
// talks to the database. Coordinates, GPS accuracy and the centroid are shown
// only to administrators and the boundary's mapping officer (C-7.8), so the
// server omits them for other roles and this client treats them as optional.

import type { AccuracyFlag, Crop, GeoJsonPolygon } from '@agri-erp/shared';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_FARMS=1`. Off = fixtures. */
export const LIVE_FARMS = process.env.NEXT_PUBLIC_USE_LIVE_FARMS === '1';

/** A GeoJSON point, present only when coordinates are visible to the role. */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
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

/* ---- API shapes (`present()`), the subset this client reads --------------- */

interface BoundaryDto {
  id: string;
  season: string;
  area_ha: number;
  grade: AccuracyFlag;
  point_count: number;
  mapped_by: string;
  mapped_at: string;
  is_current: boolean;
  /** C-7.8: present only for admins and the mapping officer. */
  gps_accuracy_m?: number;
  boundary?: GeoJsonPolygon;
  centroid?: GeoJsonPoint;
}

interface CropDto {
  season: string;
  crop: Crop;
}

interface FarmDto {
  id: string;
  farmer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  season: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  boundaries: BoundaryDto[];
  crops: CropDto[];
}

interface FeatureDto {
  type: 'Feature';
  id: string;
  geometry: GeoJsonPolygon;
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

/* ---- View types the screens render --------------------------------------- */

export interface FarmBoundaryView {
  id: string;
  season: string;
  areaHa: number;
  grade: AccuracyFlag;
  pointCount: number;
  mappedBy: string;
  mappedAt: string;
  isCurrent: boolean;
  /** Null when the role may not see coordinates (C-7.8). */
  gpsAccuracyM: number | null;
  boundary: GeoJsonPolygon | null;
  centroid: GeoJsonPoint | null;
}

export interface FarmCropView {
  season: string;
  crop: Crop;
}

export interface FarmView {
  id: string;
  farmerId: string;
  payamId: string;
  countyId: string;
  stateId: string;
  season: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  boundaries: FarmBoundaryView[];
  crops: FarmCropView[];
}

/** One current boundary as a coverage-map feature (`/api/farms/geojson`). */
export interface CoverageFeature {
  id: string;
  farmId: string;
  boundaryId: string;
  farmerId: string;
  payamId: string;
  countyId: string;
  stateId: string;
  season: string;
  areaHa: number;
  grade: AccuracyFlag;
  mappedAt: string;
  geometry: GeoJsonPolygon;
}

/* ---- Mappers ------------------------------------------------------------- */

/** Map one boundary. An absent geometry (hidden from lower roles) becomes null. */
export function toBoundary(row: BoundaryDto): FarmBoundaryView {
  return {
    id: row.id,
    season: row.season,
    areaHa: row.area_ha,
    grade: row.grade,
    pointCount: row.point_count,
    mappedBy: row.mapped_by,
    mappedAt: row.mapped_at,
    isCurrent: row.is_current,
    gpsAccuracyM: row.gps_accuracy_m ?? null,
    boundary: row.boundary ?? null,
    centroid: row.centroid ?? null,
  };
}

export function toFarm(row: FarmDto): FarmView {
  return {
    id: row.id,
    farmerId: row.farmer_id,
    payamId: row.payam_id,
    countyId: row.county_id,
    stateId: row.state_id,
    season: row.season,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    boundaries: (row.boundaries ?? []).map(toBoundary),
    crops: (row.crops ?? []).map((c) => ({ season: c.season, crop: c.crop })),
  };
}

export function toFeature(f: FeatureDto): CoverageFeature {
  const p = f.properties;
  return {
    id: f.id,
    farmId: p.farm_id,
    boundaryId: p.boundary_id,
    farmerId: p.farmer_id,
    payamId: p.payam_id,
    countyId: p.county_id,
    stateId: p.state_id,
    season: p.season,
    areaHa: p.area_ha,
    grade: p.grade,
    mappedAt: p.mapped_at,
    geometry: f.geometry,
  };
}

/* ---- Aggregate the register columns read (C-7) --------------------------- */

export interface FarmerFarmSummary {
  farmCount: number;
  totalAreaHa: number;
  crops: Crop[];
}

/** The latest-season current boundary carries a farm's area; older seasons are
 *  not summed, so the total is the area under cultivation, not a double count. */
function farmArea(farm: FarmView): number {
  let best: FarmBoundaryView | undefined;
  for (const b of farm.boundaries) {
    if (!best || b.season > best.season) best = b;
  }
  return best ? best.areaHa : 0;
}

export function summariseFarms(farms: readonly FarmView[]): FarmerFarmSummary {
  const crops = new Set<Crop>();
  let totalAreaHa = 0;
  for (const farm of farms) {
    totalAreaHa += farmArea(farm);
    for (const c of farm.crops) crops.add(c.crop);
  }
  return {
    farmCount: farms.length,
    totalAreaHa: Number(totalAreaHa.toFixed(2)),
    crops: [...crops],
  };
}

/* ---- Envelope + fetch ---------------------------------------------------- */

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string; rule?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
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

/* ---- Reads --------------------------------------------------------------- */

/** GET /api/farmers/:id/farms — a farmer's farms, scoped, geometry per C-7.8. */
export async function listFarmsForFarmer(farmerId: string): Promise<FarmView[]> {
  const body = await request<FarmDto[]>(
    `/api/farmers/${encodeURIComponent(farmerId)}/farms`,
  );
  return (body.data ?? []).map(toFarm);
}

/** GET /api/farms/:id — one farm with its current boundaries and crops. */
export async function getFarm(id: string): Promise<FarmView> {
  const body = await request<FarmDto>(`/api/farms/${encodeURIComponent(id)}`);
  if (!body.data) throw new FarmApiError(500, 'empty', 'No farm in the response');
  return toFarm(body.data);
}

export interface CoverageParams {
  payam?: string;
  season?: string;
  limit?: number;
  cursor?: string;
}

export interface CoverageResult {
  features: CoverageFeature[];
  cursor: string | null;
  hasMore: boolean;
}

/** GET /api/farms/geojson — visible current boundaries as a FeatureCollection
 *  (supervisor and administrator only). One page; follow `cursor` for more. */
export async function getFarmGeojson(params: CoverageParams = {}): Promise<CoverageResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  const body = await request<FeatureDto[]>(`/api/farms/geojson${query ? `?${query}` : ''}`);
  return {
    features: (body.data ?? []).map(toFeature),
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/** Follow the cursor to gather every visible boundary, capped so a very large
 *  state cannot hang the map. */
export async function getAllFarmGeojson(
  params: Omit<CoverageParams, 'cursor'> = {},
  maxPages = 20,
): Promise<CoverageFeature[]> {
  const features: CoverageFeature[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result: CoverageResult = await getFarmGeojson({
      ...params,
      cursor: cursor ?? undefined,
    });
    features.push(...result.features);
    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }
  return features;
}

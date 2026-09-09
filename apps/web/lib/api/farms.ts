import { toIso } from '@agri-erp/shared';
import { type Prisma } from '@prisma/client';
import { notFound } from './errors';
import { type BoundaryRow } from './geometry';
import { type Authenticated } from './require-role';

export interface FarmRow {
  id: string;
  farmer_id: string;
  payam_id: string;
  county_id: string;
  state_id: string;
  season: string;
  created_by: string;
  /** The device's moment (C-9.10); null reads "not recorded". */
  captured_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** The farmer's caseload officer: the caseload key (C-7.6, C-8R). */
  caseload_officer_id: string | null;
}

export interface CropRow {
  farm_id: string;
  season: string;
  crop: string;
}

export const FARM_COLUMNS = `
  f.id, f.farmer_id, f.payam_id, f.county_id, f.state_id, f.season, f.created_by, f.captured_at,
  f.created_at, f.updated_at, fr.caseload_officer_id`;
export const FARM_FROM = `FROM public.farm_active f JOIN public.farmer fr ON fr.id = f.farmer_id`;

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

/** Caseload: the farmer's caseload officer. State: the farm's state. Admin: all. */
export function farmScopeClause(auth: Authenticated, params: unknown[]): string[] {
  if (auth.scope.kind === 'state') {
    params.push(auth.scope.stateId);
    return [`f.state_id = $${params.length}`];
  }
  if (auth.scope.kind === 'caseload') {
    params.push(auth.scope.officerId);
    return [`fr.caseload_officer_id = $${params.length}::uuid`];
  }
  return [];
}

export async function loadVisibleFarm(db: Db, id: string, auth: Authenticated): Promise<FarmRow> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound();
  const params: unknown[] = [id];
  const where = ['f.id = $1::uuid', ...farmScopeClause(auth, params)];
  const [row] = await db.$queryRawUnsafe<FarmRow[]>(
    `SELECT ${FARM_COLUMNS} ${FARM_FROM} WHERE ${where.join(' AND ')}`,
    ...params,
  );
  if (!row) throw notFound();
  return row;
}

/** C-7.8: geometry and accuracy to administrators and the boundary's mapping officer only. */
export const canSeeGeometry = (auth: Authenticated, mappedBy: string): boolean =>
  auth.role === 'admin' || (auth.role === 'officer' && auth.principal.id === mappedBy);

export function presentBoundary(b: BoundaryRow, auth: Authenticated): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: b.id,
    season: b.season,
    area_ha: Number(b.area_ha),
    grade: b.accuracy_flag,
    point_count: b.point_count,
    mapped_by: b.mapped_by,
    mapped_at: toIso(b.mapped_at),
    is_current: b.is_current,
  };
  if (canSeeGeometry(auth, b.mapped_by)) {
    out.gps_accuracy_m = Number(b.gps_accuracy_m);
    out.boundary = JSON.parse(b.boundary_geojson) as unknown;
    out.centroid = JSON.parse(b.centroid_geojson) as unknown;
  }
  return out;
}

export function presentFarm(
  f: FarmRow,
  boundaries: readonly BoundaryRow[],
  crops: readonly CropRow[],
  auth: Authenticated,
): Record<string, unknown> {
  return {
    id: f.id,
    farmer_id: f.farmer_id,
    payam_id: f.payam_id,
    county_id: f.county_id,
    state_id: f.state_id,
    season: f.season,
    created_by: f.created_by,
    captured_at: f.captured_at ? toIso(f.captured_at) : null,
    created_at: toIso(f.created_at),
    updated_at: toIso(f.updated_at),
    boundaries: boundaries.filter((b) => b.farm_id === f.id).map((b) => presentBoundary(b, auth)),
    crops: crops.filter((c) => c.farm_id === f.id).map((c) => ({ season: c.season, crop: c.crop })),
  };
}

export async function cropsOf(db: Db, farmIds: readonly string[]): Promise<CropRow[]> {
  if (farmIds.length === 0) return [];
  return db.$queryRawUnsafe<CropRow[]>(
    `SELECT farm_id, season, crop::text AS crop FROM public.crop_declaration
     WHERE farm_id = ANY($1::uuid[]) ORDER BY season DESC, crop`,
    farmIds,
  );
}

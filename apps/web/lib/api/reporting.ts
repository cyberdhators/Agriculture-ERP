import {
  AGE_BANDS,
  AGE_BAND_NOTE,
  CROP_NOTE,
  type ReportFilter,
  VERIFIED_ONLY_NOTE,
  toIso,
} from '@agri-erp/shared';
import { type Prisma } from '@prisma/client';
import { type Authenticated } from './require-role';

/**
 * Reporting (C-10). One builder produces the figures and the export rows
 * from the same filters, so a figure and its export agree (C-10.9), and
 * returns the SQL it ran with its parameters inlined, so the export log can
 * hold the query that made the rows (C-10.8).
 *
 * Every people figure reads the farmer's own status through `farmer` with
 * deleted_at IS NULL; every land figure reads farms through the farmer as the
 * views now do (C-10.1). Land is located by the farm's payam, people by the
 * farmer's (C-10.4's note). Reach is distinct verified farmers with a visit
 * in the period, computed from visits at the server's moment (C-10.2, C-10.7).
 */

type Db = { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

export interface ResolvedFilter {
  /** The last instant of the cut-off day, UTC. */
  readonly cutoff: Date;
  readonly cutoffDate: string;
  readonly from: Date | null;
  readonly to: Date;
  readonly season: string | null;
  readonly state: string | null;
  readonly county: string | null;
  readonly payam: string | null;
}

export function resolveFilter(filter: ReportFilter, now = new Date()): ResolvedFilter {
  const cutoffDate = filter.cutoff ?? now.toISOString().slice(0, 10);
  const cutoff = new Date(`${cutoffDate}T23:59:59.999Z`);
  const to = filter.to ? new Date(filter.to) : cutoff;
  return {
    cutoff,
    cutoffDate,
    from: filter.from ? new Date(filter.from) : null,
    to: to.getTime() < cutoff.getTime() ? to : cutoff,
    season: filter.season ?? null,
    state: filter.state ?? null,
    county: filter.county ?? null,
    payam: filter.payam ?? null,
  };
}

/** SQL for the age band of a year of birth at the cut-off, generated from AGE_BANDS. */
const ageBandSql = (yearColumn: string, cutoffParam: string): string => {
  const age = `(extract(year from ${cutoffParam}::timestamptz)::int - ${yearColumn})`;
  const cases = AGE_BANDS.map((b) =>
    b.max === null
      ? `WHEN ${age} >= ${b.min} THEN '${b.key}'`
      : `WHEN ${age} BETWEEN ${b.min} AND ${b.max} THEN '${b.key}'`,
  );
  return `CASE ${cases.join(' ')} ELSE 'under_18' END`;
};

class Query {
  readonly params: unknown[] = [];
  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

/** Scope on the farmer alias `fr`, then the caller's narrowing filters, never beyond scope. */
function peopleWhere(q: Query, auth: Authenticated, f: ResolvedFilter, alias = 'fr'): string[] {
  const where = [
    `${alias}.deleted_at IS NULL`,
    `${alias}.created_at <= ${q.add(f.cutoff)}::timestamptz`,
  ];
  if (auth.scope.kind === 'state') where.push(`${alias}.state_id = ${q.add(auth.scope.stateId)}`);
  if (auth.scope.kind === 'caseload')
    where.push(`${alias}.caseload_officer_id = ${q.add(auth.scope.officerId)}::uuid`);
  if (f.state) where.push(`${alias}.state_id = ${q.add(f.state)}`);
  if (f.county) where.push(`${alias}.county_id = ${q.add(f.county)}`);
  if (f.payam) where.push(`${alias}.payam_id = ${q.add(f.payam)}`);
  return where;
}

/** Visits in the period by the server's moment, not removed, to farmers in scope. */
function visitWhere(q: Query, f: ResolvedFilter): string[] {
  const where = ['v.deleted_at IS NULL', `v.received_at <= ${q.add(f.to)}::timestamptz`];
  if (f.from) where.push(`v.received_at >= ${q.add(f.from)}::timestamptz`);
  return where;
}

/** The query as it ran, parameters inlined as literals, for the export log (C-10.8). */
export function inlineQuery(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)(::[a-z]+)?/g, (match, n: string, cast: string | undefined) => {
    const v = params[Number(n) - 1];
    if (v === undefined) return match;
    const literal =
      v instanceof Date
        ? `'${v.toISOString()}'`
        : typeof v === 'number'
          ? String(v)
          : `'${String(v).replace(/'/g, "''")}'`;
    return literal + (cast ?? '');
  });
}

export interface Breakdown {
  readonly key: string;
  readonly verified: number;
  readonly reached: number;
}

export interface Summary {
  readonly as_of: string;
  readonly period: { from: string | null; to: string };
  readonly season: string | null;
  readonly farmers: { verified: number; pending: number; rejected: number; merged: number };
  readonly reach: { farmers_reached: number; visits: number; other_farmers_visited: number };
  readonly land: { farms_mapped: number; hectares: number; farms_of_verified: number };
  readonly by: {
    sex: Breakdown[];
    age_band: Breakdown[];
    state: Breakdown[];
    county: Breakdown[];
    payam: Breakdown[];
    crop: { key: string; verified: number }[];
  };
  readonly notes: string[];
}

/** The latest season present in the caller's farms when none was asked for. */
async function seasonFor(db: Db, auth: Authenticated, f: ResolvedFilter): Promise<string | null> {
  if (f.season) return f.season;
  const q = new Query();
  const where = peopleWhere(q, auth, f);
  const [row] = await db.$queryRawUnsafe<{ season: string | null }[]>(
    `SELECT max(fm.season) AS season FROM public.farm fm JOIN public.farmer fr ON fr.id = fm.farmer_id
     WHERE fm.deleted_at IS NULL AND ${where.join(' AND ')}`,
    ...q.params,
  );
  return row?.season ?? null;
}

export async function summaryReport(
  db: Db,
  auth: Authenticated,
  filter: ReportFilter,
): Promise<{ summary: Summary; queries: string[] }> {
  const f = resolveFilter(filter);
  const season = await seasonFor(db, auth, f);
  const queries: string[] = [];
  const run = async <T>(sql: string, q: Query): Promise<T[]> => {
    queries.push(inlineQuery(sql, q.params));
    return db.$queryRawUnsafe<T[]>(sql, ...q.params);
  };

  // People, by status (C-10.3).
  let q = new Query();
  const [status] = await run<{
    verified: number;
    pending: number;
    rejected: number;
    merged: number;
  }>(
    `SELECT count(*) FILTER (WHERE fr.verification_status = 'verified')::int AS verified,
            count(*) FILTER (WHERE fr.verification_status = 'pending')::int  AS pending,
            count(*) FILTER (WHERE fr.verification_status = 'rejected')::int AS rejected,
            count(*) FILTER (WHERE fr.verification_status = 'merged')::int   AS merged
     FROM public.farmer fr WHERE ${peopleWhere(q, auth, f).join(' AND ')}`,
    q,
  );

  // Reach: distinct verified farmers with a visit in the period (C-10.2, C-10.7).
  q = new Query();
  const [reach] = await run<{
    farmers_reached: number;
    visits: number;
    other_farmers_visited: number;
  }>(
    `SELECT count(DISTINCT v.farmer_id) FILTER (WHERE fr.verification_status = 'verified')::int AS farmers_reached,
            count(*) FILTER (WHERE fr.verification_status = 'verified')::int AS visits,
            count(DISTINCT v.farmer_id) FILTER (WHERE fr.verification_status <> 'verified')::int AS other_farmers_visited
     FROM public.visit v JOIN public.farmer fr ON fr.id = v.farmer_id
     WHERE ${[...visitWhere(q, f), ...peopleWhere(q, auth, f)].join(' AND ')}`,
    q,
  );

  // Land: through the farmer; located by the farm's payam (C-10.1, C-10.4).
  q = new Query();
  const landWhere = [
    'fm.deleted_at IS NULL',
    'fr.deleted_at IS NULL',
    `fm.created_at <= ${q.add(f.cutoff)}::timestamptz`,
    ...(auth.scope.kind === 'state' ? [`fr.state_id = ${q.add(auth.scope.stateId)}`] : []),
    ...(auth.scope.kind === 'caseload'
      ? [`fr.caseload_officer_id = ${q.add(auth.scope.officerId)}::uuid`]
      : []),
    ...(f.state ? [`fm.state_id = ${q.add(f.state)}`] : []),
    ...(f.county ? [`fm.county_id = ${q.add(f.county)}`] : []),
    ...(f.payam ? [`fm.payam_id = ${q.add(f.payam)}`] : []),
  ];
  const seasonParam = season ? q.add(season) : null;
  const [land] = await run<{ farms_mapped: number; hectares: string; farms_of_verified: number }>(
    `SELECT count(DISTINCT fm.id) FILTER (WHERE b.id IS NOT NULL)::int AS farms_mapped,
            coalesce(sum(b.area_ha), 0)::text AS hectares,
            count(DISTINCT fm.id) FILTER (WHERE fr.verification_status = 'verified')::int AS farms_of_verified
     FROM public.farm fm JOIN public.farmer fr ON fr.id = fm.farmer_id
     LEFT JOIN public.farm_boundary b ON b.farm_id = fm.id AND b.is_current AND b.accuracy_flag <> 'unusable'
       ${seasonParam ? `AND b.season = ${seasonParam}` : 'AND false'}
     WHERE ${landWhere.join(' AND ')}`,
    q,
  );

  // Breakdowns (C-10.4): verified farmers and those reached, by each dimension.
  const breakdown = async (dimension: string): Promise<Breakdown[]> => {
    const q2 = new Query();
    const cutoffParam = q2.add(f.cutoff);
    const dim =
      dimension === 'age_band'
        ? ageBandSql('fr.year_of_birth', cutoffParam)
        : dimension === 'sex'
          ? 'fr.sex::text'
          : `fr.${dimension}_id`;
    const rows = await run<{ key: string; verified: number; reached: number }>(
      `SELECT ${dim} AS key,
              count(*)::int AS verified,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM public.visit v WHERE v.farmer_id = fr.id AND ${visitWhere(q2, f).join(' AND ')}
              ))::int AS reached
       FROM public.farmer fr
       WHERE fr.verification_status = 'verified' AND ${peopleWhere(q2, auth, f).join(' AND ')}
       GROUP BY 1 ORDER BY 1`,
      q2,
    );
    return rows.map((r) => ({ key: r.key, verified: r.verified, reached: r.reached }));
  };
  const [bySex, byAge, byState, byCounty, byPayam] = await Promise.all([
    breakdown('sex'),
    breakdown('age_band'),
    breakdown('state'),
    breakdown('county'),
    breakdown('payam'),
  ]);

  // By crop (C-10.6): a farmer once per crop with at least one farm declaring it in the season.
  q = new Query();
  const cropSeason = season ? q.add(season) : null;
  const byCrop = cropSeason
    ? await run<{ key: string; verified: number }>(
        `SELECT c.crop::text AS key, count(DISTINCT fr.id)::int AS verified
         FROM public.farmer fr
         JOIN public.farm fm ON fm.farmer_id = fr.id AND fm.deleted_at IS NULL
         JOIN public.crop_declaration c ON c.farm_id = fm.id AND c.season = ${cropSeason}
         WHERE fr.verification_status = 'verified' AND ${peopleWhere(q, auth, f).join(' AND ')}
         GROUP BY 1 ORDER BY 1`,
        q,
      )
    : [];

  return {
    summary: {
      as_of: toIso(f.cutoff),
      period: { from: f.from ? toIso(f.from) : null, to: toIso(f.to) },
      season,
      farmers: status ?? { verified: 0, pending: 0, rejected: 0, merged: 0 },
      reach: reach ?? { farmers_reached: 0, visits: 0, other_farmers_visited: 0 },
      land: {
        farms_mapped: land?.farms_mapped ?? 0,
        hectares: Number(land?.hectares ?? 0),
        farms_of_verified: land?.farms_of_verified ?? 0,
      },
      by: {
        sex: bySex,
        age_band: byAge,
        state: byState,
        county: byCounty,
        payam: byPayam,
        crop: byCrop,
      },
      notes: [VERIFIED_ONLY_NOTE, AGE_BAND_NOTE, CROP_NOTE],
    },
    queries,
  };
}

export interface FarmerExportRow {
  farmer_number: string;
  verification_status: string;
  sex: string;
  age_band: string;
  state_id: string;
  county_id: string;
  payam_id: string;
  registered_at: Date;
  reached: boolean;
}

/**
 * The farmer-list export (C-10.11): farmer numbers only. No name, phone or
 * national ID is selected, so none can leak by a later presenter's mistake.
 */
export async function farmersExport(
  db: Db,
  auth: Authenticated,
  filter: ReportFilter,
): Promise<{ rows: FarmerExportRow[]; query: string; as_of: string }> {
  const f = resolveFilter(filter);
  const q = new Query();
  const cutoffParam = q.add(f.cutoff);
  const sql = `SELECT fr.farmer_number, fr.verification_status::text AS verification_status, fr.sex::text AS sex,
            ${ageBandSql('fr.year_of_birth', cutoffParam)} AS age_band,
            fr.state_id, fr.county_id, fr.payam_id, fr.created_at AS registered_at,
            EXISTS (SELECT 1 FROM public.visit v WHERE v.farmer_id = fr.id AND ${visitWhere(q, f).join(' AND ')}) AS reached
     FROM public.farmer fr
     WHERE ${peopleWhere(q, auth, f).join(' AND ')}
     ORDER BY fr.state_id, fr.county_id, fr.payam_id, fr.farmer_number`;
  const rows = await db.$queryRawUnsafe<FarmerExportRow[]>(sql, ...q.params);
  return { rows, query: inlineQuery(sql, q.params), as_of: toIso(f.cutoff) };
}

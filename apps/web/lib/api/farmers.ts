import { formatFarmerNumber, toIso } from '@agri-erp/shared';
import { Prisma } from '@prisma/client';
import { type AuditTx } from './audit';
import { conflict, notFound } from './errors';
import { type Authenticated } from './require-role';

/**
 * Shared by the two farmer routes (C-5). Everything that decides what a
 * caller may see lives here once, so the list and the item cannot disagree.
 */

export interface FarmerRow {
  id: string;
  farmer_number: string;
  given_name: string;
  family_name: string;
  sex: string;
  year_of_birth: number;
  phone: string;
  national_id: string | null;
  payam_id: string;
  county_id: string;
  state_id: string;
  registered_by: string | null;
  registration_source: string;
  verification_status: string;
  merged_into: string | null;
  duplicate_flag: boolean;
  duplicate_matches: string[];
  created_at: Date;
  updated_at: Date;
  consent_id: string;
  consent_text_version: string;
  consent_language: string;
  consent_granted_at: Date;
}

/** Selected from farmer (f) joined to its current consent (c). */
export const FARMER_COLUMNS = `
  f.id, f.farmer_number, f.given_name, f.family_name, f.sex::text AS sex, f.year_of_birth,
  f.phone, f.national_id, f.payam_id, f.county_id, f.state_id, f.registered_by,
  f.registration_source::text AS registration_source,
  f.verification_status::text AS verification_status, f.merged_into,
  f.duplicate_flag, f.duplicate_matches, f.created_at, f.updated_at,
  c.id AS consent_id, c.text_version AS consent_text_version,
  c.language::text AS consent_language, c.granted_at AS consent_granted_at`;

export const FARMER_FROM = `FROM public.farmer_active f JOIN public.consent c ON c.id = f.consent_id`;

/**
 * C-5.8: the national ID is returned only to an administrator and to the
 * officer who registered that farmer. For anyone else the key is ABSENT, not
 * masked — a masked field still says one exists.
 */
export const canSeeNationalId = (auth: Authenticated, row: FarmerRow): boolean =>
  auth.role === 'admin' || (auth.role === 'officer' && row.registered_by === auth.principal.id);

export function present(row: FarmerRow, auth: Authenticated): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    farmer_number: row.farmer_number,
    given_name: row.given_name,
    family_name: row.family_name,
    sex: row.sex,
    year_of_birth: row.year_of_birth,
    phone: row.phone,
    payam_id: row.payam_id,
    county_id: row.county_id,
    state_id: row.state_id,
    registered_by: row.registered_by,
    registration_source: row.registration_source,
    verification_status: row.verification_status,
    merged_into: row.merged_into,
    duplicate_flag: row.duplicate_flag,
    duplicate_matches: row.duplicate_matches,
    consent: {
      id: row.consent_id,
      text_version: row.consent_text_version,
      language: row.consent_language,
      granted_at: toIso(row.consent_granted_at),
    },
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
  if (canSeeNationalId(auth, row)) out.national_id = row.national_id;
  return out;
}

/** The scope clause for lists and item loads. An officer's caseload is what they registered. */
export function scopeClause(auth: Authenticated, params: unknown[]): string[] {
  if (auth.scope.kind === 'state') {
    params.push(auth.scope.stateId);
    return [`f.state_id = $${params.length}`];
  }
  if (auth.scope.kind === 'caseload') {
    params.push(auth.scope.officerId);
    return [`f.registered_by = $${params.length}::uuid`];
  }
  return [];
}

type Db =
  Prisma.TransactionClient | { $queryRawUnsafe: Prisma.TransactionClient['$queryRawUnsafe'] };

/** 404 for not-found and for out-of-scope alike (C-3.5, C-5.7). */
export async function loadVisible(db: Db, id: string, auth: Authenticated): Promise<FarmerRow> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound();
  const params: unknown[] = [id];
  const conditions = ['f.id = $1::uuid', ...scopeClause(auth, params)];
  const [row] = await db.$queryRawUnsafe<FarmerRow[]>(
    `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE ${conditions.join(' AND ')}`,
    ...params,
  );
  if (!row) throw notFound();
  return row;
}

/**
 * C-5.6: same phone, or same given + family name in the same payam, compared
 * trimmed / NFC / lower-cased — the same three steps, in the same order, as
 * the index farmer_name_payam_idx. Returns ids only. Never blocks.
 */
export async function findDuplicates(
  tx: AuditTx,
  farmer: {
    id: string;
    phone: string;
    given_name: string;
    family_name: string;
    payam_id: string;
  },
): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT f.id FROM public.farmer_active f
     WHERE f.id <> $1::uuid
       AND (
         f.phone = $2
         OR (
           lower(normalize(trim(f.family_name), NFC)) = lower(normalize(trim($3::text), NFC))
           AND lower(normalize(trim(f.given_name), NFC)) = lower(normalize(trim($4::text), NFC))
           AND f.payam_id = $5
         )
       )
     ORDER BY f.created_at, f.id`,
    farmer.id,
    farmer.phone,
    farmer.family_name,
    farmer.given_name,
    farmer.payam_id,
  );
  return rows.map((r) => r.id);
}

/** Writes the flag and the matched ids. Called after every insert and after any change of phone or name. */
export async function recordDuplicates(tx: AuditTx, id: string, matches: string[]): Promise<void> {
  await tx.$executeRawUnsafe(
    `UPDATE public.farmer SET duplicate_flag = $2, duplicate_matches = $3::uuid[] WHERE id = $1::uuid`,
    id,
    matches.length > 0,
    matches,
  );
}

/**
 * C-5.4. One upsert on the county's counter row. The row lock the upsert
 * takes is what serialises concurrent registrations in the same county; the
 * UNIQUE on farmer.farmer_number is the backstop, not the mechanism.
 */
export async function allocateFarmerNumber(tx: AuditTx, countyId: string): Promise<string> {
  const [row] = await tx.$queryRawUnsafe<{ n: number }[]>(
    `INSERT INTO public.farmer_number_counter (county_id, next_value) VALUES ($1, 2)
     ON CONFLICT (county_id) DO UPDATE SET next_value = public.farmer_number_counter.next_value + 1
     RETURNING next_value - 1 AS n`,
    countyId,
  );
  if (!row) throw new Error('farmer number allocation returned no row');
  return formatFarmerNumber(countyId, row.n);
}

/** A raw INSERT that hits farmer_pkey is a repeat of the same client id (C-5.12). Anything else is not ours to hide. */
export function rethrowAsConflictIfSameId(failure: unknown): never {
  if (
    failure instanceof Prisma.PrismaClientKnownRequestError &&
    failure.code === 'P2010' &&
    String((failure.meta as { message?: unknown } | undefined)?.message ?? '').includes(
      'farmer_pkey',
    )
  ) {
    throw conflict('farmer_already_exists');
  }
  throw failure;
}

/** The audit-safe view of a farmer: every key here is a value that names no person. */
export const auditFields = (row: FarmerRow): Record<string, unknown> => ({
  farmer_number: row.farmer_number,
  sex: row.sex,
  year_of_birth: row.year_of_birth,
  payam_id: row.payam_id,
  county_id: row.county_id,
  state_id: row.state_id,
  registered_by: row.registered_by,
  registration_source: row.registration_source,
  verification_status: row.verification_status,
  duplicate_flag: row.duplicate_flag,
  duplicate_matches: row.duplicate_matches,
});

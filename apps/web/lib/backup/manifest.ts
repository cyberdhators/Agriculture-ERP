import { VISIT_ATTACHMENT_BUCKET } from '@agri-erp/shared';
import type { PrismaClient } from '@prisma/client';

/**
 * The manifest (C-11.5) and its comparison, and the two things a restore
 * writes (C-11.3, C-11.4). Pure where it can be: `compareManifests` takes two
 * manifests and returns differences; the database and Storage are reached
 * only by the functions that say so in their names.
 *
 * A manifest is taken before a backup and again after a restore. The
 * comparison is the proof of the drill (C-11.7): every migration equal, every
 * count explained by the recovery point.
 */

export interface Manifest {
  readonly taken_at: string;
  readonly database: string;
  readonly migrations: readonly string[];
  readonly tables: Readonly<Record<string, number>>;
  readonly last_audit: { id: string; occurred_at: string; action: string } | null;
  readonly attachments_arrived: number;
  readonly storage_objects: number | null;
}

/** The tables a backup must carry. A table not here is a finding, not an omission. */
export const MANIFEST_TABLES = [
  'state',
  'county',
  'payam',
  'location_bundle',
  'user',
  'officer',
  'farmer',
  'consent',
  'farmer_number_counter',
  'verification_event',
  'farm',
  'farm_boundary',
  'crop_declaration',
  'visit',
  'visit_attachment',
  'directory_entry',
  'learning_resource',
  'report_export',
  'audit_event',
] as const;

export async function takeManifest(
  prisma: PrismaClient,
  databaseLabel: string,
  countStorageObjects: (() => Promise<number>) | null,
): Promise<Manifest> {
  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  );
  const tables: Record<string, number> = {};
  for (const table of MANIFEST_TABLES) {
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public."${table}"`,
    );
    tables[table] = row?.n ?? 0;
  }
  const [last] = await prisma.$queryRawUnsafe<{ id: string; occurred_at: Date; action: string }[]>(
    `SELECT id, occurred_at, action FROM public.audit_event ORDER BY occurred_at DESC, id DESC LIMIT 1`,
  );
  const [arrived] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM public.visit_attachment WHERE status = 'arrived'`,
  );
  return {
    taken_at: new Date().toISOString(),
    database: databaseLabel,
    migrations: migrations.map((m) => m.migration_name),
    tables,
    last_audit: last
      ? { id: last.id, occurred_at: last.occurred_at.toISOString(), action: last.action }
      : null,
    attachments_arrived: arrived?.n ?? 0,
    storage_objects: countStorageObjects ? await countStorageObjects() : null,
  };
}

export interface Difference {
  readonly what: string;
  readonly before: string | number | null;
  readonly after: string | number | null;
  /** True when the difference is one the recovery point explains: rows that existed only after the restore point. */
  readonly explained_by_recovery_point: boolean;
}

/**
 * Compares the manifest taken before the backup with the one taken after the
 * restore. Migrations must be identical. A table may have FEWER rows after —
 * that is what a recovery point means — and never more. The audit log's last
 * entry may be earlier, never later. Storage counts are compared only when
 * both manifests have one.
 */
export function compareManifests(before: Manifest, after: Manifest): Difference[] {
  const out: Difference[] = [];
  const bm = new Set(before.migrations);
  const am = new Set(after.migrations);
  for (const m of before.migrations) {
    if (!am.has(m))
      out.push({
        what: `migration ${m}`,
        before: 'applied',
        after: 'missing',
        explained_by_recovery_point: false,
      });
  }
  for (const m of after.migrations) {
    if (!bm.has(m))
      out.push({
        what: `migration ${m}`,
        before: 'missing',
        after: 'applied',
        explained_by_recovery_point: false,
      });
  }
  for (const table of MANIFEST_TABLES) {
    const b = before.tables[table] ?? 0;
    const a = after.tables[table] ?? 0;
    if (a !== b) {
      out.push({
        what: `rows in ${table}`,
        before: b,
        after: a,
        explained_by_recovery_point: a < b,
      });
    }
  }
  const lb = before.last_audit;
  const la = after.last_audit;
  if ((lb?.id ?? null) !== (la?.id ?? null)) {
    const earlier =
      lb !== null &&
      la !== null &&
      new Date(la.occurred_at).getTime() <= new Date(lb.occurred_at).getTime();
    out.push({
      what: 'last audit entry',
      before: lb ? `${lb.id} ${lb.action} at ${lb.occurred_at}` : null,
      after: la ? `${la.id} ${la.action} at ${la.occurred_at}` : null,
      explained_by_recovery_point: earlier,
    });
  }
  if (before.attachments_arrived !== after.attachments_arrived) {
    out.push({
      what: 'attachments arrived',
      before: before.attachments_arrived,
      after: after.attachments_arrived,
      explained_by_recovery_point: after.attachments_arrived < before.attachments_arrived,
    });
  }
  if (
    before.storage_objects !== null &&
    after.storage_objects !== null &&
    before.storage_objects !== after.storage_objects
  ) {
    out.push({
      what: 'objects in the bucket',
      before: before.storage_objects,
      after: after.storage_objects,
      // Storage is not restored by a database restore: a difference here is never explained, it is the C-11.3 case.
      explained_by_recovery_point: false,
    });
  }
  return out;
}

/** Verified means: no difference the recovery point does not explain. */
export const isVerified = (differences: readonly Difference[]): boolean =>
  differences.every((d) => d.explained_by_recovery_point);

export interface RestoreRecord {
  readonly backup: string;
  readonly recovery_point: string;
  readonly performed_by: string;
  readonly before: Manifest;
  readonly after: Manifest;
}

/**
 * C-11.4: the first write into a restored database. Actor `system`, action
 * `system.restored`, carrying the backup identity, the recovery point, who
 * performed it, the last audit entry before the gap and the first after.
 * Written directly, not through `writeAudit`: there is no request, no
 * principal and no route here, and the entry must exist before anything else
 * touches the restored database.
 */
export async function recordRestore(prisma: PrismaClient, record: RestoreRecord): Promise<string> {
  const [first] = await prisma.$queryRawUnsafe<{ id: string; occurred_at: Date; action: string }[]>(
    `SELECT id, occurred_at, action FROM public.audit_event WHERE occurred_at > $1::timestamptz ORDER BY occurred_at, id LIMIT 1`,
    record.recovery_point,
  );
  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, before, after)
     VALUES ('database', $1, 'system', NULL, 'system.restored', $2::jsonb, $3::jsonb) RETURNING id`,
    record.after.database,
    JSON.stringify({
      last_audit_before_gap: record.before.last_audit,
      tables: record.before.tables,
      manifest_taken_at: record.before.taken_at,
    }),
    JSON.stringify({
      backup: record.backup,
      recovery_point: record.recovery_point,
      performed_by: record.performed_by,
      first_audit_after_gap: first
        ? { id: first.id, occurred_at: first.occurred_at.toISOString(), action: first.action }
        : null,
      last_audit_in_restored: record.after.last_audit,
      tables: record.after.tables,
      manifest_taken_at: record.after.taken_at,
    }),
  );
  return row!.id;
}

/**
 * C-11.3: every attachment marked arrived whose object is absent from Storage
 * becomes failed, `lost_on_restore`, with one system audit entry each. The
 * caller supplies the existence check so this module never reaches Storage
 * on its own.
 */
export async function correctLostAttachments(
  prisma: PrismaClient,
  objectExists: (path: string) => Promise<boolean>,
): Promise<{ checked: number; lost: string[] }> {
  const arrived = await prisma.$queryRawUnsafe<
    { id: string; visit_id: string; storage_path: string }[]
  >(
    `SELECT id, visit_id, storage_path FROM public.visit_attachment WHERE status = 'arrived' ORDER BY created_at`,
  );
  const lost: string[] = [];
  for (const a of arrived) {
    if (await objectExists(a.storage_path)) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE public.visit_attachment
       SET status = 'failed', arrived_at = NULL, failed_at = now(), failure_code = 'lost_on_restore', updated_at = now()
       WHERE id = $1::uuid AND status = 'arrived'`,
      a.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, before, after)
       VALUES ('visit', $1, 'system', NULL, 'visit.attachment_failed', $2::jsonb, $3::jsonb)`,
      a.visit_id,
      JSON.stringify({ attachment_id: a.id, status: 'arrived' }),
      JSON.stringify({ attachment_id: a.id, status: 'failed', failure_code: 'lost_on_restore' }),
    );
    lost.push(a.id);
  }
  return { checked: arrived.length, lost };
}

export const ATTACHMENT_BUCKET = VISIT_ATTACHMENT_BUCKET;

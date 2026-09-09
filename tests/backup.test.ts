import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as farmerVisits from '../apps/web/app/api/farmers/[id]/visits/route';
import * as farmers from '../apps/web/app/api/farmers/route';
import * as attachmentConfirm from '../apps/web/app/api/visits/[id]/attachments/[aid]/confirm/route';
import * as visitAttachments from '../apps/web/app/api/visits/[id]/attachments/route';
import * as visitItem from '../apps/web/app/api/visits/[id]/route';
import {
  MANIFEST_TABLES,
  type Manifest,
  compareManifests,
  correctLostAttachments,
  isVerified,
  recordRestore,
  takeManifest,
} from '../apps/web/lib/backup/manifest';
import { removeStoredObject } from '../apps/web/lib/supabase/admin';
import { ATTACHMENT_FAILURE_MESSAGES, VISIT_ATTACHMENT_BUCKET } from '../packages/shared/src/visit';
import { makeTestPrisma, requireTestEnv } from './helpers/db';
import {
  FARMER_TEST_FAMILY,
  type TestPrincipal,
  createPrincipal,
  sweep,
} from './helpers/principals';
import { ADVICE, checked, data } from './helpers/scan';

/**
 * B11 — the manifest, the comparison, the restore entry and the correction of
 * lost attachments (C-11.3, C-11.4, C-11.5, C-11.11). The restore itself is a
 * human act on the dashboard; these are the scripts that prove it, run here
 * against staging as they would be against a restored database.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });
requireTestEnv();
const run = describe;
const prisma = makeTestPrisma();

let admin: TestPrincipal & { password: string };
let officerA: TestPrincipal & { password: string };
let phoneSeq = 3_500_000;
const FAKE_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.from('zztest-not-a-real-photo-'.repeat(20)),
  Buffer.from([0xff, 0xd9]),
]);
const uploadedPaths: string[] = [];

beforeAll(async () => {
  await sweep(prisma);
  admin = await createPrincipal(prisma, 'admin');
  officerA = await createPrincipal(prisma, 'officer', { payamId: 'CE-JUB-MUN' });
});
afterAll(async () => {
  for (const path of new Set(uploadedPaths)) {
    await removeStoredObject(VISIT_ATTACHMENT_BUCKET, path).catch(() => {});
  }
  await sweep(prisma);
  await prisma.$disconnect();
});

const independentCount = async (table: string) =>
  (
    await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public."${table}"`,
    )
  )[0]!.n;

run('the manifest (C-11.5)', () => {
  it('equals independent counts for every table it lists, names every applied migration, and knows the last audit entry', async () => {
    const m = await takeManifest(prisma, 'zztest', async () => 7);
    for (const table of MANIFEST_TABLES) {
      expect(m.tables[table], table).toBe(await independentCount(table));
    }
    const applied = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM public._prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    expect(m.migrations.length).toBe(applied[0]!.n);
    expect(m.migrations).toContain('20260909090000_restore_recorded');
    const [last] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public.audit_event ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    );
    expect(m.last_audit?.id).toBe(last?.id);
    expect(m.storage_objects).toBe(7);
    expect(m.database).toBe('zztest');
    // Every table a backup must carry is a real table: a renamed table would be a finding here, not a silent zero.
    for (const table of MANIFEST_TABLES) {
      const [exists] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        table,
      );
      expect(exists?.n, `${table} exists`).toBe(1);
    }
  });

  it('the comparison explains fewer rows and an earlier audit entry by the recovery point, and never a missing migration, more rows, or a bucket that differs', () => {
    const before: Manifest = {
      taken_at: '2026-09-09T10:00:00.000Z',
      database: 'source',
      migrations: ['a', 'b', 'c'],
      tables: { farmer: 100, visit: 40, audit_event: 900 },
      last_audit: { id: 'x9', occurred_at: '2026-09-09T09:59:00.000Z', action: 'visit.recorded' },
      attachments_arrived: 12,
      storage_objects: 12,
    };
    const restored: Manifest = {
      ...before,
      taken_at: '2026-09-09T12:00:00.000Z',
      database: 'target',
      tables: { farmer: 98, visit: 37, audit_event: 880 },
      last_audit: { id: 'x1', occurred_at: '2026-09-09T08:00:00.000Z', action: 'farmer.created' },
      attachments_arrived: 11,
    };
    const ok = compareManifests(before, restored);
    expect(ok.length).toBe(5);
    expect(ok.every((d) => d.explained_by_recovery_point)).toBe(true);
    expect(isVerified(ok)).toBe(true);

    const wrong = compareManifests(before, {
      ...restored,
      migrations: ['a', 'b'],
      tables: { farmer: 101, visit: 37, audit_event: 880 },
      storage_objects: 3,
    });
    const unexplained = wrong.filter((d) => !d.explained_by_recovery_point).map((d) => d.what);
    expect(unexplained).toEqual(['migration c', 'rows in farmer', 'objects in the bucket']);
    expect(isVerified(wrong)).toBe(false);
    // A later audit entry after a restore is not a recovery point: it is a different database.
    const later = compareManifests(before, {
      ...restored,
      last_audit: { id: 'z', occurred_at: '2026-09-09T11:00:00.000Z', action: 'farmer.created' },
    });
    expect(later.find((d) => d.what === 'last audit entry')?.explained_by_recovery_point).toBe(
      false,
    );
    // Identical manifests: nothing to explain.
    expect(compareManifests(before, before)).toEqual([]);
  });
});

run('the restore leaves a note (C-11.4) and corrects lost attachments (C-11.3)', () => {
  it('system.restored is written as the system’s, carrying the backup, the recovery point, who, and the gap’s two ends', async () => {
    const before = await takeManifest(prisma, 'source', null);
    const recoveryPoint = new Date(Date.now() - 60_000).toISOString();
    // Something happened after the recovery point: a farmer registered now.
    const r = await checked(farmers, 'POST', {
      as: officerA,
      body: {
        id: randomUUID(),
        given_name: 'Zzrestore',
        family_name: FARMER_TEST_FAMILY,
        sex: 'f',
        year_of_birth: 1985,
        phone: `+21195${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
        payam_id: 'CE-JUB-MUN',
        consent: { text_version: 'v1.0-en', language: 'en', granted: true },
      },
    });
    expect(r.status).toBe(201);
    const after = await takeManifest(prisma, 'target', null);
    const id = await recordRestore(prisma, {
      backup: 'zztest-backup-2026-09-09',
      recovery_point: recoveryPoint,
      performed_by: 'Zztest Administrator',
      before,
      after,
    });
    const [row] = await prisma.$queryRawUnsafe<
      {
        actor_type: string;
        actor_id: string | null;
        entity_type: string;
        entity_id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }[]
    >(
      `SELECT actor_type::text AS actor_type, actor_id, entity_type, entity_id, before, after FROM public.audit_event WHERE id = $1::uuid`,
      id,
    );
    expect(row).toMatchObject({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'database',
      entity_id: 'target',
    });
    expect(row!.after).toMatchObject({
      backup: 'zztest-backup-2026-09-09',
      recovery_point: recoveryPoint,
      performed_by: 'Zztest Administrator',
    });
    expect((row!.after.first_audit_after_gap as { action: string }).action).toBe('farmer.created');
    expect(row!.before).toHaveProperty('last_audit_before_gap');
    expect(JSON.stringify(row)).not.toContain('Zzrestore');
    // The audit table's own rule: the entry cannot be changed or removed afterwards.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE public.audit_event SET action = 'farmer.created' WHERE id = $1::uuid`,
        id,
      ),
    ).rejects.toThrow();
  });

  it('an arrived attachment whose file is gone becomes failed lost_on_restore with the sentence and a system audit entry; one whose file exists is untouched', async () => {
    const f = await checked(farmers, 'POST', {
      as: officerA,
      body: {
        id: randomUUID(),
        given_name: 'Zzlost',
        family_name: FARMER_TEST_FAMILY,
        sex: 'm',
        year_of_birth: 1979,
        phone: `+21195${String(1_000_000 + (phoneSeq += 1)).padStart(7, '0')}`,
        payam_id: 'CE-JUB-MUN',
        consent: { text_version: 'v1.0-en', language: 'en', granted: true },
      },
    });
    const visit = data(
      await checked(farmerVisits, 'POST', {
        as: officerA,
        params: { id: data(f).id as string },
        body: {
          id: randomUUID(),
          visited_at: new Date(Date.now() - 3_600_000).toISOString(),
          position: { type: 'Point', coordinates: [31.6004, 4.8503] },
          gps_accuracy_m: 6,
          advice: ADVICE,
          topics: ['weeding'],
        },
      }),
    );
    const declareAndArrive = async () => {
      const declared = data(
        await checked(visitAttachments, 'POST', {
          as: officerA,
          params: { id: visit.id as string },
          body: {
            id: randomUUID(),
            kind: 'photo',
            content_type: 'image/jpeg',
            byte_size: FAKE_JPEG.length,
            captured_at: new Date().toISOString(),
          },
        }),
      );
      const url = (declared.upload as { url: string }).url;
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
        body: new Uint8Array(FAKE_JPEG),
      });
      expect(put.status).toBe(200);
      const path = decodeURIComponent(
        new URL(url).pathname.split('/object/upload/sign/')[1] ?? '',
      ).replace(`${VISIT_ATTACHMENT_BUCKET}/`, '');
      uploadedPaths.push(path);
      const confirmed = await checked(attachmentConfirm, 'POST', {
        as: officerA,
        params: { id: visit.id as string, aid: declared.id as string },
        body: {},
      });
      expect(confirmed.status).toBe(200);
      return { id: declared.id as string, path };
    };
    const kept = await declareAndArrive();
    const lost = await declareAndArrive();
    // The restore did not bring this file back.
    await removeStoredObject(VISIT_ATTACHMENT_BUCKET, lost.path);

    const { describeStoredObject } = await import('../apps/web/lib/supabase/admin');
    const result = await correctLostAttachments(
      prisma,
      async (path) => (await describeStoredObject(VISIT_ATTACHMENT_BUCKET, path)) !== null,
    );
    expect(result.checked).toBeGreaterThanOrEqual(2);
    expect(result.lost).toContain(lost.id);
    expect(result.lost).not.toContain(kept.id);

    const shown = data(
      await checked(visitItem, 'GET', { as: admin, params: { id: visit.id as string } }),
    );
    const byId = Object.fromEntries(
      (
        shown.attachments as {
          id: string;
          status: string;
          failure_code: string | null;
          message: string;
        }[]
      ).map((a) => [a.id, a]),
    );
    expect(byId[lost.id]).toMatchObject({
      status: 'failed',
      failure_code: 'lost_on_restore',
      message: ATTACHMENT_FAILURE_MESSAGES.lost_on_restore,
    });
    expect(byId[kept.id]).toMatchObject({ status: 'arrived' });
    const audit = await prisma.$queryRawUnsafe<
      { actor_type: string; after: { failure_code?: string } }[]
    >(
      `SELECT actor_type::text AS actor_type, after FROM public.audit_event WHERE entity_type = 'visit' AND entity_id = $1 AND action = 'visit.attachment_failed'`,
      visit.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: 'system',
      after: { failure_code: 'lost_on_restore' },
    });
    // Running it again changes nothing: the correction is idempotent.
    const again = await correctLostAttachments(
      prisma,
      async (path) => (await describeStoredObject(VISIT_ATTACHMENT_BUCKET, path)) !== null,
    );
    expect(again.lost).toEqual([]);
  });
});

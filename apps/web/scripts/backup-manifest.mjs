// Takes a manifest of the database the environment points at (C-11.5):
// migrations applied, rows per table, the last audit entry, arrived
// attachments, objects in the bucket. Writes it as JSON to the path given.
//
//   pnpm backup:manifest out/staging-before.json [label]
//
// Run before a backup on the source, and after a restore on the target; then
// `pnpm restore:verify`. The manifest holds counts and identifiers only —
// no farmer data — and still never belongs in the repository (C-11.10).
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

import { loadEnvLocal } from '../../../scripts/load-env.mjs';

const [outPath, label] = process.argv.slice(2);
if (!outPath) {
  console.error(
    'backup-manifest: give the output path. Usage: pnpm backup:manifest <out.json> [label]',
  );
  process.exit(1);
}
const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error('backup-manifest: .env.local does not exist; nothing to point at.');
  process.exit(1);
}
const { PrismaClient } = await import('@prisma/client');
const { takeManifest, ATTACHMENT_BUCKET } = await import('../lib/backup/manifest.ts');
const { countBucketObjects } = await import('../lib/supabase/admin.ts');

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
try {
  const host = new URL(process.env.DIRECT_URL).hostname;
  const manifest = await takeManifest(prisma, label ?? host, () =>
    countBucketObjects(ATTACHMENT_BUCKET),
  );
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(
    `backup-manifest: ${manifest.migrations.length} migrations, ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows across ${Object.keys(manifest.tables).length} tables, ` +
      `last audit ${manifest.last_audit?.id ?? 'none'}, ${manifest.attachments_arrived} attachments arrived, ${manifest.storage_objects} objects in the bucket -> ${outPath}`,
  );
} finally {
  await prisma.$disconnect();
}

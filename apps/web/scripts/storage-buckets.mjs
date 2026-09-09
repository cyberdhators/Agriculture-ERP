// Creates the PRIVATE attachment bucket on the project .env.local points at
// (B8, C-8.8). Idempotent: an existing private bucket is left alone; an
// existing PUBLIC bucket is an error, never silently accepted.
//
//   pnpm storage:buckets        (root script; runs this from apps/web)
//
// The ceiling and the allowed types come from packages/shared, the same
// numbers the declaration schema and the database CHECK use, so the provider
// refuses at upload exactly what the API refuses at declaration.
import console from 'node:console';
import process from 'node:process';

import { loadEnvLocal } from '../../../scripts/load-env.mjs';

const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error('storage-buckets: .env.local does not exist; nothing to point at.');
  process.exit(1);
}

const { ATTACHMENT_CONTENT_TYPES, ATTACHMENT_LIMITS, VISIT_ATTACHMENT_BUCKET } =
  await import('@agri-erp/shared');
const { ensurePrivateBucket } = await import('../lib/supabase/admin.ts');

const outcome = await ensurePrivateBucket(VISIT_ATTACHMENT_BUCKET, {
  fileSizeLimit: Math.max(ATTACHMENT_LIMITS.photoMaxBytes, ATTACHMENT_LIMITS.audioMaxBytes),
  allowedMimeTypes: [...ATTACHMENT_CONTENT_TYPES.photo, ...ATTACHMENT_CONTENT_TYPES.audio],
});
console.log(`storage-buckets: ${VISIT_ATTACHMENT_BUCKET} ${outcome} (private)`);

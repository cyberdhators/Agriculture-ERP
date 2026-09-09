// Verifies a restore (C-11.5), corrects lost attachments (C-11.3) and records
// the restore in the restored database (C-11.4). Points at the RESTORED
// database through .env.local.
//
//   pnpm restore:verify --before out/staging-before.json \
//        --backup "<backup identity>" --recovery-point <ISO 8601> --by "<your name>" \
//        [--correct-attachments] [--record]
//
// Without --record it reports and changes nothing. With --record it writes the
// system.restored entry FIRST and prints "verified" only after that entry is in
// the database: a restore cannot be reported successful without leaving its
// note (C-11.4). --correct-attachments marks every arrived attachment whose
// file is absent from the bucket as lost_on_restore, one audit entry each.
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

import { loadEnvLocal } from '../../../scripts/load-env.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const beforePath = opt('before');
const backup = opt('backup');
const recoveryPoint = opt('recovery-point');
const performedBy = opt('by');
if (!beforePath) {
  console.error('restore-verify: --before <manifest.json> is required.');
  process.exit(1);
}
if (flag('record') && (!backup || !recoveryPoint || !performedBy)) {
  console.error('restore-verify: --record needs --backup, --recovery-point and --by.');
  process.exit(1);
}
if (recoveryPoint && Number.isNaN(new Date(recoveryPoint).getTime())) {
  console.error('restore-verify: --recovery-point must be an ISO 8601 date and time.');
  process.exit(1);
}
const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error('restore-verify: .env.local does not exist; nothing to point at.');
  process.exit(1);
}
const { PrismaClient } = await import('@prisma/client');
const {
  takeManifest,
  compareManifests,
  isVerified,
  recordRestore,
  correctLostAttachments,
  ATTACHMENT_BUCKET,
} = await import('../lib/backup/manifest.ts');
const { countBucketObjects, describeStoredObject } = await import('../lib/supabase/admin.ts');

const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
try {
  const host = new URL(process.env.DIRECT_URL).hostname;
  if (flag('correct-attachments')) {
    const { checked, lost } = await correctLostAttachments(
      prisma,
      async (path) => (await describeStoredObject(ATTACHMENT_BUCKET, path)) !== null,
    );
    console.log(
      `restore-verify: ${checked} arrived attachments checked, ${lost.length} marked lost_on_restore`,
    );
  }
  const after = await takeManifest(prisma, host, () => countBucketObjects(ATTACHMENT_BUCKET));
  const differences = compareManifests(before, after);
  for (const d of differences) {
    console.log(
      `${d.explained_by_recovery_point ? 'explained ' : 'UNEXPLAINED'}  ${d.what}: ${d.before} -> ${d.after}`,
    );
  }
  const ok = isVerified(differences);
  if (flag('record')) {
    const id = await recordRestore(prisma, {
      backup,
      recovery_point: recoveryPoint,
      performed_by: performedBy,
      before,
      after,
    });
    console.log(`restore-verify: system.restored written as audit entry ${id}`);
  }
  console.log(
    ok
      ? flag('record')
        ? 'restore-verify: verified — every difference is explained by the recovery point, and the restore is recorded.'
        : 'restore-verify: every difference is explained by the recovery point. Not recorded (run again with --record).'
      : 'restore-verify: NOT verified — a difference above is not explained by the recovery point.',
  );
  process.exit(ok ? 0 : 2);
} finally {
  await prisma.$disconnect();
}

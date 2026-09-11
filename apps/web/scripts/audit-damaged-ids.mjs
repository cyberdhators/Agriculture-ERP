// Lists audit rows whose stored payload holds an identifier the scrubber
// damaged before 2026-09-09 (PROJECT-STATE, "the ninth instance").
//
//   pnpm audit:damaged-ids            # counts, by action
//   pnpm audit:damaged-ids --list     # one line per row: id, action, entity
//
// Nothing is repaired: audit_event is append-only (C-4). This exists so that
// a reader who meets "60fa[redacted]d2-bf[redacted]" in a payload knows the id
// was damaged in transit and not that the record's id was wrong.
import console from 'node:console';
import process from 'node:process';

import { loadEnvLocal } from '../../../scripts/load-env.mjs';

const loaded = loadEnvLocal();
if (!loaded.ok) {
  console.error('audit-damaged-ids: .env.local does not exist; nothing to point at.');
  process.exit(1);
}
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

// A damaged identifier: the marker sits inside a value made of hex and hyphens.
const DAMAGED = `(before::text ~ '"[a-f0-9-]*\\[redacted\\][a-f0-9-]*"'
                 OR after::text ~ '"[a-f0-9-]*\\[redacted\\][a-f0-9-]*"')`;
try {
  if (process.argv.includes('--list')) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id::text, action, entity_type, entity_id, occurred_at::text
       FROM public.audit_event WHERE ${DAMAGED} ORDER BY occurred_at`,
    );
    for (const r of rows) {
      console.log(`${r.occurred_at}  ${r.id}  ${r.action}  ${r.entity_type}/${r.entity_id}`);
    }
    console.log(`${rows.length} rows carry a damaged identifier.`);
  } else {
    const [{ total }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS total FROM public.audit_event`,
    );
    const byAction = await prisma.$queryRawUnsafe(
      `SELECT action, count(*)::int AS n FROM public.audit_event WHERE ${DAMAGED} GROUP BY 1 ORDER BY 2 DESC`,
    );
    const damaged = byAction.reduce((sum, r) => sum + r.n, 0);
    console.log(
      `${damaged} of ${total} audit rows carry a damaged identifier (${((damaged / total) * 100).toFixed(2)}%).`,
    );
    for (const r of byAction) console.log(`  ${String(r.n).padStart(5)}  ${r.action}`);
    console.log('Nothing is repaired: the table is append-only. Run with --list for the rows.');
  }
} finally {
  await prisma.$disconnect();
}

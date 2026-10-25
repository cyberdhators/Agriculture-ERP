import type { AnnouncementChannel } from '@agri-erp/shared';

import {
  QUEUE_ANNOUNCEMENTS_PER_RUN,
  madeProgress,
  mayStartBatch,
} from '../announcement-queue-plan';
import { prisma } from '../db';
import { SYSTEM_ACTOR, completeIfDone, loadAnnouncement, processBatch } from './announcements';
import { settingValue } from './settings';

/**
 * ANNOUNCEMENTS MOVE ON WITHOUT THE SCREEN (2026-10-29). docs/DECISIONS.md,
 * "Announcements are sent by a scheduled job as well as by the screen".
 *
 * Until now an announcement progressed only while an administrator kept its
 * page open: the page called POST /api/admin/announcements/:id/process in a
 * loop. This is the same batch, run by a scheduler every two minutes (POST
 * /api/cron/announcements, installed by scripts/announcements-cron-install.mjs)
 * for every announcement still `sending`, oldest first, one batch each in
 * turn while the run's time lasts (lib/announcement-queue-plan.ts).
 *
 * Safe beside the page and beside itself: processBatch claims rows with
 * FOR UPDATE SKIP LOCKED, so no delivery is sent twice, and completeIfDone
 * completes an announcement once only. Audited as actor 'system'. Nothing is
 * new about what is sent or to whom; only who asks.
 */

export interface QueueRunOutcome {
  announcements: number;
  batches: number;
  completed: number;
  in_app_sent: number;
  sms_sent: number;
  email_sent: number;
  failed: number;
  waiting_for_configuration: AnnouncementChannel[];
  errors: number;
}

export async function runAnnouncementQueue(): Promise<QueueRunOutcome> {
  const started = Date.now();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.announcement
      WHERE status = 'sending' AND deleted_at IS NULL
      ORDER BY sent_at NULLS FIRST, id
      LIMIT ${QUEUE_ANNOUNCEMENTS_PER_RUN}`,
  );
  const outcome: QueueRunOutcome = {
    announcements: rows.length,
    batches: 0,
    completed: 0,
    in_app_sent: 0,
    sms_sent: 0,
    email_sent: 0,
    failed: 0,
    waiting_for_configuration: [],
    errors: 0,
  };
  if (rows.length === 0) return outcome;

  const identity = await settingValue('identity');
  const waiting = new Set<AnnouncementChannel>();
  let active = rows.map((r) => r.id);
  while (active.length > 0 && mayStartBatch(Date.now() - started, outcome.batches)) {
    const again: string[] = [];
    for (const id of active) {
      if (!mayStartBatch(Date.now() - started, outcome.batches)) break;
      try {
        const row = await loadAnnouncement(id);
        if (!row || row.status !== 'sending') continue;
        const batch = await processBatch(SYSTEM_ACTOR, row, identity.service_name);
        outcome.batches += 1;
        outcome.in_app_sent += batch.in_app_sent;
        outcome.sms_sent += batch.sms.sent;
        outcome.email_sent += batch.email.sent;
        outcome.failed += batch.sms.failed + batch.email.failed + batch.interrupted_marked_failed;
        for (const c of batch.waiting_for_configuration) waiting.add(c);
        if (await completeIfDone(SYSTEM_ACTOR, id)) {
          outcome.completed += 1;
          continue;
        }
        if (madeProgress(batch)) again.push(id);
      } catch {
        // One announcement's failure never stops the others; the next run retries it.
        outcome.errors += 1;
      }
    }
    active = again;
  }
  outcome.waiting_for_configuration = [...waiting];
  return outcome;
}

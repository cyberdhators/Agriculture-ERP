import type { TimelineEntry } from '@/lib/buyer/api';
import { ORDER_STATUS_LABELS, labelOf } from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import styles from './buyer.module.css';

/**
 * An order's history, newest first: what was recorded, by whom, and when. The
 * recorder is "CORWADO" or "your organisation" -- the route gives no ids.
 * There is no live position; nothing here pretends otherwise.
 */
export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  if (entries.length === 0) return <p className={styles.muted}>Nothing recorded yet.</p>;
  return (
    <ol className={styles.timeline} aria-label="Order history">
      {entries.map((entry) => (
        <li key={entry.id} className={styles.timelineItem}>
          <span className={styles.timelineDot} aria-hidden />
          <div className={styles.timelineBody}>
            <strong>{labelOf(ORDER_STATUS_LABELS, entry.status)}</strong>
            {entry.note ? <span dir="auto">{entry.note}</span> : null}
            <span className={styles.muted}>
              {formatDate(entry.occurred_at)} ·{' '}
              {entry.recorded_by === 'buyer' ? 'Your organisation' : 'CORWADO'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

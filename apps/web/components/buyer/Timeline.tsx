import type { ListingGrade, PurchaseOrderStatus, PurchaseRequestStatus } from '@agri-erp/shared';

import type { TimelineEntry } from '@/lib/buyer/api';
import {
  GRADE_LABELS,
  ORDER_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  unitLabelOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import styles from './buyer.module.css';

/*
 * 2026-10-31 (finishing the Arabic): the buyer screens' words for a stored
 * status, grade or quantity, in the buyer's language. The English tables in
 * lib/buyer/labels.ts stay the staff portal's; the i18n keys carry the same
 * English, so nothing changes in English. A value this build does not know
 * prints as itself, never blank.
 */
const known = (table: object, value: string) => Object.prototype.hasOwnProperty.call(table, value);

export const orderStatusIn = (status: string, lang: Language): string =>
  known(ORDER_STATUS_LABELS, status)
    ? t(`buyer.orderStatus.${status as PurchaseOrderStatus}`, lang)
    : status;

export const requestStatusIn = (status: string, lang: Language): string =>
  known(REQUEST_STATUS_LABELS, status)
    ? t(`buyer.reqStatus.${status as PurchaseRequestStatus}`, lang)
    : status;

export const gradeIn = (grade: string | null, lang: Language): string =>
  grade === null
    ? '—'
    : known(GRADE_LABELS, grade)
      ? t(`buyer.grade.${grade as ListingGrade}`, lang)
      : grade;

/** "5,000 kg", "12 × 50 kg bag" -- the unit in the buyer's language. */
export const quantityIn = (quantity: number, unit: string, lang: Language): string => {
  const label = unitLabelOf(unit, lang);
  const n = quantity.toLocaleString('en', { maximumFractionDigits: 2 });
  return unit === 'kg' || unit === 'litre' ? `${n} ${label}` : `${n} × ${label}`;
};

/** "per kg". */
export const perUnitIn = (unit: string, lang: Language): string =>
  t('buyer.w.perUnit', lang).replace('{unit}', unitLabelOf(unit, lang));

/**
 * An order's history, newest first: what was recorded, by whom, and when. The
 * recorder is "CORWADO" or "your organisation" -- the route gives no ids.
 * There is no live position; nothing here pretends otherwise.
 */
export function Timeline({
  entries,
  language = 'en',
}: {
  entries: readonly TimelineEntry[];
  language?: Language;
}) {
  if (entries.length === 0)
    return <p className={styles.muted}>{t('buyer.timeline.none', language)}</p>;
  return (
    <ol className={styles.timeline} aria-label={t('buyer.timeline.aria', language)}>
      {entries.map((entry) => (
        <li key={entry.id} className={styles.timelineItem}>
          <span className={styles.timelineDot} aria-hidden />
          <div className={styles.timelineBody}>
            <strong>{orderStatusIn(entry.status, language)}</strong>
            {entry.note ? <span dir="auto">{entry.note}</span> : null}
            <span className={styles.muted}>
              {formatDate(entry.occurred_at, language)} ·{' '}
              {entry.recorded_by === 'buyer'
                ? t('buyer.timeline.yourOrg', language)
                : t('buyer.timeline.corwado', language)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

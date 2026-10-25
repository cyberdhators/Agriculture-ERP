import {
  addDays,
  DEFAULT_VALIDITY_DAYS,
  type LifecycleAction,
  type LifecycleStage,
  type ServicePriceUnit,
  type ServiceType,
} from '@agri-erp/shared';

import type { StampKind } from '@/components/ui';
import type { TKey } from '@/lib/i18n';

/**
 * LISTINGS LANE (2026-10-19) -- how the lifecycle, service types and price
 * units read, in the farmer's language. The word carries the meaning; the
 * stamp colour backs it.
 */

export const STAGE_KEY: Record<LifecycleStage, TKey> = {
  draft: 'lifecycle.draft',
  active: 'lifecycle.active',
  paused: 'lifecycle.paused',
  expired: 'lifecycle.expired',
  withdrawn: 'lifecycle.withdrawn',
  completed: 'lifecycle.completed',
};

/** One sentence on what each stage means for the person who posted it. */
export const STAGE_EXPLAIN_KEY: Record<LifecycleStage, TKey> = {
  draft: 'lifecycle.explainDraft',
  active: 'lifecycle.explainActive',
  paused: 'lifecycle.explainPaused',
  expired: 'lifecycle.explainExpired',
  withdrawn: 'lifecycle.explainWithdrawn',
  completed: 'lifecycle.explainCompleted',
};

const STAGE_STAMP: Record<LifecycleStage, StampKind> = {
  draft: 'neutral',
  active: 'verified',
  paused: 'pending',
  expired: 'escalated',
  withdrawn: 'merged',
  completed: 'info',
};

export const stageStamp = (stage: LifecycleStage): StampKind => STAGE_STAMP[stage];

export const ACTION_KEY: Record<LifecycleAction, TKey> = {
  publish: 'lifecycle.publish',
  pause: 'lifecycle.pause',
  resume: 'lifecycle.resume',
  renew: 'lifecycle.renew',
  withdraw: 'lifecycle.withdraw',
  complete: 'lifecycle.complete',
  record_sale: 'lifecycle.recordSale',
};

export const SERVICE_TYPE_KEY: Record<ServiceType, TKey> = {
  tractor_hire: 'serviceType.tractor_hire',
  transport: 'serviceType.transport',
  processing: 'serviceType.processing',
  storage: 'serviceType.storage',
  other: 'serviceType.other',
};

export const PRICE_UNIT_KEY: Record<ServicePriceUnit, TKey> = {
  per_hour: 'priceUnit.per_hour',
  per_day: 'priceUnit.per_day',
  per_acre: 'priceUnit.per_acre',
  per_feddan: 'priceUnit.per_feddan',
  per_trip: 'priceUnit.per_trip',
  per_bag: 'priceUnit.per_bag',
  per_kg: 'priceUnit.per_kg',
  per_job: 'priceUnit.per_job',
};

/** Today on this phone, YYYY-MM-DD. */
export const todayLocal = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The date a renewal offers first: thirty days from today. */
export const renewalDefault = (today: string = todayLocal()): string =>
  addDays(today, DEFAULT_VALIDITY_DAYS);

/**
 * 2026-10-27 (settings phase 2): the whole days left before an ACTIVE post's
 * end date when that is within the reminder period (Marketplace and reference
 * lists), else null. Zero means it ends today.
 */
export function endsWithin(
  stage: LifecycleStage,
  endDate: string | null | undefined,
  reminderDays: number,
  today: string = todayLocal(),
): number | null {
  if (stage !== 'active' || !endDate) return null;
  const left = Math.round(
    (Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  return left >= 0 && left <= reminderDays ? left : null;
}

/** A destructive or final move asks first. */
export const CONFIRMED_ACTIONS: ReadonlySet<LifecycleAction> = new Set(['withdraw', 'complete']);

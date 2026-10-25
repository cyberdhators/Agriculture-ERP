import { z } from 'zod';

import { ACTIVITIES, type Activity } from './account-profile';
import { analyticsFilterSchema } from './analytics';

/**
 * THE ADMINISTRATION OVERVIEW (2026-10-28). CORWADO's specification of 16
 * October 2026, section 4, "Overview: Activity summaries, unresolved cases and
 * system alerts; filters link to detail", and the infographic "AgriOne Admin
 * Portal, 1 of 3", panel 1: active users, active listings, buying requests,
 * open cases; user registrations; listings and requests; date, location and
 * actor-type filters.
 *
 * The figures are served by GET /api/admin/overview. Everything here is pure
 * -- the filter, the day series, the links to the queues and the alerts -- so
 * it is tested without a database and the page and the route share it.
 *
 * PEOPLE, ACCOUNTS AND ORGANISATIONS ARE COUNTED SEPARATELY (the
 * specification, "Measures and exports"): a person may have no sign-in (a
 * farmer an officer registered), one sign-in may hold a farmer and a buyer
 * record, and an organisational profile is not a person.
 */

// ---------------------------------------------------------------------------
// THE FILTER
// ---------------------------------------------------------------------------

/** Pinned in docs/api/CONVENTIONS.md §5.2.3. */
export const ADMIN_OVERVIEW_MESSAGES = {
  actorUnknown: 'Choose an actor type from the list.',
} as const;

/**
 * The actor types an overview may be narrowed to: the activities an account
 * (or an organisational profile) declares on its profile. One account may
 * declare several, so the narrowed figures overlap and do not add up.
 */
export const OVERVIEW_ACTORS = ACTIVITIES;
export type OverviewActor = Activity;

export const OVERVIEW_ACTOR_LABELS: Readonly<Record<OverviewActor, string>> = {
  farmer: 'Farmers',
  trader: 'Traders',
  processor: 'Processors',
  input_supplier: 'Input suppliers',
  transport: 'Transport',
  other_services: 'Other services',
  knowledge_provider: 'Knowledge providers',
  financial_services: 'Financial services',
  buyer: 'Buyers',
};

/**
 * GET /api/admin/overview (query): the analytics window (from, to, state_id,
 * with exactly its rules and messages) plus an actor type.
 */
export const adminOverviewFilterSchema = z
  .strictObject({
    from: z.string().optional(),
    to: z.string().optional(),
    state_id: z.string().optional(),
    actor: z
      .enum(OVERVIEW_ACTORS, { error: () => ADMIN_OVERVIEW_MESSAGES.actorUnknown })
      .optional(),
  })
  .superRefine((f, ctx) => {
    const window = analyticsFilterSchema.safeParse({
      ...(f.from !== undefined ? { from: f.from } : {}),
      ...(f.to !== undefined ? { to: f.to } : {}),
      ...(f.state_id !== undefined ? { state_id: f.state_id } : {}),
    });
    if (window.success) return;
    for (const issue of window.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  })
  .transform((f) => ({
    ...(f.from !== undefined ? { from: f.from } : {}),
    ...(f.to !== undefined ? { to: f.to } : {}),
    ...(f.state_id !== undefined ? { state_id: f.state_id.trim() } : {}),
    ...(f.actor !== undefined ? { actor: f.actor } : {}),
  }));
export type AdminOverviewFilter = z.output<typeof adminOverviewFilterSchema>;

// ---------------------------------------------------------------------------
// THE ANSWER
// ---------------------------------------------------------------------------

export type OverviewUnavailable = 'not_located' | 'not_in_database';

export const OVERVIEW_UNAVAILABLE_TEXT: Readonly<Record<OverviewUnavailable, string>> = {
  not_located: 'These records carry no state, so the figure is national only.',
  not_in_database: 'The table behind this figure is not in the database yet.',
};

export const OVERVIEW_TILE_IDS = [
  'people',
  'accounts',
  'organisations',
  'new_accounts',
  'active_users',
  'active_listings',
  'active_services',
  'active_buying_requests',
] as const;
export type OverviewTileId = (typeof OVERVIEW_TILE_IDS)[number];

export const OVERVIEW_CASE_IDS = [
  'support',
  'appeals',
  'product_reports',
  'corrections',
  'adviser_applications',
] as const;
export type OverviewCaseId = (typeof OVERVIEW_CASE_IDS)[number];

export interface OverviewFigure<Id extends string = string> {
  readonly id: Id;
  /** Null when it cannot be produced; `unavailable` says why. Never a silent zero. */
  readonly value: number | null;
  readonly unavailable?: OverviewUnavailable;
  /** A smaller figure inside this one, e.g. suspended accounts, input listings. */
  readonly part?: { readonly label: string; readonly value: number };
}

export interface OverviewDay {
  readonly date: string;
  readonly value: number;
}

export interface OverviewMarketDay {
  readonly date: string;
  readonly listings: number;
  readonly buying_requests: number;
}

export type OverviewAlertLevel = 'error' | 'warn' | 'info';

export interface OverviewAlert {
  readonly id: string;
  readonly level: OverviewAlertLevel;
  readonly title: string;
  readonly body: string;
  /** Where to act on it, when the caller may; null otherwise. */
  readonly href: string | null;
}

export interface AdminOverview {
  readonly window: { from: string; to: string; days: number; time_zone: string };
  readonly state_id: string | null;
  readonly actor: OverviewActor | null;
  /** The states the figures are limited to; null means national. */
  readonly scope_states: readonly string[] | null;
  readonly generated_at: string;
  readonly tiles: readonly OverviewFigure<OverviewTileId>[];
  readonly cases: readonly OverviewFigure<OverviewCaseId>[];
  readonly trends: {
    /** New sign-in accounts per Juba day, every day of the window present. */
    readonly registrations: readonly OverviewDay[] | null;
    /** Produce, input and service listings vs buying requests created per Juba day. */
    readonly market: readonly OverviewMarketDay[];
  };
  readonly alerts: readonly OverviewAlert[];
}

// ---------------------------------------------------------------------------
// THE DAY SERIES
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every YYYY-MM-DD from `from` to `to`, both included. Empty if reversed. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return out;
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * One value per day of the window, a missing day as 0 (the database returns
 * only days that had something). Rows outside the window are dropped, and two
 * rows for one day are added together.
 */
export function fillDays(
  from: string,
  to: string,
  rows: readonly { day: string; value: number }[],
): OverviewDay[] {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.day, (sums.get(r.day) ?? 0) + Number(r.value));
  return daysOf(from, to).map((date) => ({ date, value: sums.get(date) ?? 0 }));
}

/** The same for the two market series, which share their days. */
export function fillMarketDays(
  from: string,
  to: string,
  rows: readonly { day: string; listings: number; buying_requests: number }[],
): OverviewMarketDay[] {
  const listings = fillDays(
    from,
    to,
    rows.map((r) => ({ day: r.day, value: r.listings })),
  );
  const requests = fillDays(
    from,
    to,
    rows.map((r) => ({ day: r.day, value: r.buying_requests })),
  );
  return listings.map((d, i) => ({
    date: d.date,
    listings: d.value,
    buying_requests: requests[i]?.value ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// LINKS TO THE QUEUES -- "filters link to detail"
// ---------------------------------------------------------------------------

/**
 * Where each figure opens, with the overview's filters carried across in the
 * query string. The destination screens read `from`, `to`, `state` and
 * `actor` where they offer that filter and ignore what they do not.
 */
const DESTINATIONS: Readonly<
  Record<
    OverviewTileId | OverviewCaseId | 'registrations' | 'market',
    {
      path: string;
      extra?: Record<string, string>;
      carries: readonly ('window' | 'state' | 'actor')[];
    }
  >
> = {
  people: { path: '/admin/accounts', carries: ['state', 'actor'] },
  accounts: { path: '/admin/accounts', extra: { sign_in: 'yes' }, carries: ['state', 'actor'] },
  organisations: {
    path: '/admin/accounts',
    extra: { kind: 'organisation' },
    carries: ['state', 'actor'],
  },
  new_accounts: { path: '/admin/accounts', carries: ['window', 'state', 'actor'] },
  active_users: { path: '/analytics', carries: ['window', 'state'] },
  active_listings: {
    path: '/admin/marketplace',
    extra: { tab: 'produce' },
    carries: ['state', 'actor'],
  },
  active_services: {
    path: '/admin/marketplace',
    extra: { tab: 'services' },
    carries: ['state', 'actor'],
  },
  active_buying_requests: {
    path: '/admin/marketplace',
    extra: { tab: 'buying_requests' },
    carries: ['state', 'actor'],
  },
  support: { path: '/admin/support', extra: { status: 'open' }, carries: [] },
  appeals: { path: '/admin/support', extra: { status: 'open', case_type: 'appeal' }, carries: [] },
  product_reports: { path: '/product-reports', carries: [] },
  corrections: { path: '/product-reports', extra: { view: 'corrections' }, carries: [] },
  adviser_applications: { path: '/admin/advisers', carries: [] },
  registrations: { path: '/analytics', carries: ['window', 'state'] },
  market: { path: '/analytics', carries: ['window', 'state'] },
};

export type OverviewDestination = keyof typeof DESTINATIONS;

/** The link a figure opens, filters carried. Pure; the order of the query is stable. */
export function overviewHref(target: OverviewDestination, filter: AdminOverviewFilter): string {
  const d = DESTINATIONS[target];
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(d.extra ?? {})) qs.set(k, v);
  if (d.carries.includes('window')) {
    if (filter.from) qs.set('from', filter.from);
    if (filter.to) qs.set('to', filter.to);
  }
  if (d.carries.includes('state') && filter.state_id) qs.set('state', filter.state_id);
  if (d.carries.includes('actor') && filter.actor) qs.set('actor', filter.actor);
  const query = qs.toString();
  return query ? `${d.path}?${query}` : d.path;
}

// ---------------------------------------------------------------------------
// SYSTEM ALERTS
// ---------------------------------------------------------------------------

export interface AlertInputs {
  /** Integrations and whether each is configured; null when the caller may not see settings. */
  readonly integrations:
    | readonly {
        name: string;
        purpose: string;
        configured: boolean;
        variables: readonly unknown[];
      }[]
    | null;
  /** Failures recorded in the window, by kind; null when national figures are not in scope. */
  readonly failures: Readonly<Record<string, number>> | null;
  /** The maintenance banner, when the settings tables exist. */
  readonly maintenance: { enabled: boolean; message: string } | null;
  /** Tables the overview reads that are not in the database yet. */
  readonly missingTables: readonly string[];
}

const FAILURE_TEXT: Readonly<Record<string, { title: string; body: string; href: string }>> = {
  'communication.send_failed': {
    title: 'Messages that could not be sent',
    body: 'Official SMS or email messages failed to send in this window.',
    href: '/communications',
  },
  suspension_sms_failed: {
    title: 'Suspension text messages that could not be sent',
    body: 'Suspended accounts were not told by SMS. Contact them another way.',
    href: '/admin/audit',
  },
  'auth.disable_failed': {
    title: 'Sign-ins that could not be blocked',
    body: 'A suspension or removal could not block the sign-in in Supabase. Check those accounts.',
    href: '/admin/audit',
  },
  'staff.sessions_revoke_failed': {
    title: 'Staff sessions that could not be ended',
    body: 'Ending a staff member’s sessions failed. Try again from Staff permissions.',
    href: '/admin/staff-access',
  },
  'visit.attachment_failed': {
    title: 'Visit photos that failed to upload',
    body: 'Officers’ visit attachments failed in this window.',
    href: '/visits',
  },
};

/** The order alerts are shown in: what is broken first, then what is off, then notes. */
const LEVEL_ORDER: Readonly<Record<OverviewAlertLevel, number>> = { error: 0, warn: 1, info: 2 };

export function overviewAlerts(input: AlertInputs): OverviewAlert[] {
  const out: OverviewAlert[] = [];

  for (const [kind, count] of Object.entries(input.failures ?? {})) {
    if (!count) continue;
    const text = FAILURE_TEXT[kind];
    out.push({
      id: `failure:${kind}`,
      level: 'error',
      title: `${text?.title ?? 'Recorded failures'}: ${count.toLocaleString('en')}`,
      body: text?.body ?? `“${kind}” was recorded in this window.`,
      href: text?.href ?? '/admin/audit',
    });
  }

  for (const i of input.integrations ?? []) {
    // An integration that reads no variable (Mapbox, hidden) cannot be "not configured".
    if (i.configured || i.variables.length === 0) continue;
    out.push({
      id: `integration:${i.name}`,
      level: 'warn',
      title: `${i.name} is not configured`,
      body: `${i.purpose} will not work until its settings are complete.`,
      href: '/admin/settings',
    });
  }

  if (input.maintenance?.enabled) {
    out.push({
      id: 'maintenance',
      level: 'info',
      title: 'The maintenance banner is on',
      body: input.maintenance.message || 'Every page shows the maintenance banner.',
      href: '/admin/settings',
    });
  }

  if (input.missingTables.length > 0) {
    out.push({
      id: 'missing-tables',
      level: 'info',
      title: 'Some figures are not measured yet',
      body: `Not in the database yet: ${[...input.missingTables].sort().join(', ')}.`,
      href: null,
    });
  }

  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => LEVEL_ORDER[x.a.level] - LEVEL_ORDER[y.a.level] || x.i - y.i)
    .map(({ a }) => a);
}

// ---------------------------------------------------------------------------
// PERIOD PRESETS
// ---------------------------------------------------------------------------

/** The quick choices on the overview's date filter, in days ending today. */
export const OVERVIEW_PRESET_DAYS = [7, 30, 90] as const;

/** The window of the last `days` Juba days ending `today` (YYYY-MM-DD), both included. */
export function presetRange(days: number, today: string): { from: string; to: string } {
  const end = new Date(`${today}T00:00:00Z`).getTime();
  const from = new Date(end - (Math.max(1, Math.floor(days)) - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { from, to: today };
}

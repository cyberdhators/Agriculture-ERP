import { AUDIT_ACTOR_TYPES } from '@agri-erp/shared';

import type { AuditEvent, AuditFilterParams } from './api';

/**
 * THE AUDIT LOG, PREPARED FOR READING — AND THE THINGS IT MUST NEVER SHOW.
 *
 * The audit table is append-only and admin-only (C-4.8). This module does the
 * three jobs that are easy to get quietly wrong: deciding what a change may
 * say, recognising a historical identifier the old scrubber damaged, and
 * building a query out of only the filters the route accepts.
 *
 * FAILING CLOSED IS THE POINT. C-4.6 and C-4.7 say an audit row never holds a
 * password, a farmer's name, phone or national ID, a rejection note or a visit
 * observation — and the write path honours that: `auditFields` for a farmer
 * selects the farmer NUMBER and never the person. So the denylist below should
 * never fire. It exists because "should never" is not a guarantee a screen can
 * rely on: if an unexpected payload ever carries one of those keys, the value
 * must not reach the page, the DOM, a tooltip or the console.
 *
 * `name` is deliberately NOT on the list. In an audit row it is a staff or
 * officer name — `user.created`, `officer.updated` — and answering "who did
 * this" is what the log is for. A farmer's name would arrive as `given_name` /
 * `family_name`, and those are refused.
 */

/** Keys whose VALUE is never rendered, compared case- and separator-insensitively. */
export const FORBIDDEN_AUDIT_FIELDS: readonly string[] = [
  'password',
  'password_hash',
  'passwordhash',
  'given_name',
  'family_name',
  'phone',
  'alt_phone',
  'national_id',
  'note',
  'rejection_note',
  'reason_note',
  'observation',
  'advice',
  'token',
  'secret',
  'authorization',
  'cookie',
];

const normalise = (key: string): string => key.toLowerCase().replace(/[^a-z]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN_AUDIT_FIELDS.map(normalise));

export const isForbiddenField = (key: string): boolean => FORBIDDEN_SET.has(normalise(key));

/* ---- Damaged historical identifiers ----------------------------------- */

/**
 * A HISTORICAL IDENTIFIER THE SCRUBBER DAMAGED.
 *
 * Before 2026-09-09 the Sentry scrubber ran over audit payloads and replaced
 * part of the value of any key it judged sensitive — including `entity_id` and
 * ids nested in before/after — leaving strings like
 * `60fa[redacted]d2-bf[redacted]`. About 1.4% of stored ids are affected. They
 * CANNOT BE REPAIRED: the table is append-only, and the original characters are
 * gone.
 *
 * This is not a heuristic invented here. It is the same pattern
 * `scripts/audit-damaged-ids.mjs` uses to count them — a marker inside a value
 * otherwise made of hex and hyphens — kept in one place so the screen and the
 * script agree about what "damaged" means.
 */
/**
 * A damaged value is hex and hyphens with one or MORE markers embedded — the
 * scrubber often struck twice in one identifier, leaving
 * `60fa[redacted]d2-bf[redacted]`. Anchored at both ends so the marker
 * appearing inside ordinary prose is not mistaken for a damaged id.
 */
export const DAMAGED_ID_PATTERN = /^(?:[a-f0-9-]*\[redacted\])+[a-f0-9-]*$/i;

export const isDamagedId = (value: unknown): boolean =>
  typeof value === 'string' && DAMAGED_ID_PATTERN.test(value);

/** What the screen prints instead. Never a fabricated id, never a zero. */
export const DAMAGED_ID_LABEL = 'Historical ID unavailable';
export const DAMAGED_ID_NOTE =
  'An old privacy filter damaged this identifier in storage before September 2026. The event is genuine; the identifier cannot be repaired, because the audit table is append-only.';

/* ---- Labels ----------------------------------------------------------- */

const ENTITY_LABELS: Record<string, string> = {
  user: 'Staff account',
  officer: 'Extension officer',
  auth_account: 'Authentication account',
  farmer: 'Farmer',
  consent: 'Consent',
  farm: 'Farm',
  visit: 'Visit',
  report_export: 'Export',
  directory_entry: 'Directory entry',
  learning_resource: 'Learning resource',
  location: 'Location',
};

/**
 * A readable name for a record kind, and a safe fallback for one this build has
 * never heard of.
 *
 * A record kind added by a later unit must not crash the page or vanish from
 * it: an audit reader needs to see that the event happened even when the UI
 * cannot name its subject prettily. The raw value is kept for that reason.
 */
export function entityLabel(kind: string): string {
  return ENTITY_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export const KNOWN_ENTITY_KINDS: readonly string[] = Object.keys(ENTITY_LABELS);

const ACTOR_LABELS: Record<string, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  read_only: 'Read-only',
  officer: 'Extension officer',
  system: 'System',
};

export const actorLabel = (actorType: string): string => ACTOR_LABELS[actorType] ?? actorType;
export const ACTOR_TYPES: readonly string[] = AUDIT_ACTOR_TYPES;

/** `farmer.soft_deleted` → `Farmer soft deleted`. Unknown actions pass through. */
export function actionLabel(action: string): string {
  const tail = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  const words = tail.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ---- Before / after --------------------------------------------------- */

export interface FieldChange {
  field: string;
  /** Absent when the field was not present before. */
  before?: string;
  after?: string;
  /** True when the value was refused by the denylist rather than shown. */
  withheld: boolean;
  /** True when the value is a historical identifier the scrubber damaged. */
  damaged: boolean;
}

const asText = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).join(', ');
  // An object rather than a scalar: say so rather than dumping JSON into the
  // page, which is how a nested sensitive value would escape the denylist.
  return '(structured value)';
};

/**
 * The before/after of one event, as a table of fields.
 *
 * Every value passes the denylist first. A refused field still APPEARS — the
 * administrator should know the event touched it — but its value is replaced
 * by a withheld marker rather than printed, and never reaches a title, an
 * aria-label or the console.
 */
export function fieldChanges(event: Pick<AuditEvent, 'before' | 'after'>): FieldChange[] {
  const before = (event.before ?? {}) as Record<string, unknown>;
  const after = (event.after ?? {}) as Record<string, unknown>;
  const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  const b = isObject(event.before) ? before : {};
  const a = isObject(event.after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();

  return keys
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((key) => {
      if (isForbiddenField(key)) {
        return { field: key, withheld: true, damaged: false };
      }
      const damaged = isDamagedId(b[key]) || isDamagedId(a[key]);
      return {
        field: key,
        ...(key in b
          ? { before: damaged && isDamagedId(b[key]) ? DAMAGED_ID_LABEL : asText(b[key]) }
          : {}),
        ...(key in a
          ? { after: damaged && isDamagedId(a[key]) ? DAMAGED_ID_LABEL : asText(a[key]) }
          : {}),
        withheld: false,
        damaged,
      };
    });
}

/** A one-line summary for the table: field NAMES only, never their values. */
export function changeSummary(event: Pick<AuditEvent, 'before' | 'after'>): string {
  const changes = fieldChanges(event);
  if (changes.length === 0) return 'No field changes recorded';
  const names = changes.map((c) => c.field.replace(/_/g, ' '));
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

/* ---- Filters ---------------------------------------------------------- */

export interface AuditFilterState {
  entity_type: string;
  entity_id: string;
  actor_id: string;
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterState = {
  entity_type: '',
  entity_id: '',
  actor_id: '',
  from: '',
  to: '',
};

export const AUDIT_FILTER_KEYS = Object.keys(EMPTY_AUDIT_FILTERS) as (keyof AuditFilterState)[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The query the route will be sent — the four the specification names, in the
 * exact shape `auditFilterSchema` defines, and nothing else.
 *
 * `actor_id` must be a UUID or the schema refuses the whole request, so a
 * half-typed one is not sent. The dates are inclusive: `from` opens at the
 * start of its day and `to` closes at the end of its own, because
 * `occurred_at >= from` and `occurred_at <= to` is what the route runs.
 */
export function toAuditParams(state: AuditFilterState, cursor?: string): AuditFilterParams {
  const params: AuditFilterParams = {};
  if (state.entity_type) params.entity_type = state.entity_type;
  if (state.entity_id) params.entity_id = state.entity_id;
  if (state.actor_id && UUID.test(state.actor_id)) params.actor_id = state.actor_id;
  if (state.from) params.from = `${state.from}T00:00:00.000Z`;
  if (state.to) params.to = `${state.to}T23:59:59.999Z`;
  if (cursor) params.cursor = cursor;
  return params;
}

export const actorIdLooksValid = (value: string): boolean => value === '' || UUID.test(value);

export function fromQuery(get: (key: string) => string): AuditFilterState {
  const state = { ...EMPTY_AUDIT_FILTERS };
  for (const key of AUDIT_FILTER_KEYS) state[key] = get(key) ?? '';
  return state;
}

export const clearAuditFilters = (): Record<string, null> =>
  Object.fromEntries(AUDIT_FILTER_KEYS.map((key) => [key, null]));

export interface AuditChip {
  key: keyof AuditFilterState;
  label: string;
}

export function auditChips(state: AuditFilterState): AuditChip[] {
  const chips: AuditChip[] = [];
  if (state.entity_type) {
    chips.push({ key: 'entity_type', label: `Record kind: ${entityLabel(state.entity_type)}` });
  }
  if (state.entity_id) chips.push({ key: 'entity_id', label: `Record: ${state.entity_id}` });
  if (state.actor_id) chips.push({ key: 'actor_id', label: `Actor: ${state.actor_id}` });
  if (state.from) chips.push({ key: 'from', label: `From ${state.from}` });
  if (state.to) chips.push({ key: 'to', label: `To ${state.to}` });
  return chips;
}

export const hasAuditFilters = (state: AuditFilterState): boolean => auditChips(state).length > 0;

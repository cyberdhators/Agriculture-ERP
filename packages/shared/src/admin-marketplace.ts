import { z } from 'zod';

import { ANALYTICS_MESSAGES } from './analytics';
import { LISTING_CATEGORIES } from './buyer';
import { type ListingCorrection } from './listing-corrections';
import { SERVICE_TYPES } from './market-posts';
import { reasonCodeSchema } from './settings';
import { STAFF_PERMISSION_MESSAGES } from './staff-permissions';

/**
 * THE MARKETPLACE CONSOLE (2026-10-28, CORWADO's 16 October specification,
 * Marketplace: "Produce, inputs, buying requests, services and inactive
 * listings. Inspect, request correction and moderate with a reason; listing
 * removal is separate from account action"). Staff holding "Moderate content
 * and listings" see every post that has been published -- drafts are the
 * owner's own and are never shown -- in five tabs, inspect one, ask for a
 * correction (POST /api/admin/corrections) or remove it with a reason.
 *
 * Removing a post never touches the account that posted it.
 */

/** The three kinds of post, named as correction requests name them. */
export const MARKETPLACE_KINDS = ['produce_listing', 'buying_request', 'service_listing'] as const;
export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number];

export const MARKETPLACE_TABS = [
  'produce',
  'inputs',
  'buying_requests',
  'services',
  'inactive',
] as const;
export type MarketplaceTab = (typeof MARKETPLACE_TABS)[number];

/**
 * A post's status as staff read it. `expired` is not stored anywhere: it is a
 * post still marked live whose end date (available until / needed by) has
 * passed, which the public market already leaves out.
 */
export const MARKETPLACE_STATUSES = [
  'active',
  'paused',
  'expired',
  'withdrawn',
  'completed',
] as const;
export type MarketplaceStatus = (typeof MARKETPLACE_STATUSES)[number];

/** The statuses the Inactive tab holds: everything that is not live. */
export const INACTIVE_STATUSES: readonly MarketplaceStatus[] = [
  'paused',
  'expired',
  'withdrawn',
  'completed',
];

/** "Needs attention" filters on any tab. */
export const MARKETPLACE_FLAGS = ['reported', 'correction'] as const;
export type MarketplaceFlag = (typeof MARKETPLACE_FLAGS)[number];

export const MARKETPLACE_SEARCH_MAX = 100;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const ADMIN_MARKETPLACE_MESSAGES = {
  tabUnknown: 'Choose produce, inputs, buying requests, services or inactive.',
  statusUnknown: 'Choose active, paused, expired, withdrawn or completed.',
  categoryUnknown: 'Choose a category or a service type from the list.',
  flagUnknown: 'Choose reported or correction requested.',
  kindUnknown: 'Choose a product listing, a buying request or a service.',
  searchTooLong: `Search with at most ${MARKETPLACE_SEARCH_MAX} characters.`,
} as const;
const M = ADMIN_MARKETPLACE_MESSAGES;

/** A category of produce or buying request, or a service type. */
export const MARKETPLACE_CATEGORIES = [
  ...LISTING_CATEGORIES,
  ...SERVICE_TYPES.filter((t) => t !== 'other'),
] as const;

/** GET /api/admin/marketplace -- every filter, all optional but the tab. */
export const adminMarketplaceQuerySchema = z.strictObject({
  tab: z.enum(MARKETPLACE_TABS, { error: () => M.tabUnknown }).default('produce'),
  q: z
    .string({ error: () => M.searchTooLong })
    .trim()
    .max(MARKETPLACE_SEARCH_MAX, M.searchTooLong)
    .optional(),
  state_id: z
    .string({ error: () => ANALYTICS_MESSAGES.stateInvalid })
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/, ANALYTICS_MESSAGES.stateInvalid)
    .optional(),
  category: z
    .string({ error: () => M.categoryUnknown })
    .refine((c) => (MARKETPLACE_CATEGORIES as readonly string[]).includes(c), M.categoryUnknown)
    .optional(),
  /** Only on the Inactive tab: the other tabs hold live posts only. */
  status: z.enum(MARKETPLACE_STATUSES, { error: () => M.statusUnknown }).optional(),
  /** Only on the Inactive tab: one kind of post. */
  kind: z.enum(MARKETPLACE_KINDS, { error: () => M.kindUnknown }).optional(),
  flag: z.enum(MARKETPLACE_FLAGS, { error: () => M.flagUnknown }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type AdminMarketplaceQuery = z.infer<typeof adminMarketplaceQuerySchema>;

/** POST /api/admin/marketplace/:kind/:id/remove -- the reason is required and audited. */
export const marketplaceRemoveSchema = z.strictObject({
  reason: z
    .string({ error: () => STAFF_PERMISSION_MESSAGES.reasonRequired })
    .trim()
    .min(5, STAFF_PERMISSION_MESSAGES.reasonRequired)
    .max(500, STAFF_PERMISSION_MESSAGES.reasonTooLong),
  reason_code: reasonCodeSchema.optional(),
});
export type MarketplaceRemoveInput = z.infer<typeof marketplaceRemoveSchema>;

/**
 * The status staff see, from the stored one. A draft is the owner's own and
 * is never shown (null). `listed` (a product listing) and `active` (a request
 * or a service) are both live; `sold` reads as completed. A live post whose
 * end date is before today is expired. Dates are YYYY-MM-DD.
 */
export function marketplaceStatus(
  stored: string,
  endDate: string | null,
  today: string,
): MarketplaceStatus | null {
  switch (stored) {
    case 'listed':
    case 'active':
      return endDate !== null && endDate < today ? 'expired' : 'active';
    case 'paused':
      return 'paused';
    case 'withdrawn':
      return 'withdrawn';
    case 'sold':
    case 'completed':
      return 'completed';
    default:
      return null;
  }
}

/** Which kinds of post a tab reads, and what it asks of them. */
export interface TabSelection {
  readonly kinds: readonly MarketplaceKind[];
  /** For product listings: only inputs (true), never inputs (false), or either (null). */
  readonly inputs: boolean | null;
  readonly statuses: readonly MarketplaceStatus[];
}

/**
 * A tab's posts. The four live tabs hold active posts only; Inactive holds
 * the rest, narrowed by `status` and `kind` when they are given. A status
 * sent with a live tab is ignored rather than refused: those tabs are live by
 * definition.
 */
export function tabSelection(
  query: Pick<AdminMarketplaceQuery, 'tab' | 'status' | 'kind'>,
): TabSelection {
  switch (query.tab) {
    case 'produce':
      return { kinds: ['produce_listing'], inputs: false, statuses: ['active'] };
    case 'inputs':
      return { kinds: ['produce_listing'], inputs: true, statuses: ['active'] };
    case 'buying_requests':
      return { kinds: ['buying_request'], inputs: null, statuses: ['active'] };
    case 'services':
      return { kinds: ['service_listing'], inputs: null, statuses: ['active'] };
    case 'inactive': {
      const statuses =
        query.status && INACTIVE_STATUSES.includes(query.status)
          ? [query.status]
          : query.status
            ? []
            : INACTIVE_STATUSES;
      return {
        kinds: query.kind ? [query.kind] : MARKETPLACE_KINDS,
        inputs: null,
        statuses,
      };
    }
  }
}

/** One post as the console's list shows it. Staff only; never public. */
export interface AdminMarketplaceItem {
  kind: MarketplaceKind;
  id: string;
  title: string;
  /** Category of produce or buying request; service type for a service. */
  category: string;
  product: string;
  state_id: string;
  state_name: string;
  status: MarketplaceStatus;
  /** Available until / needed by, YYYY-MM-DD, or null. */
  end_date: string | null;
  created_at: string;
  updated_at: string;
  owner: {
    kind: 'farmer' | 'buyer';
    /** The farmer or buyer record: where the account's page is. */
    id: string | null;
    name: string;
    suspended: boolean;
  };
  organization: { id: string; name: string } | null;
  open_correction: boolean;
  open_reports: number;
}

/** A post removed by staff, from the audit trail (the post itself is soft-deleted). */
export interface RemovedMarketplaceItem {
  audit_id: string;
  kind: MarketplaceKind;
  id: string;
  /** Recorded at removal from 28 October 2026; absent for earlier removals. */
  title: string | null;
  reason: string | null;
  reason_code: string | null;
  /** 'console' when removed here; 'report' when removed from a report's queue. */
  via: 'console' | 'report';
  removed_at: string;
  removed_by: string | null;
}

/** One report about a post, as the inspect panel shows it. Never the reporter. */
export interface AdminMarketplaceReport {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
}

/** GET /api/admin/marketplace/:kind/:id -- one post, inspected. */
export interface AdminMarketplaceDetail extends AdminMarketplaceItem {
  /** The kind's own fields (description, quantity, price, photos ...). Never the contact phone. */
  details: Record<string, string | number | boolean | string[] | null>;
  reports: AdminMarketplaceReport[];
  corrections: ListingCorrection[];
}

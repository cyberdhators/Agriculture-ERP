import { z } from 'zod';

import { DISPLAY_TIME_ZONE, DISPLAY_UTC_OFFSET } from './staff-permissions';

/**
 * MARKETPLACE AND ACCOUNT ANALYTICS (2026-10-22). CORWADO's specification of
 * 16 October 2026, "Measures and exports": "Define the date window,
 * denominator and data source for each metric. Count people, accounts and
 * organizational profiles separately; explain overlapping actor categories."
 * And: "Buying requests, messages/inquiries, orders and completed trades
 * remain different measures."
 *
 * DEFINITIONS FIRST. Every figure the /analytics page shows, the Excel export
 * carries and the tests check is declared once, below, as data: what it
 * counts, over what, from which table, in which window and how a state filter
 * applies. The page, the Definitions sheet and the tests read this one list,
 * so a figure cannot be shown without the sentence that says what it is.
 *
 * 2026-10-25: advice usage and case resolution joined the list (the
 * "Advice" group): providers, approved advisers, requests, closures by
 * outcome, time to close, feedback, adviser applications and referrals.
 * Counts and averages only -- no question, message, comment or photo is read.
 */

// ---------------------------------------------------------------------------
// THE WINDOW
// ---------------------------------------------------------------------------

/** A window with no dates given: the last thirty Juba days, today included. */
export const ANALYTICS_DEFAULT_DAYS = 30;
/** The longest window: a leap year, so a whole calendar year always fits. */
export const ANALYTICS_MAX_DAYS = 366;

export const ANALYTICS_MESSAGES = {
  dateInvalid: 'Give the date as YYYY-MM-DD.',
  dateFuture: 'The window cannot end after today.',
  windowReversed: 'The window ends before it starts.',
  windowTooLong: `A window can be at most ${ANALYTICS_MAX_DAYS} days.`,
  stateInvalid: 'Choose a state from the list.',
} as const;

const M = ANALYTICS_MESSAGES;

const DAY_MS = 24 * 60 * 60 * 1000;

const JUBA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Juba, as YYYY-MM-DD, whatever the server's own clock zone. */
export function jubaToday(now: Date = new Date()): string {
  return JUBA_DATE.format(now);
}

/** Whole days between two YYYY-MM-DD dates, `to` minus `from`. */
const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );

const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const isRealDate = (d: string): boolean => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

const dateField = z
  .string({ error: () => M.dateInvalid })
  .regex(/^\d{4}-\d{2}-\d{2}$/, M.dateInvalid)
  .refine(isRealDate, M.dateInvalid);

/**
 * GET /api/analytics/summary (query) and POST /api/analytics/export
 * (`filters`). Both dates are Juba calendar days and both are included.
 * Omitted, `to` is today and `from` is 29 days before `to`.
 */
export const analyticsFilterSchema = z
  .strictObject({
    from: dateField.optional(),
    to: dateField.optional(),
    state_id: z
      .string({ error: () => M.stateInvalid })
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/, M.stateInvalid)
      .optional(),
  })
  .superRefine((f, ctx) => {
    const today = jubaToday();
    if (f.to && f.to > today) {
      ctx.addIssue({ code: 'custom', message: M.dateFuture, path: ['to'] });
      return;
    }
    if (f.from && !f.to && f.from > today) {
      ctx.addIssue({ code: 'custom', message: M.dateFuture, path: ['from'] });
      return;
    }
    const to = f.to ?? today;
    if (f.from && f.from > to) {
      ctx.addIssue({ code: 'custom', message: M.windowReversed, path: ['to'] });
      return;
    }
    if (f.from && daysBetween(f.from, to) + 1 > ANALYTICS_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', message: M.windowTooLong, path: ['from'] });
    }
  });
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

/** POST /api/analytics/export: the same filters as the page. */
export const analyticsExportSchema = z.strictObject({
  filters: analyticsFilterSchema.optional(),
});
export type AnalyticsExportRequest = z.infer<typeof analyticsExportSchema>;

export interface AnalyticsWindow {
  /** First Juba day included, YYYY-MM-DD. */
  readonly from: string;
  /** Last Juba day included, YYYY-MM-DD. Also the export's data cut-off. */
  readonly to: string;
  readonly days: number;
  /** The instant the first day starts in Juba. */
  readonly startsAt: Date;
  /** The instant after the last day ends in Juba (exclusive). */
  readonly endsAt: Date;
}

/** The window a validated filter means, defaults filled in. */
export function resolveAnalyticsWindow(
  filter: Pick<AnalyticsFilter, 'from' | 'to'>,
  now: Date = new Date(),
): AnalyticsWindow {
  const to = filter.to ?? jubaToday(now);
  const from = filter.from ?? addDays(to, -(ANALYTICS_DEFAULT_DAYS - 1));
  return {
    from,
    to,
    days: daysBetween(from, to) + 1,
    startsAt: new Date(`${from}T00:00:00${DISPLAY_UTC_OFFSET}`),
    endsAt: new Date(`${addDays(to, 1)}T00:00:00${DISPLAY_UTC_OFFSET}`),
  };
}

// ---------------------------------------------------------------------------
// THE DEFINITIONS
// ---------------------------------------------------------------------------

export const METRIC_GROUPS = [
  'accounts',
  'participation',
  'marketplace',
  'advice',
  'system',
] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

export const METRIC_GROUP_LABELS: Readonly<Record<MetricGroup, string>> = {
  accounts: 'Accounts',
  participation: 'Participation',
  marketplace: 'Marketplace',
  advice: 'Advice',
  system: 'System',
};

/** What a metric counts: the unit is part of the definition, never implied. */
export type MetricUnit =
  | 'people'
  | 'accounts'
  | 'profiles'
  | 'records'
  | 'events'
  | 'phones'
  // 2026-10-25: a median and an average (advice), not counts.
  | 'days'
  | 'stars';

export interface MetricDefinition {
  readonly id: string;
  readonly group: MetricGroup;
  readonly label: string;
  readonly unit: MetricUnit;
  /** One sentence: exactly what is counted. */
  readonly definition: string;
  /** What the figure is a share of, or that it is a plain count. */
  readonly denominator: string;
  /** The table or view it is read from. */
  readonly source: string;
  /** How the date window applies: "created in the window", "now", and so on. */
  readonly window: string;
  /**
   * How a state filter applies. `null` means the rows carry no location, so
   * the figure is national only and is not served under a state filter.
   */
  readonly stateRule: string | null;
  /** Present when the figure is served with a breakdown. */
  readonly breakdown?: {
    readonly label: string;
    /** Labels for fixed keys; keys not listed are shown as they come. */
    readonly keys?: Readonly<Record<string, string>>;
    /** True when one row can fall in several keys, so the keys do not sum to the total. */
    readonly overlapping?: boolean;
  };
}

const COUNT = 'None: a count.';
const IN_WINDOW = 'Created in the window (Juba days, both ends included).';
const NOW = 'As it stands now; the window does not apply.';

/** ADVICE_TOPICS (advice-topics.ts), in words. */
const ADVICE_TOPIC_KEYS = {
  crops: 'Crops',
  livestock: 'Livestock',
  soil_fertiliser: 'Soil and fertiliser',
  pests_diseases: 'Pests and diseases',
  water_irrigation: 'Water and irrigation',
  post_harvest: 'Post-harvest and storage',
  marketing_prices: 'Marketing and prices',
  finance_business: 'Finance and business',
  climate_weather: 'Climate and weather',
  other: 'Other',
} as const;

const ACCOUNT_KIND_KEYS = {
  farmer: 'Farmer accounts',
  buyer: 'Buyer accounts',
  officer: 'Extension officers',
  user: 'Staff',
} as const;

const ACCOUNT_STATE_RULE =
  "A farmer by the farmer's state; a buyer by the buyer organisation's state (a buyer with no " +
  "state is counted only nationally); an officer by the officer's state; staff by their state scope.";

export const ANALYTICS_METRICS: readonly MetricDefinition[] = [
  // ---- Accounts -----------------------------------------------------------
  {
    id: 'accounts.new',
    group: 'accounts',
    label: 'New sign-in accounts',
    unit: 'accounts',
    definition:
      'Distinct sign-in accounts whose farmer or buyer account was created in the window. A ' +
      'person holding both a farmer and a buyer account is one sign-in account, counted once in ' +
      'the total and once under each kind.',
    denominator: COUNT,
    source:
      "access_log (event 'account_created'), joined to farmer and buyer for the sign-in account",
    window: IN_WINDOW,
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: {
      label: 'Kind of account',
      keys: { farmer: ACCOUNT_KIND_KEYS.farmer, buyer: ACCOUNT_KIND_KEYS.buyer },
      overlapping: true,
    },
  },
  {
    id: 'farmers.registered',
    group: 'accounts',
    label: 'New farmer records',
    unit: 'records',
    definition:
      'Farmer records created in the window, by who registered them: the farmer on their own ' +
      'phone, or an extension officer. A record is not an account: most officer-registered ' +
      'farmers never sign in. Every status is counted here; verification is counted separately.',
    denominator: COUNT,
    source: 'farmer (registration_source), soft-deleted records excluded',
    window: IN_WINDOW,
    stateRule: "The farmer's state.",
    breakdown: {
      label: 'Registered by',
      keys: { self: 'Self-registered', officer: 'Registered by an officer' },
    },
  },
  {
    id: 'farmers.verified',
    group: 'accounts',
    label: 'Farmers verified',
    unit: 'people',
    definition:
      'Distinct farmers given a "verified" decision in the window who are still verified now. ' +
      'Pending and rejected records are never folded in; they are the two figures below.',
    denominator: COUNT,
    source: "verification_event (decision 'verified'), joined to farmer_verified_v",
    window: 'Decision made in the window.',
    stateRule: "The farmer's state.",
  },
  {
    id: 'farmers.rejected',
    group: 'accounts',
    label: 'Farmer records rejected',
    unit: 'records',
    definition:
      'Distinct farmer records given a "rejected" decision in the window, counted separately ' +
      'from verified farmers.',
    denominator: COUNT,
    source: "verification_event (decision 'rejected'), soft-deleted records excluded",
    window: 'Decision made in the window.',
    stateRule: "The farmer's state.",
  },
  {
    id: 'farmers.pending_now',
    group: 'accounts',
    label: 'Farmer records waiting for verification',
    unit: 'records',
    definition: 'Farmer records whose status is pending now, counted separately from verified.',
    denominator: COUNT,
    source: "farmer (verification_status 'pending'), soft-deleted records excluded",
    window: NOW,
    stateRule: "The farmer's state.",
  },
  {
    id: 'buyers.registered',
    group: 'accounts',
    label: 'New buyer profiles',
    unit: 'profiles',
    definition:
      'Buyer profiles created in the window: organisations (business) and individual buyers ' +
      'counted apart. An organisation is one profile however many people act for it.',
    denominator: COUNT,
    source: 'buyer_organization (account_type), soft-deleted profiles excluded',
    window: IN_WINDOW,
    stateRule: "The organisation's state; a profile with no state is counted only nationally.",
    breakdown: {
      label: 'Kind of buyer',
      keys: { business: 'Organisations', individual: 'Individual buyers' },
    },
  },
  {
    id: 'buyers.verified',
    group: 'accounts',
    label: 'Organisations verified',
    unit: 'profiles',
    definition:
      'Buyer organisations (business) verified in the window and still verified now. ' +
      'Individual buyers are not verified, so they are not in this figure.',
    denominator: COUNT,
    source: "buyer_organization (verification_status 'verified', verified_at)",
    window: 'Verified in the window.',
    stateRule: "The organisation's state; a profile with no state is counted only nationally.",
  },
  {
    id: 'onboarding.phones_started',
    group: 'accounts',
    label: 'Phones sent a sign-up code',
    unit: 'phones',
    definition:
      'Distinct phone numbers sent a farmer sign-up code in the window. A phone, not a person: ' +
      'one person may ask from two phones, and one shared phone may serve two people.',
    denominator: COUNT,
    source: "phone_verification (purpose 'farmer_sign_up')",
    window: 'Code sent in the window.',
    stateRule: null,
  },
  {
    id: 'onboarding.phones_confirmed',
    group: 'accounts',
    label: 'Phones that confirmed the code',
    unit: 'phones',
    definition:
      'Of the phones sent a sign-up code in the window, those that entered a correct code. The ' +
      'gap between the two is the onboarding drop-off at the phone step.',
    denominator: 'Phones sent a sign-up code in the same window.',
    source: 'phone_verification (verified_at set)',
    window: 'Code sent in the window.',
    stateRule: null,
  },
  {
    id: 'access.first_sign_ins',
    group: 'accounts',
    label: 'New: first sign-ins',
    unit: 'accounts',
    definition: 'Accounts that signed in for the first time ever during the window.',
    denominator: COUNT,
    source: "access_log (event 'first_sign_in')",
    window: 'First sign-in in the window.',
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: { label: 'Kind of account', keys: ACCOUNT_KIND_KEYS },
  },
  {
    id: 'access.active',
    group: 'accounts',
    label: 'Active accounts',
    unit: 'accounts',
    definition:
      'Accounts seen in the window: at least one first sign-in, sign-in or return session.',
    denominator: COUNT,
    source: "access_log (events 'first_sign_in', 'sign_in', 'return_session')",
    window: 'Seen in the window.',
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: { label: 'Kind of account', keys: ACCOUNT_KIND_KEYS },
  },
  {
    id: 'access.returning',
    group: 'accounts',
    label: 'Returning active accounts',
    unit: 'accounts',
    definition:
      'Active accounts in the window whose first sign-in was not in the window: they had used ' +
      'the platform before.',
    denominator: 'Active accounts in the same window.',
    source: 'access_log',
    window: 'Seen in the window; first sign-in before it.',
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: { label: 'Kind of account', keys: ACCOUNT_KIND_KEYS },
  },
  {
    id: 'access.sessions',
    group: 'accounts',
    label: 'Sign-ins and return sessions',
    unit: 'events',
    definition:
      'Every first sign-in, later sign-in and return session (a signed-in visit after 30 ' +
      'minutes without activity) in the window, each shown separately. Events, not accounts.',
    denominator: COUNT,
    source: 'access_log',
    window: 'Occurred in the window.',
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: {
      label: 'Event',
      keys: {
        first_sign_in: 'First sign-in',
        sign_in: 'Later sign-in',
        return_session: 'Return session',
      },
    },
  },

  // ---- Participation --------------------------------------------------------
  {
    id: 'participation.by_state',
    group: 'participation',
    label: 'Active accounts by state',
    unit: 'accounts',
    definition:
      'Farmer and buyer accounts seen in the window, by state. A buyer organisation with no ' +
      'state is shown as "No state given".',
    denominator: COUNT,
    source: 'access_log, located through farmer and buyer_organization',
    window: 'Seen in the window.',
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: { label: 'State', keys: { none: 'No state given' } },
  },
  {
    id: 'participation.activities',
    group: 'participation',
    label: 'What account holders do',
    unit: 'accounts',
    definition:
      'Sign-in accounts by the activities chosen under "What you do". One account may choose ' +
      'several (farmer and trader, say), so the activities overlap and do not sum to the total, ' +
      'which counts each account once.',
    denominator: COUNT,
    source: 'account_profile (activities), for accounts with a farmer or buyer record',
    window: NOW,
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: {
      label: 'Activity',
      overlapping: true,
      keys: {
        farmer: 'Farmer',
        trader: 'Trader',
        processor: 'Processor',
        input_supplier: 'Input supplier',
        transport: 'Transport',
        other_services: 'Other services',
        knowledge_provider: 'Knowledge provider',
        financial_services: 'Financial services',
        buyer: 'Buyer',
      },
    },
  },
  {
    id: 'participation.profile_kinds',
    group: 'participation',
    label: 'Account profiles by kind',
    unit: 'profiles',
    definition:
      'Sign-in accounts by the kind of profile they present: an individual, a group, a business ' +
      'or an institution. Each account has exactly one kind.',
    denominator: COUNT,
    source: 'account_profile (profile_kind), for accounts with a farmer or buyer record',
    window: NOW,
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: {
      label: 'Kind of profile',
      keys: {
        individual: 'Individual',
        group: 'Group',
        business: 'Business',
        institution: 'Institution',
      },
    },
  },

  // ---- Marketplace ----------------------------------------------------------
  {
    id: 'listings.created',
    group: 'marketplace',
    label: 'Produce listings created',
    unit: 'records',
    definition: 'Produce listings created in the window, drafts included.',
    denominator: COUNT,
    source: 'produce_listing, soft-deleted listings excluded',
    window: IN_WINDOW,
    stateRule: "The listing's state.",
  },
  {
    id: 'listings.active_now',
    group: 'marketplace',
    label: 'Produce listings on the market now',
    unit: 'records',
    definition:
      'Produce listings that are live (listed) now: not drafts, paused, withdrawn or completed.',
    denominator: COUNT,
    source: "produce_listing (status 'listed')",
    window: NOW,
    stateRule: "The listing's state.",
  },
  {
    id: 'listings.completed',
    group: 'marketplace',
    label: 'Produce listings completed',
    unit: 'records',
    definition:
      'Distinct produce listings closed as completed (or the older "sold") in the window and ' +
      'still completed now. A listing closes when its owner says it is fulfilled or nothing is left.',
    denominator: COUNT,
    source:
      "audit_event (listing.status_changed to 'completed' or 'sold'), joined to produce_listing",
    window: 'Closed in the window.',
    stateRule: "The listing's state.",
  },
  {
    id: 'trades.sales_recorded',
    group: 'marketplace',
    label: 'Sales recorded by farmers',
    unit: 'events',
    definition:
      'Sales a farmer recorded against their own listing in the window (each recording reduces ' +
      'the quantity left). Self-reported: nobody else confirms them.',
    denominator: COUNT,
    source:
      "audit_event on produce_listing whose 'after' carries sale_quantity (POST " +
      '/api/farmer/listings/:id/sales)',
    window: 'Recorded in the window.',
    stateRule: "The listing's state.",
  },
  {
    id: 'trades.orders_delivered',
    group: 'marketplace',
    label: 'Orders delivered',
    unit: 'records',
    definition:
      'Distinct purchase orders marked delivered or completed in the window. A confirmed trade ' +
      'through the platform, counted apart from the self-reported sales above.',
    denominator: COUNT,
    source: "delivery_update (status 'delivered' or 'completed'), joined to purchase_order",
    window: 'Delivered in the window.',
    stateRule: "The listing's state (where the produce is).",
  },
  {
    id: 'orders.created',
    group: 'marketplace',
    label: 'Purchase orders created',
    unit: 'records',
    definition: 'Purchase orders created in the window, whatever their status since.',
    denominator: COUNT,
    source: 'purchase_order, soft-deleted orders excluded',
    window: IN_WINDOW,
    stateRule: "The listing's state (where the produce is).",
  },
  {
    id: 'purchase_requests.sent',
    group: 'marketplace',
    label: 'Purchase requests sent',
    unit: 'records',
    definition:
      'Purchase requests a buyer submitted in the window (drafts never sent are not counted).',
    denominator: COUNT,
    source: 'purchase_request (submitted_at), soft-deleted requests excluded',
    window: 'Submitted in the window.',
    stateRule:
      "The buyer organisation's state; a profile with no state is counted only nationally.",
  },
  {
    id: 'buying_requests.created',
    group: 'marketplace',
    label: 'Buying requests posted',
    unit: 'records',
    definition:
      'Buying requests ("I want to buy") created in the window by farmers or buyers, drafts ' +
      'included. Not purchase requests, not orders.',
    denominator: COUNT,
    source: 'buying_request, soft-deleted requests excluded',
    window: IN_WINDOW,
    stateRule: "The request's state.",
    breakdown: { label: 'Posted by', keys: { farmer: 'Farmers', buyer: 'Buyers' } },
  },
  {
    id: 'buying_requests.active_now',
    group: 'marketplace',
    label: 'Buying requests open now',
    unit: 'records',
    definition: 'Buying requests that are active now.',
    denominator: COUNT,
    source: "buying_request (status 'active')",
    window: NOW,
    stateRule: "The request's state.",
  },
  {
    id: 'services.created',
    group: 'marketplace',
    label: 'Service listings created',
    unit: 'records',
    definition:
      'Service listings (tractor hire, transport, processing, storage, other) created in the window.',
    denominator: COUNT,
    source: 'service_listing, soft-deleted listings excluded',
    window: IN_WINDOW,
    stateRule: "The service's state.",
    breakdown: {
      label: 'Service',
      keys: {
        tractor_hire: 'Tractor hire',
        transport: 'Transport',
        processing: 'Processing',
        storage: 'Storage',
        other: 'Other',
      },
    },
  },
  {
    id: 'services.active_now',
    group: 'marketplace',
    label: 'Service listings offered now',
    unit: 'records',
    definition: 'Service listings that are active now.',
    denominator: COUNT,
    source: "service_listing (status 'active')",
    window: NOW,
    stateRule: "The service's state.",
  },
  {
    id: 'messages.conversations',
    group: 'marketplace',
    label: 'Conversations started',
    unit: 'records',
    definition:
      'In-app conversations started in the window, by the kind of post they are about. A count ' +
      'only: no message text is read.',
    denominator: COUNT,
    source: 'conversation',
    window: IN_WINDOW,
    stateRule: 'The state of the post the conversation is about.',
    breakdown: {
      label: 'About',
      keys: { listing: 'Produce listing', buying_request: 'Buying request', service: 'Service' },
    },
  },
  {
    id: 'messages.sent',
    group: 'marketplace',
    label: 'Messages sent',
    unit: 'records',
    definition: 'In-app messages sent in the window. A count only: no message text is read.',
    denominator: COUNT,
    source: 'message, deleted messages excluded',
    window: 'Sent in the window.',
    stateRule: 'The state of the post the conversation is about.',
  },
  {
    id: 'inquiries.contact_requests',
    group: 'marketplace',
    label: 'Visitor contact requests',
    unit: 'records',
    definition:
      'Requests from visitors without an account to be put in touch about a produce listing.',
    denominator: COUNT,
    source: 'contact_request',
    window: IN_WINDOW,
    stateRule: "The listing's state.",
  },
  {
    id: 'moderation.reports',
    group: 'marketplace',
    label: 'Reports about posts',
    unit: 'records',
    definition:
      'Reports received in the window about a produce listing, a buying request or a service.',
    denominator: COUNT,
    source: 'product_report and market_report, soft-deleted reports excluded',
    window: 'Received in the window.',
    stateRule: "The reported post's state.",
    breakdown: {
      label: 'About',
      keys: {
        listing: 'Produce listing',
        buying_request: 'Buying request',
        service_listing: 'Service',
      },
    },
  },
  {
    id: 'support.received',
    group: 'marketplace',
    label: 'Support messages received',
    unit: 'records',
    definition: 'Messages sent to CORWADO through "Contact CORWADO" in the window, by topic.',
    denominator: COUNT,
    source: 'support_message, soft-deleted messages excluded',
    window: 'Received in the window.',
    stateRule: null,
    breakdown: {
      label: 'Topic',
      keys: {
        account: 'Account',
        marketplace: 'Marketplace',
        messages: 'Messages',
        technical: 'Technical',
        other: 'Other',
      },
    },
  },
  {
    id: 'accounts.suspended_now',
    group: 'marketplace',
    label: 'Accounts suspended now',
    unit: 'accounts',
    definition: 'Farmer and buyer accounts under suspension now.',
    denominator: COUNT,
    source: 'farmer and buyer (suspended_at set), soft-deleted accounts excluded',
    window: NOW,
    stateRule: ACCOUNT_STATE_RULE,
    breakdown: {
      label: 'Kind of account',
      keys: { farmer: ACCOUNT_KIND_KEYS.farmer, buyer: ACCOUNT_KIND_KEYS.buyer },
    },
  },

  // ---- Advice (2026-10-25) --------------------------------------------------
  {
    id: 'advice.providers_published',
    group: 'advice',
    label: 'Advice providers published',
    unit: 'profiles',
    definition:
      'Advice profiles published by their owners now whose account is live (not removed or ' +
      'suspended): the providers the directory shows. Publishing needs no review, so this is ' +
      'not a count of approved advisers.',
    denominator: COUNT,
    source:
      "advice_provider (status 'published'), soft-deleted profiles excluded, account live " +
      'through farmer and buyer',
    window: NOW,
    stateRule: null,
  },
  {
    id: 'advice.approved_advisers',
    group: 'advice',
    label: 'Approved advisers',
    unit: 'profiles',
    definition:
      'Advice providers holding an "Approved adviser" approval now: approved by CORWADO and ' +
      'not revoked since, whether or not their profile is published at the moment.',
    denominator: COUNT,
    source: 'advice_provider (approved_at set), soft-deleted profiles excluded',
    window: NOW,
    stateRule: null,
  },
  {
    id: 'advice.requests',
    group: 'advice',
    label: 'Advice requests made',
    unit: 'records',
    definition:
      'Advice requests (cases) created in the window, by topic. A case opened by an accepted ' +
      'referral is a new case and is counted too; referrals themselves are counted below. A ' +
      'count only: no question is read.',
    denominator: COUNT,
    source: 'advice_case (topic), soft-deleted cases excluded',
    window: IN_WINDOW,
    stateRule: null,
    breakdown: { label: 'Topic', keys: ADVICE_TOPIC_KEYS },
  },
  {
    id: 'advice.cases_closed',
    group: 'advice',
    label: 'Advice cases closed',
    unit: 'records',
    definition:
      'Advice cases closed in the window, by outcome: resolved and cancelled are the ' +
      "requester's to choose, referred is the provider's (or follows an accepted referral), and " +
      'either may close a case unresolved.',
    denominator: COUNT,
    source: "advice_case (status 'closed', outcome, closed_at), soft-deleted cases excluded",
    window: 'Closed in the window.',
    stateRule: null,
    breakdown: {
      label: 'Outcome',
      keys: {
        resolved: 'Resolved',
        referred: 'Referred to another provider',
        closed_unresolved: 'Closed unresolved',
        cancelled: 'Cancelled',
      },
    },
  },
  {
    id: 'advice.median_days_to_close',
    group: 'advice',
    label: 'Median days to close an advice case',
    unit: 'days',
    definition:
      'The median time from a case being created to its being closed, in days to one decimal ' +
      'place, over the cases closed in the window, whatever the outcome. Shown as not measured, ' +
      'never as 0, when no case closed in the window.',
    denominator: 'Advice cases closed in the same window.',
    source: 'advice_case (created_at, closed_at), soft-deleted cases excluded',
    window: 'Closed in the window.',
    stateRule: null,
  },
  {
    id: 'advice.feedback_given',
    group: 'advice',
    label: 'Advice feedback given',
    unit: 'records',
    definition:
      'Advice cases the requester rated in the window (once per case, after it closed), by the ' +
      'number of stars given. A count only: no comment is read.',
    denominator: COUNT,
    source:
      'audit_event (advice_case.feedback), joined to advice_case (feedback_rating), ' +
      'soft-deleted cases excluded',
    window: 'Rated in the window.',
    stateRule: null,
    breakdown: {
      label: 'Rating',
      keys: { '1': '1 star', '2': '2 stars', '3': '3 stars', '4': '4 stars', '5': '5 stars' },
    },
  },
  {
    id: 'advice.average_rating',
    group: 'advice',
    label: 'Average advice rating',
    unit: 'stars',
    definition:
      'The average of the ratings (1 to 5 stars) given in the window, to one decimal place. ' +
      'Shown as not measured, never as 0, when no rating was given in the window.',
    denominator: 'Advice feedback given in the same window.',
    source:
      'audit_event (advice_case.feedback), joined to advice_case (feedback_rating), ' +
      'soft-deleted cases excluded',
    window: 'Rated in the window.',
    stateRule: null,
  },
  {
    id: 'advice.applications_submitted',
    group: 'advice',
    label: 'Adviser applications submitted',
    unit: 'records',
    definition:
      'Applications to be an approved adviser submitted in the window, whatever has happened ' +
      'to them since. An application made again after a decline is counted again.',
    denominator: COUNT,
    source: 'adviser_application (created_at), soft-deleted applications excluded',
    window: 'Submitted in the window.',
    stateRule: null,
  },
  {
    id: 'advice.applications_decided',
    group: 'advice',
    label: 'Adviser applications decided',
    unit: 'records',
    definition:
      'Applications CORWADO approved or declined in the window, whenever they were submitted. ' +
      'A later revocation does not remove an approval from the window it was given in.',
    denominator: COUNT,
    source: 'audit_event (adviser_application.approved, adviser_application.declined)',
    window: 'Decided in the window.',
    stateRule: null,
    breakdown: { label: 'Decision', keys: { approved: 'Approved', declined: 'Declined' } },
  },
  {
    id: 'advice.referrals',
    group: 'advice',
    label: 'Advice referrals proposed',
    unit: 'records',
    definition:
      'Referrals a provider proposed in the window, by where they stand now: waiting for the ' +
      'requester, accepted (a new case was opened with the other provider), declined by the ' +
      'requester, or withdrawn.',
    denominator: COUNT,
    source: 'advice_referral (status), soft-deleted referrals excluded',
    window: 'Proposed in the window.',
    stateRule: null,
    breakdown: {
      label: 'Now',
      keys: {
        proposed: 'Waiting for the requester',
        accepted: 'Accepted',
        declined: 'Declined',
        withdrawn: 'Withdrawn',
      },
    },
  },

  // ---- System ---------------------------------------------------------------
  {
    id: 'system.failures',
    group: 'system',
    label: 'Recorded failures',
    unit: 'events',
    definition:
      'Failures the server recorded in the window: a visit photo that never arrived, an email ' +
      'or SMS that could not be sent, a sign-in account that could not be disabled, sessions ' +
      'that could not be revoked.',
    denominator: COUNT,
    source:
      'audit_event (visit.attachment_failed, communication.send_failed, auth.disable_failed, ' +
      'staff.sessions_revoke_failed)',
    window: 'Recorded in the window.',
    stateRule: null,
    breakdown: {
      label: 'Failure',
      keys: {
        'visit.attachment_failed': 'Visit photo did not arrive',
        'communication.send_failed': 'Email or SMS not sent',
        'auth.disable_failed': 'Sign-in not disabled',
        'staff.sessions_revoke_failed': 'Sessions not revoked',
      },
    },
  },
];

/** What every analytics page and export says it cannot show. */
export const ANALYTICS_LIMITATIONS: readonly string[] = [
  'Advice figures are national only: an advice case carries no state. They are counts and ' +
    'averages; no question, message, comment or photo is read.',
  'Whether advice changed a yield or an income is not measured: advice given is not evidence ' +
    'of either.',
  'A median or an average with nothing in the window to measure is shown as not measured, ' +
    'never as 0.',
  'Sync rejections are kept on the phone with their reason code and are not reported to the ' +
    'server, so they are not counted. Failed exports and failed page loads are not recorded either.',
  'Sales recorded by farmers are self-reported. Only delivered purchase orders are confirmed trades.',
  'Buying requests, purchase requests, messages, contact requests, orders and completed trades ' +
    'are different measures and are never added together.',
  'Sign-in history starts when the access log was switched on; accounts active only before then ' +
    'have no sign-in events.',
  'Phone sign-up codes and support messages carry no state, so they are national figures only.',
  'Buyer organisations that gave no state are counted only in national figures.',
  'Charts in the Excel file are not editable yet: the file carries the numbers and definitions.',
];

/** One figure as the summary route serves it. */
export interface AnalyticsMetricValue {
  readonly id: string;
  /** Null when the figure cannot be produced; `unavailable` says why. Never a silent zero. */
  readonly value: number | null;
  readonly unavailable?: 'not_located' | 'not_in_database' | 'none_in_window';
  readonly breakdown?: readonly { key: string; label?: string; value: number }[];
}

export interface AnalyticsSummary {
  readonly window: { from: string; to: string; days: number; time_zone: string };
  readonly state_id: string | null;
  /** The states the figures are limited to; null means national. */
  readonly scope_states: readonly string[] | null;
  readonly generated_at: string;
  readonly metrics: readonly AnalyticsMetricValue[];
  readonly limitations: readonly string[];
}

/** Why a figure is missing, in words for the page and the export. */
export const UNAVAILABLE_TEXT: Readonly<
  Record<NonNullable<AnalyticsMetricValue['unavailable']>, string>
> = {
  not_located: 'These rows carry no state, so the figure is national only.',
  not_in_database: 'The table behind this figure is not in the database yet.',
  none_in_window: 'Nothing in the window to take a median or an average of.',
};

export const metricDefinition = (id: string): MetricDefinition | undefined =>
  ANALYTICS_METRICS.find((m) => m.id === id);

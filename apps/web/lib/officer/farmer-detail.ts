import { canTransition, type VerificationState } from '@agri-erp/shared';

import type { Farmer } from '@/lib/fixtures/farmers';

/**
 * THE OFFICER'S VIEW OF ONE FARMER, AS PURE FUNCTIONS.
 *
 * "Who is this, what is their status, and what can I do next?" -- three
 * questions, and the third is the one the administrator's dossier answers
 * differently. That screen offers verify, reject, merge, reassign and remove
 * because an administrator holds those decisions. An officer holds one:
 * correcting a rejected registration and sending it back.
 *
 * WHAT THIS DOES NOT DO IS AUTHORISE. `GET /api/farmers/:id` runs
 * `loadVisible`, which appends the caseload clause before the row is read, so
 * a farmer outside this officer's caseload comes back as 404 -- the same answer
 * a farmer who never existed gets. No function here checks ownership, and none
 * should: a client-side check standing in for that clause would be a screen
 * pretending to be a gate.
 */

/**
 * The detail rows, built only from keys the route actually sent.
 *
 * C-5.8 HAS THREE STATES AND ALL THREE SURVIVE. A string is a value; `null` is
 * "the officer was told, and there is none"; ABSENT is "this role was not told"
 * and must render as nothing at all -- not as a dash, not as "None recorded",
 * which is the screen answering a question it was never given. The national ID
 * reaches the officer who works the farmer, in full: masking it would still
 * announce that an identity document exists, which is the thing C-5.8 is
 * protecting.
 */
export interface DetailRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** True for values read in a hurry from a phone: numbers, ids, codes. */
  readonly mono?: boolean;
}

const has = <K extends string>(row: object, key: K): boolean => key in row;

export function identityRows(farmer: Farmer): DetailRow[] {
  const rows: DetailRow[] = [];
  const push = (key: string, label: string, value: unknown, mono = false) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ key, label, value: String(value), mono });
  };

  push('farmer_number', 'Farmer number', farmer.farmer_number, true);
  push('phone', 'Phone', farmer.phone, true);
  push('sex', 'Sex', farmer.sex === 'f' ? 'Female' : farmer.sex === 'm' ? 'Male' : undefined);
  push('year_of_birth', 'Year of birth', farmer.year_of_birth, true);

  // The key is present only when the route sent it. An officer entitled to the
  // id sees it whole; an officer not entitled sees no row, not an empty one.
  if (has(farmer, 'national_id') && farmer.national_id) {
    rows.push({
      key: 'national_id',
      label: 'National ID',
      value: farmer.national_id,
      mono: true,
    });
  }

  push('state_id', 'State', farmer.state_id, true);
  push('county_id', 'County', (farmer as { county_id?: string }).county_id, true);
  push('payam_id', 'Payam', farmer.payam_id, true);
  return rows;
}

/**
 * Whether the officer was TOLD there is no national ID, as distinct from not
 * being told anything. Only the first deserves a sentence on the screen.
 */
export const wasToldNoNationalId = (farmer: Farmer): boolean =>
  has(farmer, 'national_id') && farmer.national_id === null;

/** The status a screen should show, with a merge taking precedence. */
export const statusOf = (farmer: Farmer): VerificationState =>
  (farmer.merged_into ? 'merged' : farmer.verification_status) as VerificationState;

/**
 * What this officer may do, asked of the same transition table the route uses.
 *
 * `POST /api/farmers/:id/resubmit` runs `transitionFarmer`, which admits
 * `rejected → pending` and nothing else, so the button exists for a rejected
 * record and for no other. Everything an administrator may do is absent -- not
 * disabled: a greyed control still claims the system could do it for you.
 */
export interface OfficerActions {
  readonly canResubmit: boolean;
  readonly canEdit: boolean;
}

export function officerActions(farmer: Farmer): OfficerActions {
  const status = statusOf(farmer);
  if (status === 'merged') return { canResubmit: false, canEdit: false };
  return {
    canResubmit: status === 'rejected' && canTransition('rejected', 'pending'),
    // PATCH /api/farmers/:id accepts admin and officer (C-5.9), and a merged
    // record is nobody's to edit.
    canEdit: true,
  };
}

/**
 * The rejection, only where the route supplied one.
 *
 * C-6.3 sends the reason code with the record while it is rejected. The code
 * is the vocabulary; nothing here writes an explanation of its own, because an
 * invented sentence would be this screen telling the officer why a supervisor
 * decided something it does not know.
 */
export interface RejectionNote {
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly decidedAt: string | null;
}

export function rejectionOf(farmer: Farmer): RejectionNote | null {
  if (statusOf(farmer) !== 'rejected') return null;
  const rejection = farmer.rejection;
  if (!rejection) return null;
  return {
    reasonCode: rejection.reason_code ?? null,
    note: rejection.note ?? null,
    decidedAt: rejection.decided_at ?? null,
  };
}

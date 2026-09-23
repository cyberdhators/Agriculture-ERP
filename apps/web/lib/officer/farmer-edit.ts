import { patchFarmerSchema, type PatchFarmer } from '@agri-erp/shared';

import type { Farmer } from '@/lib/fixtures/farmers';

/**
 * WHAT AN OFFICER MAY CHANGE ABOUT THEIR OWN FARMER.
 *
 * Every rule below is read off `PATCH /api/farmers/:id` rather than decided
 * here, because a form that permits more than the route does is a form that
 * produces 403s, and one that permits less hides a capability the officer has.
 *
 * THE ROUTE'S THREE GUARDS, IN ITS OWN ORDER:
 *
 *   1. `loadVisible` — the caseload clause is in the WHERE, so somebody else's
 *      farmer is a 404 before any of this is reached. Nothing in this file
 *      checks ownership and nothing should.
 *   2. Status — an officer may edit a record that is `pending` or `rejected`
 *      and nothing else (C-5.9 as amended by B6: a rejected record must be
 *      correctable). A verified record answers 403.
 *   3. Payam — if `payam_id` is sent it must equal the officer's own payam.
 *      There is exactly one legal value, which is why this is offered as a
 *      single move rather than a picker.
 *
 * `patchFarmerSchema` is strict, so a field not in it cannot be sent at all:
 * `verification_status`, `caseload_officer_id` and `merged_into` are not
 * omissions here, they are rejected by the schema before the route reads them.
 */

/** Exactly the keys `patchFarmerSchema` accepts, from the schema itself. */
export const EDITABLE_FIELDS = Object.keys(patchFarmerSchema.shape) as (keyof PatchFarmer)[];

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Why the form is closed, in the words the screen should use. */
export type EditRefusal = 'merged' | 'not_correctable';

export interface EditEligibility {
  readonly canEdit: boolean;
  readonly refusal: EditRefusal | null;
}

/**
 * Whether the route would accept a patch for this record from an officer.
 *
 * Mirrors guard 2. A verified farmer is not editable by the officer who
 * registered them -- the record has been accepted, and changing it afterwards
 * is a supervisor's business.
 */
export function editEligibility(farmer: Farmer): EditEligibility {
  if (farmer.merged_into) return { canEdit: false, refusal: 'merged' };
  const status = farmer.verification_status;
  if (status !== 'pending' && status !== 'rejected') {
    return { canEdit: false, refusal: 'not_correctable' };
  }
  return { canEdit: true, refusal: null };
}

/**
 * Whether the officer may move this farmer into their own payam.
 *
 * Guard 3 allows `payam_id` only when it equals the officer's payam, so the
 * question is never "which payam" but "should this one move to mine". Offered
 * only when it would change something.
 */
export function canMoveToMyPayam(farmer: Farmer, myPayamId: string | null): boolean {
  return Boolean(myPayamId) && farmer.payam_id !== myPayamId;
}

export interface EditDraft {
  given_name: string;
  family_name: string;
  sex: Farmer['sex'];
  year_of_birth: string;
  phone: string;
  /** '' means "clear it", which the schema accepts as null. */
  national_id: string;
  moveToMyPayam: boolean;
}

export function draftFrom(farmer: Farmer): EditDraft {
  return {
    given_name: farmer.given_name,
    family_name: farmer.family_name,
    sex: farmer.sex,
    year_of_birth: String(farmer.year_of_birth),
    phone: farmer.phone,
    // ABSENT STAYS ABSENT. A route that withheld the id sends no key, and the
    // draft must not turn that into an empty box the officer could "save" as a
    // deliberate clearing of a value they were never shown.
    national_id: 'national_id' in farmer ? (farmer.national_id ?? '') : '',
    moveToMyPayam: false,
  };
}

/** True when the route sent the id and the officer may therefore edit it. */
export const mayEditNationalId = (farmer: Farmer): boolean => 'national_id' in farmer;

/**
 * The patch body: only what actually changed, and nothing the schema refuses.
 *
 * SENDING ONLY THE DIFF IS THE POINT. A body echoing every field would rewrite
 * values the officer never touched, and would send `national_id` for a farmer
 * whose id was withheld -- turning "you were not told" into "set it to empty".
 */
export function patchBody(farmer: Farmer, draft: EditDraft, myPayamId: string | null): PatchFarmer {
  const body: Record<string, unknown> = {};
  if (draft.given_name.trim() !== farmer.given_name) body.given_name = draft.given_name.trim();
  if (draft.family_name.trim() !== farmer.family_name) body.family_name = draft.family_name.trim();
  if (draft.sex !== farmer.sex) body.sex = draft.sex;

  const year = Number(draft.year_of_birth);
  if (Number.isFinite(year) && year !== farmer.year_of_birth) body.year_of_birth = year;

  if (draft.phone.trim() !== farmer.phone) body.phone = draft.phone.trim();

  if (mayEditNationalId(farmer)) {
    const next = draft.national_id.trim();
    const before = farmer.national_id ?? '';
    // '' clears it, which the schema models as null rather than as absence.
    if (next !== before) body.national_id = next === '' ? null : next;
  }

  if (draft.moveToMyPayam && myPayamId && myPayamId !== farmer.payam_id) {
    body.payam_id = myPayamId;
  }
  return body as PatchFarmer;
}

/** Nothing to send: the screen should say so rather than call the route. */
export const isEmptyPatch = (body: PatchFarmer): boolean => Object.keys(body).length === 0;

import type { PatchFarmer } from '@agri-erp/shared';

import type { Farmer, VerificationEvent } from '@/lib/fixtures/farmers';

/**
 * Correcting a rejected record (C-6.1: rejected → pending only by
 * resubmission; C-5.9 as amended by B6: a rejected record must be
 * correctable). The dialog edits the seven fields PATCH /api/farmers/:id
 * accepts; this module turns the form back into the smallest body the route
 * needs, so an unchanged field is never re-sent and never re-audited.
 */
export interface CorrectionValues {
  given_name: string;
  family_name: string;
  sex: Farmer['sex'];
  year_of_birth: string;
  phone: string;
  national_id: string;
}

export function correctionFrom(farmer: Farmer): CorrectionValues {
  return {
    given_name: farmer.given_name,
    family_name: farmer.family_name,
    sex: farmer.sex,
    year_of_birth: String(farmer.year_of_birth),
    phone: farmer.phone,
    national_id: farmer.national_id ?? '',
  };
}

/** Only the fields that changed. Empty national id means "none", as the schema reads it. */
export function patchDiff(farmer: Farmer, values: CorrectionValues): PatchFarmer {
  const out: PatchFarmer = {};
  const given = values.given_name.trim();
  const family = values.family_name.trim();
  const phone = values.phone.trim();
  const nid = values.national_id.trim() === '' ? null : values.national_id.trim();
  const year = Number(values.year_of_birth);
  if (given !== farmer.given_name) out.given_name = given;
  if (family !== farmer.family_name) out.family_name = family;
  if (values.sex !== farmer.sex) out.sex = values.sex;
  if (values.year_of_birth.trim() !== '' && year !== farmer.year_of_birth) out.year_of_birth = year;
  if (phone !== farmer.phone) out.phone = phone;
  if (nid !== (farmer.national_id ?? null)) out.national_id = nid;
  return out;
}

/** What the record says about its rejection: the row's own (live, C-6.3) or the last fixture event. */
export interface Rejection {
  reason_code: string | null;
  note: string | null;
  decided_at: string | null;
}

export function rejectionOf(farmer: Farmer, events: VerificationEvent[] | null): Rejection | null {
  if (farmer.rejection) return farmer.rejection;
  const last = (events ?? [])
    .filter((e) => e.decision === 'rejected')
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
  return last ? { reason_code: null, note: last.reason, decided_at: last.decided_at } : null;
}

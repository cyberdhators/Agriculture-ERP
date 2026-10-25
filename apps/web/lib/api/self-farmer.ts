import { type FarmerSelfRegister } from '@agri-erp/shared';

import { type AuditTx, writeAudit } from './audit';
import { unprocessable } from './errors';
import { insertProfile } from './farmer-accounts';
import {
  allocateFarmerNumber,
  allocateUnplacedFarmerNumber,
  findDuplicates,
  recordDuplicates,
} from './farmers';
import { prisma } from '../db';

/**
 * A FARMER WHO ENROLS THEMSELVES -- the one way a self-registered farmer record
 * is written (B14, 2026-10-07; shared since 2026-10-19 by sign-up and by a
 * buyer who starts selling on the same account). Both paths therefore write
 * the same record, consent, profile, duplicate check and audit rows.
 */

/** What a self-registration writes: the sign-up fields without the password. */
export type SelfFarmerInput = Omit<FarmerSelfRegister, 'password' | 'confirm_password'>;

export interface PlacedPayam {
  /** 2026-10-28: null when the account gave no location at sign-up. */
  payam: { id: string; county_id: string; state_id: string } | null;
  officerId: string | null;
}

/**
 * The payam must exist; an officer there, if any, takes the farmer for later
 * verification. No payam (2026-10-28, optional at sign-up): no location and no
 * officer -- the account is registered and trades all the same.
 */
export async function placeInPayam(payamId: string | null | undefined): Promise<PlacedPayam> {
  if (!payamId) return { payam: null, officerId: null };
  const [payam] = await prisma.$queryRawUnsafe<
    { id: string; county_id: string; state_id: string }[]
  >('SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1', payamId);
  if (!payam) throw unprocessable('payam_not_found');
  // Never a test officer.
  const [officer] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM public.officer_active
      WHERE payam_id = $1 AND name NOT LIKE 'zztest%' ORDER BY created_at LIMIT 1`,
    payam.id,
  );
  return { payam, officerId: officer?.id ?? null };
}

/**
 * Inside the caller's audited transaction: the farmer (source `self`, standing
 * `pending`), the consent, the profile, the duplicate check, and the audit rows
 * with the farmer as actor. Returns the farmer number.
 */
export async function createSelfFarmer(
  tx: AuditTx,
  args: {
    farmerId: string;
    consentId: string;
    authUserId: string;
    placed: PlacedPayam;
    body: SelfFarmerInput;
    /** Recorded in the audit row: how the farmer came to register. */
    via: 'sign_up' | 'buyer_account';
  },
): Promise<string> {
  const { farmerId, consentId, authUserId, placed, body } = args;
  const { payam, officerId } = placed;
  const number = payam
    ? await allocateFarmerNumber(tx, payam.county_id)
    : await allocateUnplacedFarmerNumber(tx);
  await tx.$executeRawUnsafe(
    `INSERT INTO public.farmer
       (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
        payam_id, county_id, state_id, registered_by, caseload_officer_id,
        registration_source, consent_id, auth_user_id)
     VALUES ($1::uuid, $2, $3, $4, $5::public.sex, $6, $7, $8, $9, $10, $11, NULL,
             $12::uuid, 'self', $13::uuid, $14::uuid)`,
    farmerId,
    number,
    body.given_name,
    body.family_name,
    body.sex ?? null,
    body.year_of_birth ?? null,
    body.phone,
    // The farmer record's national id keeps its strict shape (C-5.2); any
    // other document lives on the profile.
    body.id_type === 'national_id' && body.id_number && /^[0-9A-Z]{6,20}$/.test(body.id_number)
      ? body.id_number
      : null,
    payam?.id ?? null,
    payam?.county_id ?? null,
    payam?.state_id ?? null,
    officerId,
    consentId,
    authUserId,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO public.consent (id, farmer_id, text_version, language, granted)
     VALUES ($1::uuid, $2::uuid, $3, $4::public.language, true)`,
    consentId,
    farmerId,
    body.consent.text_version,
    body.consent.language,
  );
  await insertProfile(tx, farmerId, body);

  const matches = await findDuplicates(tx, {
    id: farmerId,
    phone: body.phone,
    given_name: body.given_name,
    family_name: body.family_name,
    payam_id: payam?.id ?? null,
  });
  if (matches.length > 0) await recordDuplicates(tx, farmerId, matches);

  const actor = { actorType: 'farmer', actorId: farmerId } as const;
  await writeAudit(tx, {
    entityType: 'farmer',
    entityId: farmerId,
    ...actor,
    action: 'farmer.created',
    // No name, phone or id number: auditSafe strips them by key, and they are
    // not passed.
    after: {
      farmer_number: number,
      registration_source: 'self',
      payam_id: payam?.id ?? null,
      county_id: payam?.county_id ?? null,
      state_id: payam?.state_id ?? null,
      caseload_officer_id: officerId,
      ...(args.via === 'buyer_account' ? { from: 'buyer_account' } : {}),
    },
  });
  await writeAudit(tx, {
    entityType: 'consent',
    entityId: consentId,
    ...actor,
    action: 'consent.recorded',
    after: {
      farmer_id: farmerId,
      text_version: body.consent.text_version,
      language: body.consent.language,
      granted: true,
    },
  });
  return number;
}

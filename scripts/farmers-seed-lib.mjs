/**
 * The fabricated-farmer seed as a function, so a test can drive it in both
 * directions (refuses with only test officers present; inserts with a real
 * one). `scripts/farmers-seed.mjs` is the command-line wrapper.
 *
 * EVERY ROW IS INVENTED (C-5.14). Family name "Placeholder"; phones in the
 * +21191000xxxx block the directory seed uses for the same reason.
 */
export const PLACEHOLDER_PAYAMS = ['CE-JUB-JUB', 'CE-JUB-MUN', 'CE-JUB-KAT'];
export const PLACEHOLDER_FAMILY = 'Placeholder';
export const GIVEN = [
  'Abuk',
  'Deng',
  'Nyakuma',
  'Garang',
  'Akuol',
  'Lual',
  'Adut',
  'Majok',
  'Yar',
  'Bol',
  'Achol',
  'Kuol',
];
export const seedFarmerId = (n) => `00000000-0000-4000-8000-0000050${String(n).padStart(5, '0')}`;

/** Never a `zztest` officer: those belong to a test run and are swept at its end. */
export async function pickRegisteringOfficer(db, payams = PLACEHOLDER_PAYAMS) {
  const [officer] = await db.$queryRawUnsafe(
    `SELECT id, payam_id, state_id FROM public.officer_active
     WHERE payam_id = ANY($1::text[]) AND name NOT LIKE 'zztest%'
     ORDER BY created_at LIMIT 1`,
    payams,
  );
  return officer ?? null;
}

/**
 * Returns { refused: true, reason } when no eligible officer exists, else
 * { refused: false, inserted, skipped, officerId }.
 */
export async function seedFarmers(db, { payams = PLACEHOLDER_PAYAMS } = {}) {
  const officer = await pickRegisteringOfficer(db, payams);
  if (!officer) {
    return {
      refused: true,
      reason: `No active officer in a placeholder payam (${payams.join(', ')}) that is not a test officer.`,
    };
  }
  const [payam] = await db.$queryRawUnsafe(
    'SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1',
    officer.payam_id,
  );
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < GIVEN.length; i += 1) {
    const farmerId = seedFarmerId(i + 1);
    const [exists] = await db.$queryRawUnsafe(
      'SELECT id FROM public.farmer WHERE id = $1::uuid',
      farmerId,
    );
    if (exists) {
      skipped += 1;
      continue;
    }
    await db.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRawUnsafe(
        `INSERT INTO public.farmer_number_counter (county_id, next_value) VALUES ($1, 2)
         ON CONFLICT (county_id) DO UPDATE SET next_value = public.farmer_number_counter.next_value + 1
         RETURNING next_value - 1 AS n`,
        payam.county_id,
      );
      const farmerNumber = `${payam.county_id}-${String(n).padStart(6, '0')}`;
      const consentId = seedFarmerId(500 + i + 1);
      await tx.$executeRawUnsafe(
        `INSERT INTO public.farmer
           (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
            payam_id, county_id, state_id, registered_by, registration_source, consent_id)
         VALUES ($1::uuid, $2, $3, $4, $5::public.sex, $6, $7, NULL, $8, $9, $10, $11::uuid, 'officer', $12::uuid)`,
        farmerId,
        farmerNumber,
        GIVEN[i],
        PLACEHOLDER_FAMILY,
        i % 2 === 0 ? 'f' : 'm',
        1960 + i * 3,
        `+21191000${String(100 + i).padStart(4, '0')}`,
        payam.id,
        payam.county_id,
        payam.state_id,
        officer.id,
        consentId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO public.consent (id, farmer_id, text_version, language, granted)
         VALUES ($1::uuid, $2::uuid, 'v1.0-en', 'en', true)`,
        consentId,
        farmerId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, after)
         VALUES ('farmer', $1, 'system', NULL, 'farmer.created', $2::jsonb),
                ('consent', $3, 'system', NULL, 'consent.recorded', $4::jsonb)`,
        farmerId,
        JSON.stringify({
          farmer_number: farmerNumber,
          payam_id: payam.id,
          county_id: payam.county_id,
          state_id: payam.state_id,
          registered_by: officer.id,
          seed: 'placeholder',
        }),
        consentId,
        JSON.stringify({
          farmer_id: farmerId,
          text_version: 'v1.0-en',
          language: 'en',
          granted: true,
          seed: 'placeholder',
        }),
      );
    });
    inserted += 1;
  }
  return { refused: false, inserted, skipped, officerId: officer.id };
}

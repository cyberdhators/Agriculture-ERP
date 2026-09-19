// The weather-location seed as a function, so a test can drive it and prove
// the audit row, not only the script. `scripts/weather-locations-seed.mjs` is
// the command-line wrapper.
//
// COUNTY LEVEL TO START (C-16.13). One location per county that exists in the
// hierarchy, at an approximate centroid. The hierarchy is placeholder data
// (I-07) with invented codes but real names, so the centroids are looked up by
// NAME and the rows reference the county's current id -- when CORWADO's list
// arrives, the ids change and these rows are re-pointed (C-16.14), the names
// and centroids do not.
//
// Every centroid below is APPROXIMATE, to about a tenth of a degree, and is
// for a model-output query over a region with almost no observing network.
// Precision here would be false (docs/PROJECT-STATE.md, I-03).

import { weatherLocationSeedSchema } from '../packages/shared/src/weather.ts';

/** Approximate centroids of Central Equatoria's counties, by name. */
export const COUNTY_CENTROIDS = {
  Juba: { latitude: 4.85, longitude: 31.6 },
  Yei: { latitude: 4.09, longitude: 30.68 },
  'Yei River': { latitude: 4.09, longitude: 30.68 },
  'Kajo-Keji': { latitude: 3.85, longitude: 31.66 },
  'Kajo Keji': { latitude: 3.85, longitude: 31.66 },
  Lainya: { latitude: 4.06, longitude: 31.18 },
  Morobo: { latitude: 3.68, longitude: 30.92 },
  Terekeka: { latitude: 5.44, longitude: 31.75 },
};

/**
 * Inserts one county-level location per active county whose name has a known
 * centroid. Idempotent: a county that already has a non-deleted county-level
 * location is skipped. Refuses -- names the county, inserts nothing -- if a
 * county has no centroid, because a location at an unknown place is worse than
 * no location.
 *
 * Every insert appends `weather_location.created` as `system` (C-16.11): the
 * seed is a script with no principal, which is what `system` is for (C-4.3).
 */
export async function seedWeatherLocations(db, { centroids = COUNTY_CENTROIDS } = {}) {
  const counties = await db.$queryRawUnsafe(
    `SELECT id, name, state_id FROM public.county WHERE deleted_at IS NULL ORDER BY state_id, name`,
  );
  const unknown = counties.filter((c) => !centroids[c.name]);
  if (unknown.length > 0) {
    return {
      refused: true,
      reason: `No centroid for: ${unknown.map((c) => `${c.name} (${c.id})`).join(', ')}. Add them to COUNTY_CENTROIDS or remove the county.`,
    };
  }
  let inserted = 0;
  let skipped = 0;
  for (const c of counties) {
    const [existing] = await db.$queryRawUnsafe(
      `SELECT id FROM public.weather_location
        WHERE county_id = $1 AND level = 'county' AND deleted_at IS NULL LIMIT 1`,
      c.id,
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    const row = weatherLocationSeedSchema.parse({
      name: `${c.name} County`,
      level: 'county',
      state_id: c.state_id,
      county_id: c.id,
      payam_id: null,
      ...centroids[c.name],
    });
    await db.$transaction(async (tx) => {
      const [loc] = await tx.$queryRawUnsafe(
        `INSERT INTO public.weather_location (name, level, state_id, county_id, payam_id, latitude, longitude)
         VALUES ($1, $2, $3, $4, NULL, $5, $6) RETURNING id`,
        row.name,
        row.level,
        row.state_id,
        row.county_id,
        row.latitude,
        row.longitude,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, before, after)
         VALUES ('weather_location', $1, 'system', NULL, 'weather_location.created', NULL, $2::jsonb)`,
        loc.id,
        JSON.stringify({ ...row, seed: 'county-centroids' }),
      );
    });
    inserted += 1;
  }
  return { refused: false, inserted, skipped, counties: counties.length };
}

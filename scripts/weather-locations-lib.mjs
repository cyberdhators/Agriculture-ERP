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

/** Approximate centroids of every county, by name (Central Equatoria first). */
export const COUNTY_CENTROIDS = {
  Juba: { latitude: 4.85, longitude: 31.6 },
  Yei: { latitude: 4.09, longitude: 30.68 },
  'Yei River': { latitude: 4.09, longitude: 30.68 },
  'Kajo-Keji': { latitude: 3.85, longitude: 31.66 },
  'Kajo Keji': { latitude: 3.85, longitude: 31.66 },
  Lainya: { latitude: 4.06, longitude: 31.18 },
  Morobo: { latitude: 3.68, longitude: 30.92 },
  Terekeka: { latitude: 5.44, longitude: 31.75 },
  // The national list (2026-10-30, CORWADO's reference of 30 October): each
  // county at its headquarters town, cross-checked against OpenWeather's own
  // place search where it knew the town.
  // Central Equatoria
  'Kajo-keji': { latitude: 3.85, longitude: 31.66 },
  // Eastern Equatoria
  Budi: { latitude: 4.23, longitude: 33.49 },
  Ikotos: { latitude: 4.08, longitude: 33.1 },
  'Kapoeta East': { latitude: 4.5, longitude: 34.17 },
  'Kapoeta North': { latitude: 4.88, longitude: 33.51 },
  'Kapoeta South': { latitude: 4.77, longitude: 33.59 },
  Lafon: { latitude: 5.05, longitude: 32.48 },
  Magwi: { latitude: 4.13, longitude: 32.3 },
  Torit: { latitude: 4.41, longitude: 32.57 },
  // Jonglei
  Akobo: { latitude: 7.78, longitude: 33.0 },
  Ayod: { latitude: 8.12, longitude: 31.42 },
  'Bor South': { latitude: 6.21, longitude: 31.56 },
  'Canal/Pigi': { latitude: 9.31, longitude: 31.58 },
  Duk: { latitude: 7.75, longitude: 31.4 },
  Fangak: { latitude: 9.07, longitude: 30.88 },
  Nyirol: { latitude: 8.18, longitude: 32.15 },
  'Twic East': { latitude: 7.15, longitude: 31.37 },
  Uror: { latitude: 7.91, longitude: 31.89 },
  // Lakes
  Awerial: { latitude: 6.07, longitude: 31.55 },
  Cueibet: { latitude: 7.01, longitude: 29.25 },
  'Rumbek Centre': { latitude: 6.81, longitude: 29.69 },
  'Rumbek East': { latitude: 6.55, longitude: 30.04 },
  'Rumbek North': { latitude: 7.7, longitude: 29.72 },
  Wulu: { latitude: 6.2, longitude: 29.3 },
  'Yirol East': { latitude: 6.71, longitude: 30.6 },
  'Yirol West': { latitude: 6.55, longitude: 30.5 },
  // Northern Bahr el Ghazal
  'Aweil Centre': { latitude: 8.75, longitude: 27.35 },
  'Aweil East': { latitude: 9.01, longitude: 27.57 },
  'Aweil North': { latitude: 9.22, longitude: 26.86 },
  'Aweil South': { latitude: 8.59, longitude: 27.6 },
  'Aweil West': { latitude: 9.13, longitude: 26.99 },
  // Unity
  Guit: { latitude: 9.16, longitude: 29.91 },
  Koch: { latitude: 8.6, longitude: 29.98 },
  Leer: { latitude: 8.3, longitude: 30.14 },
  Mayendit: { latitude: 8.55, longitude: 29.8 },
  Mayom: { latitude: 9.23, longitude: 29.17 },
  Panyijiar: { latitude: 7.73, longitude: 30.24 },
  Rubkona: { latitude: 9.27, longitude: 29.8 },
  // Upper Nile
  Baliet: { latitude: 9.12, longitude: 32.18 },
  Fashoda: { latitude: 9.88, longitude: 32.12 },
  Longochuk: { latitude: 9.0, longitude: 33.5 },
  'Luakpiny/Nasir': { latitude: 8.6, longitude: 33.07 },
  Maban: { latitude: 9.96, longitude: 33.73 },
  Maiwut: { latitude: 8.61, longitude: 33.92 },
  Malakal: { latitude: 9.53, longitude: 31.66 },
  Manyo: { latitude: 11.61, longitude: 32.72 },
  Melut: { latitude: 10.44, longitude: 32.2 },
  Panyikang: { latitude: 9.42, longitude: 31.05 },
  Renk: { latitude: 11.75, longitude: 32.8 },
  Ulang: { latitude: 8.58, longitude: 32.62 },
  // Warrap
  'Gogrial East': { latitude: 8.23, longitude: 28.39 },
  'Gogrial West': { latitude: 8.31, longitude: 27.99 },
  'Tonj East': { latitude: 7.4, longitude: 29.2 },
  'Tonj North': { latitude: 8.1, longitude: 28.63 },
  'Tonj South': { latitude: 7.27, longitude: 28.68 },
  Twic: { latitude: 9.1, longitude: 28.42 },
  // Western Bahr el Ghazal
  'Jur River': { latitude: 7.51, longitude: 28.27 },
  Raja: { latitude: 8.46, longitude: 25.68 },
  Wau: { latitude: 7.7, longitude: 28.0 },
  // Western Equatoria
  Ezo: { latitude: 5.05, longitude: 27.47 },
  Ibba: { latitude: 4.8, longitude: 29.13 },
  Maridi: { latitude: 4.92, longitude: 29.47 },
  'Mundri East': { latitude: 5.34, longitude: 30.45 },
  'Mundri West': { latitude: 5.35, longitude: 30.32 },
  Mvolo: { latitude: 6.05, longitude: 29.95 },
  Nagero: { latitude: 6.39, longitude: 27.77 },
  Nzara: { latitude: 4.65, longitude: 28.25 },
  Tambura: { latitude: 5.6, longitude: 27.47 },
  Yambio: { latitude: 4.57, longitude: 28.4 },
  // Abyei Administrative Area -- every county at Abyei town until CORWADO gives each a place.
  Alal: { latitude: 9.6, longitude: 28.44 },
  'Ameth-Aguok': { latitude: 9.6, longitude: 28.44 },
  Mijak: { latitude: 9.6, longitude: 28.44 },
  Rumamer: { latitude: 9.6, longitude: 28.44 },
  'Abyei Municipality': { latitude: 9.6, longitude: 28.44 },
  // Greater Pibor Administrative Area
  Pibor: { latitude: 6.8, longitude: 33.13 },
  Pochalla: { latitude: 7.18, longitude: 34.1 },
  // Ruweng Administrative Area
  Abiemnhom: { latitude: 9.4, longitude: 28.82 },
  Pariang: { latitude: 9.92, longitude: 29.98 },
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
      name: /Municipality$/.test(c.name) ? c.name : `${c.name} County`,
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

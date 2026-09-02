import { z } from 'zod';

/**
 * The location hierarchy: state, county, payam. Unit B2, criteria C-2.1-C-2.8.
 *
 * These validate rows arriving from a seed or reseed source before anything
 * reaches the database, per the validation law in CLAUDE.md. The source is a
 * CSV supplied by CORWADO under input I-07, so every value arrives as text.
 */

export const LOCATION_MESSAGES = {
  codeRequired: 'Enter a location code.',
  codeFormat: 'A location code uses capital letters, digits and hyphens, for example CE-JUB.',
  nameRequired: 'Enter a location name.',
  nameBlank: 'A location name cannot be only spaces.',
  levelUnknown: 'A location level must be state, county or payam.',
  stateRequired: 'Enter the state code this belongs to.',
  countyRequired: 'Enter the county code this payam belongs to.',
} as const;

/**
 * A location code. Matches the CHECK constraint in migration 5 exactly; if one
 * changes the other must change with it.
 *
 * Names are deliberately NOT constrained to Latin characters. C-2.8 requires
 * names be stored and returned exactly as supplied. Codes are ours and stay
 * ASCII; names are CORWADO's and are left alone.
 */
export const locationCodeSchema = z
  .string({ error: () => LOCATION_MESSAGES.codeRequired })
  .trim()
  .min(1, LOCATION_MESSAGES.codeRequired)
  .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, LOCATION_MESSAGES.codeFormat);

/**
 * A location name, preserved exactly.
 *
 * Only the surrounding whitespace of a CSV cell is trimmed. Nothing inside the
 * name is touched: no case change, no transliteration, no normalisation. A name
 * in Arabic script round-trips byte for byte.
 */
export const locationNameSchema = z
  .string({ error: () => LOCATION_MESSAGES.nameRequired })
  .trim()
  .min(1, LOCATION_MESSAGES.nameBlank);

export const stateRowSchema = z.strictObject({
  level: z.literal('state'),
  id: locationCodeSchema,
  name: locationNameSchema,
});

export const countyRowSchema = z.strictObject({
  level: z.literal('county'),
  id: locationCodeSchema,
  name: locationNameSchema,
  state_id: locationCodeSchema,
});

export const payamRowSchema = z.strictObject({
  level: z.literal('payam'),
  id: locationCodeSchema,
  name: locationNameSchema,
  county_id: locationCodeSchema,
  state_id: locationCodeSchema,
});

export const locationRowSchema = z.discriminatedUnion('level', [
  stateRowSchema,
  countyRowSchema,
  payamRowSchema,
]);

export type StateRow = z.infer<typeof stateRowSchema>;
export type CountyRow = z.infer<typeof countyRowSchema>;
export type PayamRow = z.infer<typeof payamRowSchema>;
export type LocationRow = z.infer<typeof locationRowSchema>;

/** The whole hierarchy, as a bundle is built from it. */
export interface LocationTree {
  readonly states: readonly { id: string; name: string }[];
  readonly counties: readonly { id: string; name: string; state_id: string }[];
  readonly payams: readonly { id: string; name: string; county_id: string; state_id: string }[];
}

/**
 * Canonical serialisation of the hierarchy. The version identifier is a hash of
 * exactly this string, so it must be stable: keys in a fixed order, rows sorted
 * by code, no incidental whitespace.
 *
 * C-2.4 requires the identifier change when, and only when, the content
 * changes. Anything that varies for another reason -- a timestamp, a row order
 * from the database, a counter -- fails one half of that.
 */
export function canonicaliseTree(tree: LocationTree): string {
  const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return JSON.stringify({
    states: byId(tree.states).map((s) => [s.id, s.name]),
    counties: byId(tree.counties).map((c) => [c.id, c.name, c.state_id]),
    payams: byId(tree.payams).map((p) => [p.id, p.name, p.county_id, p.state_id]),
  });
}

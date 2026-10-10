import { z } from 'zod';
import { CROPS } from './learning';
import { LAND_TENURES, LAND_UNITS } from './farmer-account';

/**
 * Farms and boundaries (C-7). The thresholds, the season list and the
 * messages live here; the database CHECKs are generated from the same
 * numbers and the same list, so the code and the database cannot drift.
 */

/** Ours, taken because no threshold exists in any document (C-7.4). */
export const ACCURACY_THRESHOLDS_M = { good: 10, poor: 30 } as const;
export const ACCURACY_FLAGS = ['good', 'poor', 'unusable'] as const;
export type AccuracyFlag = (typeof ACCURACY_FLAGS)[number];
export const gradeAccuracy = (metres: number): AccuracyFlag =>
  metres <= ACCURACY_THRESHOLDS_M.good
    ? 'good'
    : metres <= ACCURACY_THRESHOLDS_M.poor
      ? 'poor'
      : 'unusable';

/** Ours until CORWADO confirms local names. A season the system cannot compare cannot be reported on. */
export const SEASON_NAMES = ['main', 'second'] as const;
export const SEASON_PATTERN = /^[0-9]{4}-(main|second)$/;

/** Distinct vertices, closing repeat not counted (C-7.2). */
export const MIN_BOUNDARY_VERTICES = 4;

export const FARM_LIMITS = { maxVertices: 2000, maxAccuracyM: 9999 } as const;

export const FARM_MESSAGES = {
  idRequired: 'A farm must carry its identifier.',
  idNotUuid: 'The farm identifier is not in the expected form.',
  boundaryIdNotUuid: 'The boundary identifier is not in the expected form.',
  capturedAtInvalid: 'Record when the farm was captured as a date and time.',
  filterDateInvalid: 'Give the date as an ISO 8601 timestamp.',
  seasonShape: 'Give the season as a year and a name: 2026-main or 2026-second.',
  accuracyRequired: 'Record the GPS accuracy in metres at capture.',
  accuracyInvalid: 'GPS accuracy is a number of metres, zero or more.',
  polygonShape: 'Send the boundary as a GeoJSON Polygon with one ring.',
  pointShape: 'Each boundary point is a pair: longitude, then latitude.',
  pointRange: 'Longitude is between -180 and 180; latitude between -90 and 90.',
  tooManyPoints: 'A boundary can have at most 2000 points.',
  cropUnknown: 'Choose a crop from the list: sorghum, groundnut, sesame, maize or cowpea.',
  cropsDuplicate: 'Each crop once per season.',
  cropsNotList: 'Send the crops as a list.',
  filterSeasonInvalid: 'Give the season as a year and a name: 2026-main or 2026-second.',
  nameTooLong: 'Keep the farm name to 120 characters.',
  sizeInvalid: 'Give the size as a number greater than zero.',
  sizeUnitRequired: 'Choose the unit the size is in: feddan, acre or hectare.',
  sizeValueRequired: 'Give the size, or clear the unit.',
  tenureUnknown: 'Choose how the land is held: owned, rented, communal or other.',
  villageTooLong: 'Keep the village to 120 characters.',
  locationNoteTooLong: 'Keep the directions to 500 characters.',
  notesTooLong: 'Keep the notes to 2000 characters.',
  locationShape: 'Give the location as latitude and longitude.',
} as const;

export const seasonSchema = z
  .string({ error: () => FARM_MESSAGES.seasonShape })
  .trim()
  .regex(SEASON_PATTERN, FARM_MESSAGES.seasonShape);

const uuid = (message: string) =>
  z
    .string({ error: () => message })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);

/** A position: [longitude, latitude]. Altitude is dropped by the ring schema. */
const positionSchema = z
  .tuple(
    [
      z.number({ error: () => FARM_MESSAGES.pointShape }),
      z.number({ error: () => FARM_MESSAGES.pointShape }),
    ],
    { error: () => FARM_MESSAGES.pointShape },
  )
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, {
    message: FARM_MESSAGES.pointRange,
  });

/**
 * Structure only. Closure, self-crossing and the vertex count are judged by
 * the database in the geometry module, each with its own pinned sentence;
 * here a polygon is one ring of positions, at most 2000 of them.
 */
export const geoJsonPolygonSchema = z.strictObject(
  {
    type: z.literal('Polygon', { error: () => FARM_MESSAGES.polygonShape }),
    coordinates: z
      .array(z.array(positionSchema).max(FARM_LIMITS.maxVertices, FARM_MESSAGES.tooManyPoints), {
        error: () => FARM_MESSAGES.polygonShape,
      })
      .length(1, FARM_MESSAGES.polygonShape),
  },
  { error: () => FARM_MESSAGES.polygonShape },
);
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;

const accuracySchema = z
  .number({ error: () => FARM_MESSAGES.accuracyRequired })
  .min(0, FARM_MESSAGES.accuracyInvalid)
  .max(FARM_LIMITS.maxAccuracyM, FARM_MESSAGES.accuracyInvalid);

/** Creating a farm IS mapping it: the first boundary comes with it. */
const capturedAtSchema = z
  .string({ error: () => FARM_MESSAGES.capturedAtInvalid })
  .datetime({ offset: true, message: FARM_MESSAGES.capturedAtInvalid })
  .nullable()
  .optional();

/** The first boundary carries its own client id (C-9.1): a retry is the same boundary. */
export const createFarmSchema = z.strictObject({
  id: uuid(FARM_MESSAGES.idNotUuid),
  boundary_id: uuid(FARM_MESSAGES.boundaryIdNotUuid),
  season: seasonSchema,
  boundary: geoJsonPolygonSchema,
  gps_accuracy_m: accuracySchema,
  captured_at: capturedAtSchema,
});

export const addBoundarySchema = z.strictObject({
  id: uuid(FARM_MESSAGES.boundaryIdNotUuid),
  season: seasonSchema,
  boundary: geoJsonPolygonSchema,
  gps_accuracy_m: accuracySchema,
});

/** GET /api/farms (C-9.9): scoped, paged, with the download filter. */
export const farmFilterSchema = z.strictObject({
  farmer: uuid(FARM_MESSAGES.idNotUuid).optional(),
  payam: z.string().trim().min(1).optional(),
  updated_since: z
    .string({ error: () => FARM_MESSAGES.filterDateInvalid })
    .datetime({ offset: true, message: FARM_MESSAGES.filterDateInvalid })
    .optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type FarmFilter = z.infer<typeof farmFilterSchema>;

const cropSchema = z.enum(CROPS, { error: () => FARM_MESSAGES.cropUnknown });
export const declareCropsSchema = z.strictObject({
  season: seasonSchema,
  crops: z
    .array(cropSchema, { error: () => FARM_MESSAGES.cropsNotList })
    .refine((list) => new Set(list).size === list.length, {
      message: FARM_MESSAGES.cropsDuplicate,
    }),
});

export const geojsonFilterSchema = z.strictObject({
  payam: z.string().trim().min(1).optional(),
  season: seasonSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export type CreateFarm = z.infer<typeof createFarmSchema>;
export type AddBoundary = z.infer<typeof addBoundarySchema>;
export type DeclareCrops = z.infer<typeof declareCropsSchema>;
export type GeojsonFilter = z.infer<typeof geojsonFilterSchema>;

/**
 * A FARM RECORDED BY HAND (2026-10-10, the owner: "forget the GIS mapping for
 * now and add a form the extension officer can use to manually record the farm
 * information"). No boundary: the farm can be mapped later through
 * addBoundarySchema, and only a boundary ever counts as mapped area. The size
 * is what the farmer declared, in the unit they gave. The point, when given, is
 * the phone's position standing at the farm. The crops are declared for the
 * season in the same request (C-7.7). The id is the phone's (C-9.1).
 */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const recordFarmSchema = z
  .strictObject({
    id: uuid(FARM_MESSAGES.idNotUuid),
    season: seasonSchema,
    name: optionalText(120, FARM_MESSAGES.nameTooLong),
    size_value: z
      .number({ error: () => FARM_MESSAGES.sizeInvalid })
      .gt(0, FARM_MESSAGES.sizeInvalid)
      .max(99_999_999, FARM_MESSAGES.sizeInvalid)
      .nullable()
      .optional(),
    size_unit: z
      .enum(LAND_UNITS, { error: () => FARM_MESSAGES.sizeUnitRequired })
      .nullable()
      .optional(),
    tenure: z
      .enum(LAND_TENURES, { error: () => FARM_MESSAGES.tenureUnknown })
      .nullable()
      .optional(),
    village: optionalText(120, FARM_MESSAGES.villageTooLong),
    location_note: optionalText(500, FARM_MESSAGES.locationNoteTooLong),
    location: z
      .strictObject(
        {
          latitude: z
            .number({ error: () => FARM_MESSAGES.locationShape })
            .min(-90)
            .max(90),
          longitude: z
            .number({ error: () => FARM_MESSAGES.locationShape })
            .min(-180)
            .max(180),
          accuracy_m: accuracySchema.nullable().optional(),
        },
        { error: () => FARM_MESSAGES.locationShape },
      )
      .nullable()
      .optional(),
    crops: z
      .array(cropSchema, { error: () => FARM_MESSAGES.cropsNotList })
      .refine((list) => new Set(list).size === list.length, {
        message: FARM_MESSAGES.cropsDuplicate,
      })
      .default([]),
    notes: optionalText(2000, FARM_MESSAGES.notesTooLong),
    captured_at: capturedAtSchema,
  })
  .superRefine((v, ctx) => {
    const hasValue = v.size_value !== null && v.size_value !== undefined;
    const hasUnit = v.size_unit !== null && v.size_unit !== undefined;
    if (hasValue && !hasUnit) {
      ctx.addIssue({
        code: 'custom',
        path: ['size_unit'],
        message: FARM_MESSAGES.sizeUnitRequired,
      });
    }
    if (hasUnit && !hasValue) {
      ctx.addIssue({
        code: 'custom',
        path: ['size_value'],
        message: FARM_MESSAGES.sizeValueRequired,
      });
    }
  });

export type RecordFarm = z.infer<typeof recordFarmSchema>;
export type RecordFarmInput = z.input<typeof recordFarmSchema>;

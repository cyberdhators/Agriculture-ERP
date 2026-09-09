import { describe, expect, it } from 'vitest';
import {
  ACCURACY_THRESHOLDS_M,
  FARM_MESSAGES,
  createFarmSchema,
  declareCropsSchema,
  gradeAccuracy,
  seasonSchema,
  zodErrorToApiError,
} from '../src/index';

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [31.6, 4.85],
      [31.6009, 4.85],
      [31.6009, 4.8509],
      [31.6, 4.8509],
      [31.6, 4.85],
    ],
  ],
};

describe('accuracy grades (C-7.4): the thresholds are inclusive at the boundary', () => {
  it('exactly 10 m is good, 10.1 is poor, exactly 30 is poor, 30.1 is unusable', () => {
    expect(ACCURACY_THRESHOLDS_M).toEqual({ good: 10, poor: 30 });
    expect(gradeAccuracy(0)).toBe('good');
    expect(gradeAccuracy(10)).toBe('good');
    expect(gradeAccuracy(10.1)).toBe('poor');
    expect(gradeAccuracy(30)).toBe('poor');
    expect(gradeAccuracy(30.1)).toBe('unusable');
  });
});

describe('the season shape', () => {
  it('accepts YYYY-main and YYYY-second and nothing else', () => {
    expect(seasonSchema.safeParse('2026-main').success).toBe(true);
    expect(seasonSchema.safeParse('2026-second').success).toBe(true);
    for (const bad of ['2026', 'main-2026', '2026-third', '26-main', '2026-Main']) {
      expect(seasonSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('the registration body (C-7.1, C-7.2 structure)', () => {
  const valid = () => ({
    boundary_id: '11111111-2222-4333-8444-555555555555',
    id: '11111111-2222-4333-8444-555555555555',
    season: '2026-main',
    boundary: square,
    gps_accuracy_m: 7.5,
  });
  it('accepts a closed one-ring polygon with accuracy', () => {
    expect(createFarmSchema.safeParse(valid()).success).toBe(true);
  });
  it('refuses a point out of range, a two-ring polygon, and missing accuracy, naming the field', () => {
    const bad = createFarmSchema.safeParse({
      ...valid(),
      boundary: {
        ...square,
        coordinates: [
          [
            [200, 4.85],
            [31.6, 4.85],
            [31.6, 4.86],
            [200, 4.85],
          ],
        ],
      },
    });
    expect(bad.success).toBe(false);
    if (!bad.success)
      expect(JSON.stringify(zodErrorToApiError(bad.error).body.error.fields)).toContain(
        FARM_MESSAGES.pointRange,
      );
    expect(
      createFarmSchema.safeParse({
        ...valid(),
        boundary: { ...square, coordinates: [square.coordinates[0], square.coordinates[0]] },
      }).success,
    ).toBe(false);
    const missing = createFarmSchema.safeParse({
      id: valid().id,
      season: '2026-main',
      boundary: square,
    });
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(zodErrorToApiError(missing.error).body.error.fields?.gps_accuracy_m).toBe(
        FARM_MESSAGES.accuracyRequired,
      );
  });
  it('crops: from the list, once each', () => {
    expect(
      declareCropsSchema.safeParse({ season: '2026-main', crops: ['maize', 'sorghum'] }).success,
    ).toBe(true);
    expect(
      declareCropsSchema.safeParse({ season: '2026-main', crops: ['maize', 'maize'] }).success,
    ).toBe(false);
    expect(declareCropsSchema.safeParse({ season: '2026-main', crops: ['banana'] }).success).toBe(
      false,
    );
  });
});

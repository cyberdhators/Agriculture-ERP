import { z } from 'zod';
import { SEASON_PATTERN } from './farm';

/**
 * Dashboards, reporting and export (C-10). The age bands, the report types,
 * the filter schema and the sentences live here so the dashboard, the export
 * and the tests read one definition.
 *
 * Age is computed at the data cut-off from a year of birth, so it is
 * approximate to within a year, and every report says so (C-10.5).
 */

export const AGE_BANDS = [
  { key: 'under_18', min: 0, max: 17 },
  { key: '18_24', min: 18, max: 24 },
  { key: '25_34', min: 25, max: 34 },
  { key: '35_49', min: 35, max: 49 },
  { key: '50_plus', min: 50, max: null },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]['key'];

/** The band for a year of birth at a cut-off date: cut-off year minus birth year, never a birthday. */
export function ageBandAt(yearOfBirth: number, cutoff: Date): AgeBandKey {
  const age = cutoff.getUTCFullYear() - yearOfBirth;
  for (const band of AGE_BANDS) {
    if (age >= band.min && (band.max === null || age <= band.max)) return band.key;
  }
  return 'under_18';
}

export const AGE_BAND_NOTE =
  'Age bands are computed at the data cut-off from a year of birth, so each is approximate to within a year.';
export const CROP_NOTE =
  'Reach by crop counts a farmer once per crop they have at least one farm declaring in the season; the crop rows do not sum to the total.';
export const VERIFIED_ONLY_NOTE =
  'Reach counts verified farmers only. Pending, rejected and merged records are shown beside it and never folded in.';

export const REPORT_TYPES = ['summary', 'farmers'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_MESSAGES = {
  cutoffInvalid: 'Give the data cut-off as a date: YYYY-MM-DD.',
  cutoffFuture: 'The data cut-off cannot be after today.',
  periodInvalid: 'Give the period start and end as full dates and times with their offset.',
  periodReversed: 'The period ends before it starts.',
  seasonInvalid: 'Give the season as a year and a name: 2026-main or 2026-second.',
  reportTypeUnknown: 'Choose a report: summary or farmers.',
} as const;

const isoDate = z
  .string({ error: () => REPORT_MESSAGES.cutoffInvalid })
  .regex(/^\d{4}-\d{2}-\d{2}$/, REPORT_MESSAGES.cutoffInvalid)
  .refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), REPORT_MESSAGES.cutoffInvalid)
  .refine((d) => new Date(`${d}T00:00:00Z`).getTime() <= Date.now(), REPORT_MESSAGES.cutoffFuture);

const isoDateTime = z
  .string({ error: () => REPORT_MESSAGES.periodInvalid })
  .datetime({ offset: true, message: REPORT_MESSAGES.periodInvalid });

/**
 * The filters a figure and its export share (C-10.9). `cutoff` bounds every
 * "as of" count by the server's moment; `from`/`to` bound the period for
 * reach and visits by the server's moment of receipt; `season` names the
 * land figures' season (the latest present if omitted); state, county and
 * payam narrow within the caller's scope, never beyond it.
 */
export const reportFilterSchema = z
  .strictObject({
    cutoff: isoDate.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    season: z
      .string({ error: () => REPORT_MESSAGES.seasonInvalid })
      .trim()
      .regex(SEASON_PATTERN, REPORT_MESSAGES.seasonInvalid)
      .optional(),
    state: z.string().trim().min(1).optional(),
    county: z.string().trim().min(1).optional(),
    payam: z.string().trim().min(1).optional(),
  })
  .refine((f) => !(f.from && f.to) || new Date(f.from).getTime() <= new Date(f.to).getTime(), {
    message: REPORT_MESSAGES.periodReversed,
    path: ['to'],
  });
export type ReportFilter = z.infer<typeof reportFilterSchema>;

/** POST /api/reports/exports: the report and the same filters as the figure. */
export const exportRequestSchema = z.strictObject({
  report_type: z.enum(REPORT_TYPES, { error: () => REPORT_MESSAGES.reportTypeUnknown }),
  filters: reportFilterSchema.optional(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const exportListFilterSchema = z.strictObject({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

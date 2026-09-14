import type { ExportRecord, Summary } from '@/lib/reports/api';

/**
 * Invented figures so the reports screen can be walked with nobody signed in
 * (C-10.14). Every number here is made up; none traces to a farmer. The shape
 * is exactly what GET /api/reports/summary returns, so the live swap is a
 * source change and the screen does not move.
 */
export const SUMMARY_FIXTURE: Summary = {
  as_of: '2026-09-12',
  period: { from: '2026-06-01T00:00:00Z', to: '2026-09-12T23:59:59Z' },
  season: '2026A',
  farmers: { verified: 24, pending: 14, rejected: 2, merged: 1 },
  reach: { farmers_reached: 17, visits: 41, other_farmers_visited: 6 },
  land: { farms_mapped: 31, hectares: 42.6, farms_of_verified: 27 },
  by: {
    sex: [
      { key: 'f', verified: 13, reached: 9 },
      { key: 'm', verified: 11, reached: 8 },
    ],
    age_band: [
      { key: 'under_18', verified: 0, reached: 0 },
      { key: '18_24', verified: 3, reached: 2 },
      { key: '25_34', verified: 8, reached: 6 },
      { key: '35_49', verified: 9, reached: 7 },
      { key: '50_plus', verified: 4, reached: 2 },
    ],
    state: [{ key: 'CE', verified: 24, reached: 17 }],
    county: [{ key: 'CE-JUB', verified: 24, reached: 17 }],
    payam: [
      { key: 'CE-JUB-REJ', verified: 6, reached: 5 },
      { key: 'CE-JUB-KAT', verified: 6, reached: 4 },
      { key: 'CE-JUB-MUN', verified: 7, reached: 5 },
      { key: 'CE-JUB-NBA', verified: 5, reached: 3 },
    ],
    crop: [
      { key: 'sorghum', verified: 18 },
      { key: 'groundnut', verified: 11 },
      { key: 'maize', verified: 7 },
      { key: 'sesame', verified: 4 },
      { key: 'cowpea', verified: 3 },
    ],
  },
  notes: [
    'Reach counts verified farmers only; pending, rejected and merged farmers are shown beside it and never folded in.',
    'Age band is computed at the data cut-off from a year of birth, so it is approximate to within a year.',
    'Reach by crop counts a farmer once per crop with at least one farm declaring it this season, so the crop rows do not sum to the total.',
  ],
};

export const EXPORTS_FIXTURE: ExportRecord[] = [
  {
    id: 'ex-3',
    exported_by: 'u-2',
    actor_type: 'supervisor',
    report_type: 'summary',
    query: 'SELECT … (recorded verbatim)',
    filters: { cutoff: '2026-09-12', season: '2026A' },
    scope: { kind: 'state', stateId: 'CE' },
    data_cutoff: '2026-09-12',
    row_count: 1,
    exported_at: '2026-09-12T09:14:00Z',
  },
  {
    id: 'ex-2',
    exported_by: 'u-1',
    actor_type: 'admin',
    report_type: 'farmers',
    query: 'SELECT … (recorded verbatim)',
    filters: { cutoff: '2026-08-31', payam: 'CE-JUB-MUN' },
    scope: { kind: 'all' },
    data_cutoff: '2026-08-31',
    row_count: 7,
    exported_at: '2026-09-01T14:02:00Z',
  },
];

import {
  ADVICE_OUTCOMES,
  ADVICE_TOPICS,
  ANALYTICS_LIMITATIONS,
  ANALYTICS_METRICS,
  type AnalyticsSummary,
  type Coverage,
} from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import { METRIC_SQL, inlineAnalyticsQuery } from '../api/analytics';
import { analyticsStates } from './scope';
import { analyticsSheets, breakdownLabel } from './workbook';

/**
 * Analytics (2026-10-22): the parts that need no database -- that every
 * defined figure has its SQL and no SQL lacks a definition, how the states
 * are decided, and what the workbook carries.
 */

const refuse = () => new Error('forbidden');
const PLATFORM: Coverage = { platform: true };
const statesCoverage = (...s: string[]): Coverage => ({ platform: false, states: new Set(s) });

describe('every figure has its definition and its SQL', () => {
  it('pairs the two lists exactly', () => {
    expect(Object.keys(METRIC_SQL).sort()).toEqual(ANALYTICS_METRICS.map((m) => m.id).sort());
  });

  it('gives every figure a query, and a breakdown query wherever one is defined', () => {
    for (const def of ANALYTICS_METRICS) {
      const sql = METRIC_SQL[def.id]!;
      expect(sql.total ?? sql.breakdown, `${def.id} has no query`).toBeTruthy();
      if (def.breakdown) expect(sql.breakdown, `${def.id} defines a breakdown`).toBeTruthy();
      if (def.breakdown?.overlapping) {
        expect(sql.total, `${def.id} overlaps, so its total cannot be a sum`).toBeTruthy();
      }
      expect(sql.located, `${def.id}: stateRule and located disagree`).toBe(def.stateRule !== null);
    }
  });

  it('runs every query on the same window and state parameters', () => {
    for (const [id, sql] of Object.entries(METRIC_SQL)) {
      for (const q of [sql.total, sql.breakdown].filter(Boolean) as string[]) {
        expect(q, id).toMatch(
          /^WITH w AS \(SELECT \$1::timestamptz AS s, \$2::timestamptz AS e, \$3::text\[\] AS st\)/,
        );
        expect(
          q.match(/\$\d+/g)?.every((p) => ['$1', '$2', '$3'].includes(p)),
          id,
        ).toBe(true);
      }
    }
  });

  it('never selects a name, a phone number or a message body', () => {
    for (const [id, sql] of Object.entries(METRIC_SQL)) {
      const q = `${sql.total ?? ''}\n${sql.breakdown ?? ''}`;
      expect(q, id).not.toMatch(/given_name|family_name|\.body\b|buyer_phone|contact_phone/);
      // A phone is only ever counted, never selected.
      expect(q.replace(/count\(DISTINCT pv\.phone\)/g, ''), id).not.toMatch(/pv\.phone/);
    }
  });

  it('excludes soft-deleted rows from every table it counts', () => {
    for (const [id, sql] of Object.entries(METRIC_SQL)) {
      const q = `${sql.total ?? ''}\n${sql.breakdown ?? ''}`;
      for (const [table, alias] of [
        ['produce_listing', 'l'],
        ['buying_request', 'r'],
        ['service_listing', 'sv'],
        ['purchase_order', 'po'],
        ['support_message', 'sm'],
        ['message', 'm'],
        ['advice_provider', 'ap'],
        ['advice_case', 'ac'],
        ['adviser_application', 'aa'],
        ['advice_referral', 'rf'],
      ] as const) {
        if (new RegExp(`FROM public\\.${table} ${alias}\\b`).test(q)) {
          expect(q, `${id} reads ${table} without its deleted_at`).toMatch(
            new RegExp(`${alias}\\.deleted_at IS NULL`),
          );
        }
      }
    }
  });
});

describe('advice figures (2026-10-25)', () => {
  const ADVICE_IDS = [
    'advice.providers_published',
    'advice.approved_advisers',
    'advice.requests',
    'advice.cases_closed',
    'advice.median_days_to_close',
    'advice.feedback_given',
    'advice.average_rating',
    'advice.applications_submitted',
    'advice.applications_decided',
    'advice.referrals',
  ];

  it('defines every advice figure, in the Advice group, with its SQL', () => {
    const defined = ANALYTICS_METRICS.filter((m) => m.group === 'advice').map((m) => m.id);
    expect(defined.sort()).toEqual([...ADVICE_IDS].sort());
    for (const id of ADVICE_IDS) expect(METRIC_SQL[id], id).toBeTruthy();
  });

  it('breaks requests down by topic and closures by every outcome', () => {
    const byId = (id: string) => ANALYTICS_METRICS.find((m) => m.id === id)!;
    expect(Object.keys(byId('advice.requests').breakdown!.keys!).sort()).toEqual(
      [...ADVICE_TOPICS].sort(),
    );
    expect(Object.keys(byId('advice.cases_closed').breakdown!.keys!).sort()).toEqual(
      [...ADVICE_OUTCOMES].sort(),
    );
  });

  it('never reads a question, a comment, a name or a storage path', () => {
    for (const id of ADVICE_IDS) {
      const sql = METRIC_SQL[id]!;
      const q = `${sql.total ?? ''}\n${sql.breakdown ?? ''}`;
      expect(q, id).not.toMatch(
        /question|feedback_comment|display_name|requester_name|storage_path|experience/,
      );
    }
  });

  it('says in the limitations that advice is measured, and what is not', () => {
    const text = ANALYTICS_LIMITATIONS.join(' ');
    expect(text).not.toMatch(/Advice usage and case outcomes are not measured/);
    expect(text).toMatch(/Advice figures are national only/);
  });
});

describe('the query as logged', () => {
  it('inlines dates, state lists and NULL', () => {
    const q = inlineAnalyticsQuery('SELECT $1::timestamptz, $2::timestamptz, $3::text[]', [
      new Date('2026-09-30T22:00:00Z'),
      new Date('2026-10-01T22:00:00Z'),
      ['CE', "W'E"],
    ]);
    expect(q).toBe(
      "SELECT '2026-09-30T22:00:00.000Z'::timestamptz, '2026-10-01T22:00:00.000Z'::timestamptz, ARRAY['CE', 'W''E']::text[]",
    );
    expect(inlineAnalyticsQuery('$3::text[]', [1, 2, null])).toBe('NULL::text[]');
  });
});

describe('which states a caller may count', () => {
  it('an administrator holding the permission everywhere sees the nation', () => {
    expect(analyticsStates({ kind: 'all' }, PLATFORM, undefined, refuse)).toBeNull();
    expect(analyticsStates({ kind: 'all' }, PLATFORM, 'CE', refuse)).toEqual(['CE']);
  });

  it('a supervisor sees their own state and cannot name another', () => {
    const scope = { kind: 'state', stateId: 'CE' } as const;
    expect(analyticsStates(scope, PLATFORM, undefined, refuse)).toEqual(['CE']);
    expect(analyticsStates(scope, PLATFORM, 'CE', refuse)).toEqual(['CE']);
    expect(() => analyticsStates(scope, PLATFORM, 'WE', refuse)).toThrow('forbidden');
  });

  it('the permission narrows the role, and never widens it', () => {
    const scope = { kind: 'state', stateId: 'CE' } as const;
    expect(analyticsStates(scope, statesCoverage('CE', 'WE'), undefined, refuse)).toEqual(['CE']);
    expect(() => analyticsStates(scope, statesCoverage('WE'), undefined, refuse)).toThrow();
    expect(analyticsStates({ kind: 'all' }, statesCoverage('WE', 'CE'), undefined, refuse)).toEqual(
      ['CE', 'WE'],
    );
  });

  it('an officer is refused, whatever they ask for', () => {
    expect(() =>
      analyticsStates(
        { kind: 'caseload', officerId: 'o', payamId: 'p', stateId: 'CE' },
        PLATFORM,
        undefined,
        refuse,
      ),
    ).toThrow();
  });
});

describe('the workbook', () => {
  const summary: AnalyticsSummary = {
    window: { from: '2026-09-23', to: '2026-10-22', days: 30, time_zone: 'Africa/Juba' },
    state_id: null,
    scope_states: null,
    generated_at: '2026-10-22T08:00:00.000Z',
    metrics: ANALYTICS_METRICS.map((m) =>
      m.id === 'participation.activities'
        ? {
            id: m.id,
            value: 3,
            breakdown: [
              { key: 'farmer', value: 3 },
              { key: 'trader', value: 2 },
            ],
          }
        : m.id === 'participation.by_state'
          ? { id: m.id, value: 4, breakdown: [{ key: 'CE', label: 'Central Equatoria', value: 4 }] }
          : m.id === 'support.received'
            ? { id: m.id, value: null, unavailable: 'not_in_database' as const }
            : { id: m.id, value: 1 },
    ),
    limitations: ANALYTICS_LIMITATIONS,
  };
  const sheets = analyticsSheets(summary, {
    stateLabel: 'All states in scope',
    scopeLabel: 'National',
  });
  const flat = (name: string) => JSON.stringify(sheets.find((s) => s.name === name)?.rows ?? null);

  it('has a Summary first, a sheet per breakdown with rows, and Definitions last', () => {
    expect(sheets[0]?.name).toBe('Summary');
    expect(sheets[sheets.length - 1]?.name).toBe('Definitions');
    expect(sheets.map((s) => s.name)).toEqual([
      'Summary',
      'Active accounts by state',
      'What account holders do',
      'Definitions',
    ]);
  });

  it('carries the window, cut-off, filters and generation time in Juba time', () => {
    for (const name of ['Summary', 'Definitions']) {
      const text = flat(name);
      expect(text).toContain('2026-09-23 to 2026-10-22');
      expect(text).toContain('End of 2026-10-22');
      expect(text).toContain('All states in scope');
      expect(text).toContain('22 Oct 2026, 10:00');
    }
  });

  it('shows an unmeasured figure as words with the reason, never as 0', () => {
    const row = sheets[0]!.rows.find((r) => r[1] === 'Support messages received');
    expect(row?.[2]).toBe('Not measured');
    expect(String(row?.[4])).toMatch(/not in the database/);
  });

  it('defines every figure and lists the limitations', () => {
    const text = flat('Definitions');
    for (const def of ANALYTICS_METRICS) expect(text).toContain(def.id);
    for (const l of ANALYTICS_LIMITATIONS) expect(text).toContain(JSON.stringify(l).slice(1, -1));
  });

  it('labels breakdown rows from the definition, then the server, then the key', () => {
    const def = ANALYTICS_METRICS.find((m) => m.id === 'participation.by_state')!;
    expect(breakdownLabel(def, { key: 'none' })).toBe('No state given');
    expect(breakdownLabel(def, { key: 'CE', label: 'Central Equatoria' })).toBe(
      'Central Equatoria',
    );
    expect(breakdownLabel(def, { key: 'XX' })).toBe('XX');
    expect(flat('What account holders do')).toContain('overlap');
  });
});

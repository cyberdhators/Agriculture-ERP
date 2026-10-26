import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMatchAlertFunnel, type MatchAlertReport } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import { matchAlertSheets } from '../analytics/match-alert-workbook';
import { buildXlsx } from '../analytics/xlsx';
import { matchAlertReportSql } from './match-alert-report';

/**
 * MATCH-ALERT RESULTS AND SAVED SEARCHES, READ AS TEXT AND AS DATA
 * (2026-11-03). The report's SQL counts and never returns a person; the
 * workbook is aggregated; the saved-search routes read the caller's own rows
 * only. No database: the statement is built and read, the workbook built.
 */

const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

const ALL = { marketingNotice: true, sources: true, conversation: true, orders: true };

describe('the report statement', () => {
  const sql = matchAlertReportSql(ALL);
  const outer = sql.slice(sql.lastIndexOf('\nSELECT to_char'));

  it('returns a day, a source and counts, nothing else', () => {
    const select = outer.slice(0, outer.indexOf('\n  FROM a'));
    expect(select).toMatch(/AS day/);
    expect(select).toMatch(/a\.source/);
    expect(select).not.toMatch(/auth_user_id|poster|product_name|post_id|phone|name\b|body/);
    expect(outer).toMatch(/GROUP BY 1, 2/);
  });

  it('a conversation counts within 7 days, a deal within 30, between the two people', () => {
    expect(sql).toMatch(/interval '7 days'/);
    expect(sql).toMatch(/interval '30 days'/);
    expect(sql).toMatch(
      /owner_auth_user_id = a\.poster AND c\.starter_auth_user_id = a\.auth_user_id/,
    );
    expect(sql).toMatch(/du\.status::text IN \('delivered', 'completed'\)/);
    expect(sql).toMatch(/ae\.after ->> 'status' IN \('completed', 'sold'\)/);
  });

  it('every filter is a parameter, never interpolated', () => {
    expect(sql).toMatch(/\$3::text\[\] AS st/);
    expect(sql).toMatch(/w\.st IS NULL OR post\.state_id = ANY\(w\.st\)/);
    expect(sql).toMatch(/w\.pr IS NULL OR post\.product_name ILIKE/);
    expect(sql).toMatch(/w\.src IS NULL OR/);
  });

  it('without the new columns, the source comes from the post kind and no SMS is counted', () => {
    const old = matchAlertReportSql({ ...ALL, sources: false });
    expect(old).not.toMatch(/m\.source|m\.sms_sent_at/);
    expect(old).toMatch(/NULL::timestamptz AS sms_sent_at/);
  });

  it('without purchase orders, only the recorded completions count', () => {
    expect(matchAlertReportSql({ ...ALL, orders: false })).not.toMatch(/purchase_order/);
  });
});

describe('the workbook', () => {
  const report: MatchAlertReport = {
    window: { from: '2026-10-01', to: '2026-10-07', days: 7, time_zone: 'Africa/Juba' },
    filters: { state_id: null, commodity: 'crop', product: null, source: null },
    scope_states: null,
    generated_at: '2026-10-08T09:00:00.000Z',
    limitations: ['Counts only.'],
    ...buildMatchAlertFunnel(
      [
        {
          day: '2026-10-02',
          source: 'saved_search',
          sent: 3,
          in_app: 3,
          sms: 1,
          read: 2,
          conversations: 1,
          conversation_due: 0,
          conversation_due_hit: 0,
          deals: 0,
          deal_due: 0,
          deal_due_hit: 0,
        },
      ],
      { from: '2026-10-01', to: '2026-10-07', days: 7 },
    ),
  };
  const sheets = matchAlertSheets(report, {
    stateLabel: 'All states in scope',
    scopeLabel: 'National',
  });

  it('has a summary, sources, a trend with a chart, and the definitions', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'By source', 'Over time', 'Definitions']);
    expect(sheets.find((s) => s.name === 'Over time')?.charts).toHaveLength(1);
    expect(sheets.find((s) => s.name === 'By source')?.charts).toHaveLength(1);
  });

  it('a rate with no denominator is "Not measured", never 0', () => {
    const summary = sheets[0]!.rows;
    const conv = summary.find((r) => r[0] === 'Led to a conversation (%)');
    expect(conv?.[1]).toBe('Not measured');
  });

  it('builds into a real file', () => {
    const bytes = buildXlsx(sheets, new Date(report.generated_at));
    expect(bytes.length).toBeGreaterThan(1000);
    // A ZIP starts "PK".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});

describe('the saved-search routes read the caller’s own rows only', () => {
  for (const file of [
    'app/api/account/saved-searches/route.ts',
    'app/api/account/saved-searches/[id]/route.ts',
  ]) {
    it(`${file}: every statement on saved_search is keyed by the sign-in or a row it found`, () => {
      const text = read(file);
      expect(text).toMatch(/ownerOf\(auth\)/);
      // Reads name the owner; writes name an id that loadOwn / the insert just returned.
      for (const where of text.match(/WHERE s\.[^`]*/g) ?? []) {
        expect(where).toMatch(/s\.auth_user_id = \$\d::uuid|s\.id = \$1::uuid/);
      }
      expect(text).not.toMatch(/body\.auth_user_id|params\.auth_user_id/);
    });
  }

  it('deletion is soft', () => {
    const text = read('app/api/account/saved-searches/[id]/route.ts');
    expect(text).toMatch(/SET deleted_at = now\(\)/);
    expect(text).not.toMatch(/DELETE FROM/);
  });
});

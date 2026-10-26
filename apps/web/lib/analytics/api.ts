// Client data layer for marketplace and account analytics (2026-10-22). It
// calls GET /api/analytics/summary for the figures and POST
// /api/analytics/export for the Excel workbook. The filters are validated by
// the shared `analyticsFilterSchema` before they are sent, so the page and the
// routes cannot disagree about what is valid. Every scope, permission and
// figure lives on the server; this module never touches the database.

import {
  type AnalyticsFilter,
  type AnalyticsSummary,
  type MatchAlertReport,
  type MatchAlertReportFilter,
  analyticsExportSchema,
  analyticsFilterSchema,
  matchAlertExportSchema,
  matchAlertReportFilterSchema,
} from '@agri-erp/shared';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class AnalyticsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AnalyticsApiError';
  }
}

interface ErrorBody {
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function failure(res: Response): Promise<AnalyticsApiError> {
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  return new AnalyticsApiError(
    res.status,
    body.error?.code ?? 'unknown',
    body.error?.message ?? `Request failed (${res.status})`,
    body.error?.fields,
  );
}

const toQuery = (filter: Record<string, unknown>): string => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  return qs.toString();
};

/** The figures for a window, within the caller's scope. */
export async function getAnalyticsSummary(filter: AnalyticsFilter = {}): Promise<AnalyticsSummary> {
  const clean = analyticsFilterSchema.parse(filter);
  const query = toQuery(clean);
  const res = await fetch(`/api/analytics/summary${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { data?: AnalyticsSummary };
  if (!body.data) throw new AnalyticsApiError(500, 'empty', 'No figures in the response');
  return body.data;
}

/** The file name the server gave, or a sensible one. */
const fileNameOf = (res: Response, fallback: string): string =>
  /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;

/**
 * Asks the server for the workbook (the server records the export before it
 * answers) and hands it to the browser as a download.
 */
export async function downloadAnalyticsWorkbook(filter: AnalyticsFilter = {}): Promise<void> {
  const clean = analyticsExportSchema.parse({ filters: analyticsFilterSchema.parse(filter) });
  const res = await fetch('/api/analytics/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clean),
  });
  if (!res.ok) throw await failure(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameOf(res, 'agrione-analytics.xlsx');
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoked on the next tick: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// ---------------------------------------------------------------------------
// MATCH-ALERT RESULTS (2026-11-03): GET /api/analytics/match-alerts and its
// export, the same way as the figures above.
// ---------------------------------------------------------------------------

/** What match alerts led to, for a window, within the caller's scope. */
export async function getMatchAlertReport(
  filter: MatchAlertReportFilter = {},
): Promise<MatchAlertReport> {
  matchAlertReportFilterSchema.parse(filter);
  const query = toQuery(filter);
  const res = await fetch(`/api/analytics/match-alerts${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { data?: MatchAlertReport };
  if (!body.data) throw new AnalyticsApiError(500, 'empty', 'No figures in the response');
  return body.data;
}

/** The match-alert workbook, recorded by the server before it answers. */
export async function downloadMatchAlertWorkbook(
  filter: MatchAlertReportFilter = {},
): Promise<void> {
  matchAlertExportSchema.parse({ filters: filter });
  const res = await fetch('/api/analytics/match-alerts/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filters: filter }),
  });
  if (!res.ok) throw await failure(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameOf(res, 'agrione-match-alerts.xlsx');
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

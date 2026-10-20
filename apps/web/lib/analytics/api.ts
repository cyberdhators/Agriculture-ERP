// Client data layer for marketplace and account analytics (2026-10-22). It
// calls GET /api/analytics/summary for the figures and POST
// /api/analytics/export for the Excel workbook. The filters are validated by
// the shared `analyticsFilterSchema` before they are sent, so the page and the
// routes cannot disagree about what is valid. Every scope, permission and
// figure lives on the server; this module never touches the database.

import {
  type AnalyticsFilter,
  type AnalyticsSummary,
  analyticsExportSchema,
  analyticsFilterSchema,
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

const toQuery = (filter: AnalyticsFilter): string => {
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

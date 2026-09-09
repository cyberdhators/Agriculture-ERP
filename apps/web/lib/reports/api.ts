// Client data layer for dashboards, reporting and export (deliverable, C-10).
// It calls the live B10 routes — GET /api/reports/summary for the figures and
// GET/POST /api/reports/exports for the export log — through the standard
// response envelope (CONVENTIONS §3). The filters are validated by the shared
// `reportFilterSchema`/`exportRequestSchema` before they are sent, so the
// client and the routes cannot disagree about what is valid. Every scope,
// permission and figure lives on the server; this module never touches the
// database and never names a farmer. Gated by NEXT_PUBLIC_USE_LIVE_REPORTS
// (off = fixtures elsewhere).

import {
  exportRequestSchema,
  reportFilterSchema,
  type ExportRequest,
  type ReportFilter,
  type ReportType,
} from '@agri-erp/shared';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_REPORTS=1`. Off = fixtures. */
export const LIVE_REPORTS = process.env.NEXT_PUBLIC_USE_LIVE_REPORTS === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status. */
export class ReportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ReportApiError';
  }
}

/** One row of a reach breakdown: verified count and reached count for a key. */
export interface Breakdown {
  key: string;
  verified: number;
  reached: number;
}

/** The dashboard figures, as `GET /api/reports/summary` presents them (C-10).
 *  It names no farmer; the crop rows do not sum to the total (see `notes`). */
export interface Summary {
  as_of: string;
  period: { from: string | null; to: string };
  season: string | null;
  farmers: { verified: number; pending: number; rejected: number; merged: number };
  reach: { farmers_reached: number; visits: number; other_farmers_visited: number };
  land: { farms_mapped: number; hectares: number; farms_of_verified: number };
  by: {
    sex: Breakdown[];
    age_band: Breakdown[];
    state: Breakdown[];
    county: Breakdown[];
    payam: Breakdown[];
    crop: { key: string; verified: number }[];
  };
  notes: string[];
}

/** One entry in the export log, as the exports route presents it (C-10.8). */
export interface ExportRecord {
  id: string;
  exported_by: string;
  actor_type: string;
  report_type: ReportType | string;
  query: string;
  filters: unknown;
  scope: unknown;
  data_cutoff: string;
  row_count: number;
  exported_at: string;
}

/** What `POST /api/reports/exports` returns: the logged export and its data.
 *  `data` is the report payload — a `Summary` for `summary`, farmer-number
 *  rows for `farmers` — passed through untyped since the layer only forwards
 *  it (the farmers list carries farmer numbers only, C-10.11). */
export interface ExportResult {
  export: ExportRecord;
  data: unknown;
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    const err = body.error;
    throw new ReportApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.fields,
    );
  }
  return body;
}

function filterToQuery(filter: ReportFilter): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') qs.set(key, String(value));
  }
  return qs.toString();
}

/**
 * The dashboard figures within the caller's scope (C-10.10). Filters are
 * validated by the shared schema first — an out-of-range cut-off or a reversed
 * period is refused here before any request.
 */
export async function getSummary(filter: ReportFilter = {}): Promise<Summary> {
  const clean = reportFilterSchema.parse(filter);
  const query = filterToQuery(clean);
  const body = await request<Summary>(`/api/reports/summary${query ? `?${query}` : ''}`);
  if (!body.data) throw new ReportApiError(500, 'empty', 'No summary in the response');
  return body.data;
}

export interface ExportListParams {
  limit?: number;
  cursor?: string;
}

export interface ExportListResult {
  exports: ExportRecord[];
  cursor: string | null;
  hasMore: boolean;
}

/** The export log, newest first, within scope (admins all, supervisors their
 *  state). C-10.8. */
export async function listExports(params: ExportListParams = {}): Promise<ExportListResult> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const query = qs.toString();
  const body = await request<ExportRecord[]>(`/api/reports/exports${query ? `?${query}` : ''}`);
  return {
    exports: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/**
 * Run and record an export (C-10.8, C-10.9), `admin` or `supervisor` only. The
 * body is validated by the shared `exportRequestSchema` first. On success it
 * returns the logged export and the report data behind it.
 */
export async function createExport(input: ExportRequest): Promise<ExportResult> {
  const clean = exportRequestSchema.parse(input);
  const body = await request<ExportResult>('/api/reports/exports', {
    method: 'POST',
    body: JSON.stringify(clean),
  });
  if (!body.data) throw new ReportApiError(500, 'empty', 'No export in the response');
  return body.data;
}

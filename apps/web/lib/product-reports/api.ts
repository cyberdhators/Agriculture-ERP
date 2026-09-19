import type { ProductReport, ProductReportFilter, UnreadReportCount } from '@agri-erp/shared';

import { ServiceNotConnectedError } from '@/lib/communications/api';

/**
 * THE PRODUCT-REPORT CLIENT — WRITTEN AGAINST ROUTES THAT DO NOT EXIST YET.
 *
 * The dependency chain is longer than the screen implies: a report is about a
 * marketplace listing, and there is no listing table, no listing API and no
 * report submission path in this repository. Everything below is a contract.
 *
 * NOTHING HERE PRODUCES A ROW OR A NUMBER. There are no fixtures, no browser
 * storage and no defaults: a route that is not deployed raises
 * `ServiceNotConnectedError`, the queue shows an explicit unavailable state,
 * and the navigation shows NO BADGE — not a zero, because zero would be a claim
 * that nothing has been reported, and nobody has looked.
 */

export class ProductReportApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductReportApiError';
  }
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (response.status === 404) throw new ServiceNotConnectedError('The marketplace report service');
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok) {
    throw new ProductReportApiError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The reports could not be read (${response.status}).`,
    );
  }
  return body;
}

export interface ProductReportPage {
  reports: ProductReport[];
  cursor: string | null;
  hasMore: boolean;
}

/** `GET /api/admin/product-reports` — administrator only, cursor-paged. */
export async function listProductReports(
  filter: ProductReportFilter = {},
): Promise<ProductReportPage> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) qs.set(key, String(value));
  const query = qs.toString();
  const body = await request<ProductReport[]>(
    `/api/admin/product-reports${query ? `?${query}` : ''}`,
  );
  return {
    reports: body.data ?? [],
    cursor: body.page?.cursor ?? null,
    hasMore: body.page?.hasMore ?? false,
  };
}

/** `GET /api/admin/product-reports/:id` — administrator only. */
export async function getProductReport(id: string): Promise<ProductReport> {
  const body = await request<ProductReport>(`/api/admin/product-reports/${encodeURIComponent(id)}`);
  if (!body.data) throw new ProductReportApiError(500, 'empty', 'No report in the response.');
  return body.data;
}

/**
 * `GET /api/admin/product-reports/unread-count` — administrator only.
 *
 * The badge's only source. A count of reports in the `new` state, computed by
 * the database. Never derived from a loaded page, never from storage, never
 * defaulted to zero.
 */
export async function getUnreadReportCount(): Promise<UnreadReportCount> {
  const body = await request<UnreadReportCount>('/api/admin/product-reports/unread-count');
  if (!body.data) throw new ProductReportApiError(500, 'empty', 'No count in the response.');
  return body.data;
}

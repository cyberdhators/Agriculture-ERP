// Client data layer for the administration overview (2026-10-28). It calls
// GET /api/admin/overview. The filter is validated by the shared
// `adminOverviewFilterSchema` before it is sent, so the page and the route
// cannot disagree about what is valid. Scope and permission are the server's.

import {
  type AdminOverview,
  type AdminOverviewFilter,
  adminOverviewFilterSchema,
} from '@agri-erp/shared';

export class OverviewApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OverviewApiError';
  }
}

/** The query string for a filter; empty values are left out. Pure. */
export function overviewQuery(filter: AdminOverviewFilter): string {
  const qs = new URLSearchParams();
  for (const key of ['from', 'to', 'state_id', 'actor'] as const) {
    const value = filter[key];
    if (value) qs.set(key, value);
  }
  return qs.toString();
}

export async function getAdminOverview(filter: AdminOverviewFilter = {}): Promise<AdminOverview> {
  const query = overviewQuery(adminOverviewFilterSchema.parse(filter));
  const res = await fetch(`/api/admin/overview${query ? `?${query}` : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new OverviewApiError(
      res.status,
      body.error?.message ?? `The overview could not be loaded (${res.status}).`,
    );
  }
  const body = (await res.json()) as { data?: AdminOverview };
  if (!body.data) throw new OverviewApiError(500, 'The overview came back empty.');
  return body.data;
}

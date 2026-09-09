// Client data layer for caseload reassignment (deliverable, C-8R.2). It calls
// the live B8.5 route — POST /api/farmers/:id/reassign — through the standard
// response envelope (CONVENTIONS §3). The body is validated by the shared
// `reassignFarmerSchema` before it is sent, so the client and the route cannot
// disagree about what is valid. Authorization (admin only), scope and the rule
// that the new officer is active and in the farmer's payam all live on the
// server; this module never touches the database. Self-contained and
// name-neutral. Gated by NEXT_PUBLIC_USE_LIVE_FARMERS (off = fixtures
// elsewhere).

import { reassignFarmerSchema } from '@agri-erp/shared';

/** Flip to live data with `NEXT_PUBLIC_USE_LIVE_FARMERS=1`. Off = fixtures. */
export const LIVE_REASSIGN = process.env.NEXT_PUBLIC_USE_LIVE_FARMERS === '1';

/** An error carried by an API error body (CONVENTIONS §4), with its status.
 *  The reassign route returns `reassign_same_officer` when the farmer already
 *  has that officer, and `reassign_officer_not_found` when the officer is not
 *  active or not in the farmer's payam. */
export class ReassignApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'ReassignApiError';
  }
}

/** The subset of the farmer `present()` shape a reassignment reads back. The
 *  caseload pointer is who works the farmer now; `registered_by` is history and
 *  is unchanged by a reassignment (C-5.9). */
export interface ReassignedFarmer {
  id: string;
  farmer_number: string;
  payam_id: string;
  registered_by: string | null;
  caseload_officer_id: string | null;
  verification_status: string;
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; rule?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    const err = body.error;
    throw new ReassignApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed (${res.status})`,
      err?.rule,
    );
  }
  return body;
}

/**
 * Move a farmer's caseload to another officer (C-8R.2), `admin` only. The body
 * is validated by the shared `reassignFarmerSchema` before it is sent — an
 * officer id that is not a UUID is refused here before any request. The server
 * checks the officer is active and in the farmer's payam and refuses a no-op
 * move; those come back as `ReassignApiError` with `reassign_officer_not_found`
 * or `reassign_same_officer`. On success it returns the farmer worked by the
 * new officer; `registered_by` is unchanged.
 */
export async function reassignFarmer(id: string, officerId: string): Promise<ReassignedFarmer> {
  const input = reassignFarmerSchema.parse({ officer_id: officerId });
  const body = await request<ReassignedFarmer>(`/api/farmers/${encodeURIComponent(id)}/reassign`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!body.data) throw new ReassignApiError(500, 'empty', 'No farmer in the response');
  return body.data;
}

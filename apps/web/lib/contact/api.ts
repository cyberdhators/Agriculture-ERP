// Client data layer for buyer contact requests — deliverable (g), buyer–seller
// matching, as the Inception Report defines it: an introduction recorded by
// staff. A buyer holds no account (DECISIONS, 2026-09-09); what they give at
// the moment of interest is the record, and the farmer's caseload officer
// makes the introduction. Written to docs/api/contact-request-contract.md,
// proposed by Lane 2 before either half exists; Lane 1 builds the routes to it.
// Gated by NEXT_PUBLIC_USE_LIVE_CONTACT (off = a browser-local store, so the
// buyer form, the officer's queue and the farmer's Home can be walked today).
import type { ContactRequestBody } from './validate';

export const LIVE_CONTACT = process.env.NEXT_PUBLIC_USE_LIVE_CONTACT === '1';

export const CONTACT_STATUSES = ['new', 'introduced', 'declined', 'no_answer'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactRequest {
  id: string;
  listing_id: string;
  farmer_id: string;
  buyer_name: string;
  buyer_phone: string;
  message: string | null;
  quantity: string | null;
  status: ContactStatus;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

export class ContactApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContactApiError';
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.data === undefined) {
    throw new ContactApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return body.data;
}

/** A buyer, no session: POST /api/listings/:id/contact-requests. */
export function createContactRequest(
  listingId: string,
  body: ContactRequestBody,
): Promise<ContactRequest> {
  return request(`/api/listings/${listingId}/contact-requests`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Staff: the requests in the caller's scope (an officer: their caseload's farmers). */
export function listContactRequests(): Promise<ContactRequest[]> {
  return request('/api/contact-requests');
}

/** The officer records the outcome of the introduction. */
export function updateContactRequest(
  id: string,
  body: { status: Exclude<ContactStatus, 'new'>; note?: string },
): Promise<ContactRequest> {
  return request(`/api/contact-requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

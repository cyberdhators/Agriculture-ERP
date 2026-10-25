'use client';

import type {
  AnnouncementDelivery,
  AnnouncementPreview,
  DeliveryCounts,
  MessageTemplate,
  StaffAnnouncement,
} from '@agri-erp/shared';

/**
 * OFFICIAL ANNOUNCEMENTS AND TEMPLATES, FOR THE BROWSER (2026-10-27). Thin
 * calls to /api/admin/announcements and /api/admin/message-templates; every
 * rule is enforced by those routes, and a refusal is shown as it came.
 */

export interface Failure {
  status: number;
  message: string;
  fields: Record<string, string>;
}

export const asFailure = (e: unknown): Failure =>
  typeof e === 'object' && e !== null && 'message' in e
    ? (e as Failure)
    : { status: 0, message: String(e), fields: {} };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw {
      status: 0,
      message: 'The server could not be reached. Check the connection.',
      fields: {},
    } satisfies Failure;
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    page?: { cursor: string | null; hasMore: boolean };
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || body.data === undefined) {
    throw {
      status: res.status,
      message: body.error?.message ?? `The request failed (${res.status}).`,
      fields: body.error?.fields ?? {},
    } satisfies Failure;
  }
  return (body.page ? { rows: body.data, page: body.page } : body.data) as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface AnnouncementState {
  announcement: StaffAnnouncement;
  deliveries: DeliveryCounts;
  remaining: number;
  batch?: {
    in_app_sent: number;
    sms: { sent: number; failed: number; skipped: number; requeued: number };
    email: { sent: number; failed: number; skipped: number; requeued: number };
    waiting_for_configuration: ('in_app' | 'sms' | 'email')[];
    interrupted_marked_failed: number;
  };
}

export const listAnnouncements = () => call<StaffAnnouncement[]>('/api/admin/announcements');
export const createAnnouncement = (draft: unknown) =>
  call<StaffAnnouncement>('/api/admin/announcements', send('POST', draft));
export const getAnnouncement = (id: string) =>
  call<AnnouncementState>(`/api/admin/announcements/${id}`);
export const updateAnnouncement = (id: string, draft: unknown) =>
  call<StaffAnnouncement>(`/api/admin/announcements/${id}`, send('PUT', draft));
export const discardAnnouncement = (id: string) =>
  call<void>(`/api/admin/announcements/${id}`, send('DELETE'));
export const previewAnnouncement = (id: string) =>
  call<AnnouncementPreview>(`/api/admin/announcements/${id}/preview`);
export const sendAnnouncement = (id: string, expectedRecipients: number) =>
  call<AnnouncementState>(
    `/api/admin/announcements/${id}/send`,
    send('POST', { confirm: true, expected_recipients: expectedRecipients }),
  );
export const processAnnouncement = (id: string) =>
  call<AnnouncementState>(`/api/admin/announcements/${id}/process`, send('POST'));
export const retryAnnouncement = (id: string) =>
  call<AnnouncementState>(`/api/admin/announcements/${id}/retry`, send('POST'));

export interface DeliveryPage {
  rows: AnnouncementDelivery[];
  page: { cursor: string | null; hasMore: boolean };
}

export const listDeliveries = (
  id: string,
  filter: { channel?: string; status?: string; cursor?: string | null },
) => {
  const q = new URLSearchParams();
  if (filter.channel) q.set('channel', filter.channel);
  if (filter.status) q.set('status', filter.status);
  if (filter.cursor) q.set('cursor', filter.cursor);
  const qs = q.toString();
  return call<DeliveryPage>(`/api/admin/announcements/${id}/deliveries${qs ? `?${qs}` : ''}`);
};

export const listTemplates = () => call<MessageTemplate[]>('/api/admin/message-templates');
export const createTemplate = (template: unknown) =>
  call<MessageTemplate>('/api/admin/message-templates', send('POST', template));
export const updateTemplate = (id: string, patch: unknown) =>
  call<MessageTemplate>(`/api/admin/message-templates/${id}`, send('PATCH', patch));

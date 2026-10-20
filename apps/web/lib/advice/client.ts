'use client';

import { useEffect, useState } from 'react';

import type {
  AdviserApplicationOwn,
  AdviserApplicationState,
  AdviceCaseView,
  AdviceProviderOwn,
  AdviceProviderPublic,
  AdviceTopic,
} from '@agri-erp/shared';

/**
 * INDEPENDENT ADVICE, THE BROWSER'S SIDE (2026-10-22). Farmers and buyers
 * share it: cases and advice profiles belong to the sign-in. Every call goes
 * through an API route, which decides who may do what. Sending a request needs
 * signal: the answer says which case it opened, and a refusal has to be read
 * now. The conversation under a case uses the messaging client, with its
 * offline outbox.
 */

export class AdviceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AdviceError';
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new AdviceError(0, 'network', 'The server could not be reached. Check the connection.');
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    throw new AdviceError(
      res.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The request failed (${res.status}).`,
      body.error?.fields ?? {},
    );
  }
  return body.data as T;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export interface ProviderFilter {
  q?: string;
  topic?: string;
  language?: string;
  state_id?: string;
  delivery_mode?: string;
  /** '1' for approved advisers only (2026-10-24). */
  approved?: string;
}

/** The directory: the first hundred matches is plenty for a person to read. */
export function listProviders(filter: ProviderFilter): Promise<AdviceProviderPublic[]> {
  const q = new URLSearchParams({ limit: '100' });
  for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
  return call<AdviceProviderPublic[]>(`/api/advice/providers?${q.toString()}`);
}

export const getProvider = (id: string) =>
  call<AdviceProviderPublic>(`/api/advice/providers/${encodeURIComponent(id)}`);

export const getMyProvider = () =>
  call<{ profile: AdviceProviderOwn | null }>('/api/advice/my-provider').then((d) => d.profile);

export async function saveMyProvider(body: Record<string, unknown>): Promise<AdviceProviderOwn> {
  const saved = await call<AdviceProviderOwn>('/api/advice/my-provider', send('PUT', body));
  adviceProfileChanged(true);
  return saved;
}

/* ── The optional approved-adviser application (2026-10-24) ─────────── */

export const getMyApplication = () =>
  call<AdviserApplicationState>('/api/advice/my-provider/application');

export const applyAsAdviser = (body: Record<string, unknown>) =>
  call<AdviserApplicationOwn>('/api/advice/my-provider/application', send('POST', body));

export const replyToClarification = (reply: string) =>
  call<AdviserApplicationOwn>('/api/advice/my-provider/application/reply', send('POST', { reply }));

export const withdrawApplication = () =>
  call<AdviserApplicationOwn>('/api/advice/my-provider/application/withdraw', send('POST', {}));

export const listCases = (role: 'requester' | 'provider') =>
  call<AdviceCaseView[]>(`/api/advice/cases?role=${role}`);

export const getCase = (id: string) =>
  call<AdviceCaseView>(`/api/advice/cases/${encodeURIComponent(id)}`);

/** The id is made once per form, so pressing Send again after a lost answer is the same request. */
export const createCase = (input: {
  id: string;
  provider_id: string;
  topic: AdviceTopic;
  question: string;
  preferred_contact: string;
  share_details: boolean;
}) => call<AdviceCaseView>('/api/advice/cases', send('POST', input));

export const changeCase = (
  id: string,
  body:
    | { action: 'start' }
    | { action: 'close'; outcome: string }
    | { action: 'feedback'; rating: number; comment?: string },
) => call<AdviceCaseView>(`/api/advice/cases/${encodeURIComponent(id)}`, send('PATCH', body));

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;

/* ── Does this account have an advice profile? (the menu asks) ───────── */

const CHANGED = 'agrione-advice-profile-changed';
let known: boolean | null = null;

function adviceProfileChanged(has: boolean): void {
  known = has;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

/** Whether the signed-in account has an advice profile, asked once per page load. */
export function useHasAdviceProfile(enabled: boolean): boolean {
  const [has, setHas] = useState(known ?? false);
  useEffect(() => {
    if (!enabled) return;
    const onChanged = () => setHas(known ?? false);
    window.addEventListener(CHANGED, onChanged);
    if (known === null) {
      getMyProvider()
        .then((p) => adviceProfileChanged(p !== null))
        .catch(() => undefined);
    } else {
      setHas(known);
    }
    return () => window.removeEventListener(CHANGED, onChanged);
  }, [enabled]);
  return enabled && has;
}

'use client';

import type { SettingKey, SettingValues } from '@agri-erp/shared';

/** A refused or failed request, as the settings screens show it. */
export interface Failure {
  status: number;
  message: string;
  fields: Record<string, string>;
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
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
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || body.data === undefined) {
    throw {
      status: res.status,
      message: body.error?.message ?? `The request failed (${res.status}).`,
      fields: body.error?.fields ?? {},
    } satisfies Failure;
  }
  return body.data;
}

export const asFailure = (e: unknown): Failure =>
  typeof e === 'object' && e !== null && 'message' in e
    ? (e as Failure)
    : { status: 0, message: String(e), fields: {} };

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** One setting at its current version, as GET /api/admin/settings returns it. */
export interface CurrentSetting<K extends SettingKey = SettingKey> {
  key: K;
  version: number;
  value: SettingValues[K];
  changed_at: string | null;
  changed_by: string | null;
}

/** PUT /api/admin/settings: saves the next version of one setting. */
export function saveSetting<K extends SettingKey>(
  key: K,
  expectedVersion: number,
  value: unknown,
): Promise<CurrentSetting<K>> {
  return call<CurrentSetting<K>>(
    '/api/admin/settings',
    json('PUT', { key, expected_version: expectedVersion, value }),
  );
}

/**
 * The field reasons of a refused save, keyed by the field inside `value`
 * ("value.service_name" -> "service_name"), so each form shows them beside
 * its own inputs.
 */
export function valueFields(failure: Failure | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(failure?.fields ?? {})) {
    out[k.startsWith('value.') ? k.slice(6) : k] = v;
  }
  return out;
}

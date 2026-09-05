import { expect } from 'vitest';
import { type CallOptions, type CallResult, type RouteModule, call } from './request';

/**
 * The C-5.13 scan, extended by C-6.10 with the rejection note. One scan, used
 * by every route test that handles a person's record.
 *
 * An error response may not contain a farmer's name, phone number, national
 * ID or rejection note anywhere. A success response may carry them only
 * inside `data`. Every phone a test invents is registered here so both
 * written forms are searched. The statuses seen are recorded so a file can
 * assert that every error path it can produce was actually scanned.
 */
export const GIVEN = 'Zzachol';
export const FAMILY = 'Zztestfamily';
export const NATIONAL_ID = 'ZZ123456';
/** A note that reads like the real thing: prose about a named person. */
export const NOTE = 'Zzachol says the plot near the river is her brother Zzdeng’s';

const phones = new Set<string>();
export const rememberPhone = (phone: string): string => {
  phones.add(phone);
  return phone;
};
const needles = (): string[] => [
  GIVEN,
  FAMILY,
  NATIONAL_ID,
  NOTE,
  'Zzdeng',
  ...[...phones].flatMap((p) => [p, p.slice(1), `0${p.slice(4)}`]),
];

export const seenStatuses = new Set<number>();

export function scan(result: CallResult, label: string): void {
  seenStatuses.add(result.status);
  const pii = needles();
  if (result.status >= 400) {
    for (const needle of pii) {
      expect(result.text, `${label}: ${result.status} response leaks personal data`).not.toContain(
        needle,
      );
    }
    expect(result.body, `${label}: an error carried warnings`).not.toHaveProperty('warnings');
    return;
  }
  const outsideData = JSON.stringify({ ...result.body, data: undefined });
  for (const needle of pii) {
    expect(outsideData, `${label}: personal data outside data on a ${result.status}`).not.toContain(
      needle,
    );
  }
}

export const checked = async (
  mod: RouteModule,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  options: CallOptions = {},
): Promise<CallResult> => {
  if (options.body && typeof options.body === 'object' && 'phone' in options.body) {
    rememberPhone(String((options.body as { phone: unknown }).phone));
  }
  const result = await call(mod, method, options);
  scan(result, `${method} ${options.params?.id ? '/:id' : ''}`);
  return result;
};

export const data = (r: CallResult) => r.body.data as Record<string, unknown>;
export const errorOf = (r: CallResult) =>
  r.body.error as { code: string; message: string; fields?: Record<string, string> };

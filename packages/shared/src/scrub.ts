import { parseSouthSudanMobile } from './phone';

/**
 * Removes personal data from anything before it leaves the process.
 *
 * Written for Sentry, but it takes a plain value and knows nothing about
 * Sentry. Sentry receives whatever an error happens to carry: once farmer
 * records exist, a crash inside a registration route carries a name, a phone
 * number and a national ID to a third party we do not control. This is what
 * stands between those two facts.
 *
 * It walks the WHOLE value. A scrubber that only covers the top level is the
 * failure mode here -- personal data in a breadcrumb, a stack frame's local
 * variables, or three levels down inside extra context is exactly as exposed as
 * personal data at the surface.
 */

/** The fixed replacement. Never a length, never a hash -- both leak. */
export const REDACTED = '[redacted]';

/**
 * Keys whose value is removed wherever the key appears, at any depth.
 *
 * Compared with case and separators ignored, so `alt_phone`, `altPhone` and
 * `Alt-Phone` are the same key. `name` is deliberately included even though it
 * redacts the SDK's own metadata -- `sdk.name`, `contexts.os.name` and the
 * rest. A rule with carve-outs is a rule someone widens later, and what is lost
 * is metadata rather than diagnosis.
 */
const SENSITIVE_KEYS = [
  'phone',
  'alt_phone',
  'national_id',
  'given_name',
  'family_name',
  'name',
  'email',
  'password',
  'token',
  'authorization',
  'cookie',
  // Sentry spells its request field `cookies`; the rule above means `cookie`.
  'cookies',

  /**
   * Source code attached to stack frames.
   *
   * These hold the lines around the throw site, verbatim. They are code, so
   * none of the rules above can judge them: a literal, a field name or a
   * comment near a failure travels exactly as written.
   *
   * Disabling Sentry's ContextLines integration is NOT enough, and B1.5 proved
   * it. With that integration removed from the loaded set, a live server still
   * transmitted `context_line` and `pre_context` -- something else in the
   * Next.js error path fills them in. Stripping them here works regardless of
   * who added them, because this is the last gate before the network.
   *
   * The filename, line and column survive, which is what a stack trace is for.
   */
  'context_line',
  'pre_context',
  'post_context',

  /**
   * The SDK's culture context: `contexts.culture.timezone` and `.locale`.
   *
   * Reachable -- the SDK attaches it before `beforeSend`, and the 2026-09-04
   * verification event showed `Asia/Calcutta` arriving. Not needed for
   * diagnosis, and it narrows a person's location: once staff in South Sudan
   * are using the system, every error would say where the device was. Listed
   * as keys rather than by stripping the context, so the rule holds wherever
   * a timezone or locale turns up, not only in that one place.
   */
  'timezone',
  'locale',

  /**
   * The rejection note (C-6.3): a supervisor's prose about a named farmer,
   * the one free-text field the system carries about a person. It travels
   * only inside the verification record; it never travels here.
   */
  'note',
];

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');
const SENSITIVE = new Set(SENSITIVE_KEYS.map(normaliseKey));

export const isSensitiveKey = (key: string): boolean => SENSITIVE.has(normaliseKey(key));

/**
 * A deliberately wide net: any run that could conceivably be a written phone
 * number, including spaces and hyphens, with or without a leading plus.
 *
 * Over-matching is the intended bias. A redacted timestamp in a stack trace is
 * cheaper than a leaked farmer's number. Every candidate is then confirmed
 * against `parseSouthSudanMobile`, so the definition of a valid South Sudan
 * number lives in exactly one place in this codebase -- see CONVENTIONS.md
 * section 8 on why a second definition drifts.
 */
const CANDIDATE = /\+?\d[\d\s-]{7,24}\d/g;

/** Compacted lengths worth testing inside a longer run of digits. */
const WINDOWS = [10, 12, 13];

/** True when any part of this candidate run parses as a South Sudan mobile. */
function containsPhoneNumber(candidate: string): boolean {
  const compact = candidate.replace(/[\s-]/g, '');
  if (parseSouthSudanMobile(compact).ok) return true;

  // A number embedded in a longer digit run still counts.
  for (const width of WINDOWS) {
    for (let start = 0; start + width <= compact.length; start += 1) {
      if (parseSouthSudanMobile(compact.slice(start, start + width)).ok) return true;
    }
  }
  return false;
}

/**
 * Replaces every phone number found anywhere in a string.
 *
 * The whole matched run is replaced, not just the digits that parsed, because a
 * partially redacted number is still most of a number.
 */
export function scrubString(value: string): string {
  return value.replace(CANDIDATE, (match) => (containsPhoneNumber(match) ? REDACTED : match));
}

/** Strips the query string from a URL, keeping the path for diagnosis. */
function scrubUrl(value: string): string {
  const cut = value.indexOf('?');
  return cut === -1 ? scrubString(value) : `${scrubString(value.slice(0, cut))}?${REDACTED}`;
}

function scrubUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => scrubUnknown(entry, seen));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : scrubUnknown(entry, seen);
  }
  return result;
}

/** Scrubs any value, at any depth. */
export function scrub(value: unknown): unknown {
  return scrubUnknown(value, new WeakSet());
}

/**
 * Scrubs one Sentry event.
 *
 * Everything is handled by the general walk above. The request is the one place
 * needing more than that: its query string and body go entirely, whether or not
 * they look like anything, because a request body is the richest source of
 * personal data an event can carry and we cannot know its shape in advance.
 */
export function scrubEvent<T>(event: T): T {
  const scrubbed = scrub(event) as Record<string, unknown>;

  const request = scrubbed['request'];
  if (request !== null && typeof request === 'object') {
    const asRecord = request as Record<string, unknown>;
    if ('query_string' in asRecord) asRecord['query_string'] = REDACTED;
    if ('data' in asRecord) asRecord['data'] = REDACTED;
    if (typeof asRecord['url'] === 'string') asRecord['url'] = scrubUrl(asRecord['url']);
  }

  return scrubbed as T;
}

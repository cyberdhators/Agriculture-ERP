import { z } from 'zod';

/**
 * PUSH ALERTS ON A PHONE (2026-11-03, the owner). docs/DECISIONS.md, "Push
 * alerts on a phone".
 *
 * A phone's browser hands over an address at Google's, Apple's, Mozilla's or
 * Microsoft's push service, and the server later posts an alert to it. So the
 * address is an outgoing request the server makes on a member's say-so: only
 * https addresses at those services are accepted, or a member could point the
 * server at anything it can reach.
 */

const PUSH_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

export const PUSH_MESSAGES = {
  endpoint: "This phone's alert address was not recognised.",
  keys: "This phone's alert keys were not recognised.",
} as const;

const pushEndpoint = z
  .string()
  .max(1000, PUSH_MESSAGES.endpoint)
  .refine(isPushEndpoint, PUSH_MESSAGES.endpoint);

const pushKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, PUSH_MESSAGES.keys)
  .max(200, PUSH_MESSAGES.keys);

/** POST /api/account/push-subscription: this phone's alert address, as its browser gave it. */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: pushKey, auth: pushKey }),
  /** The language this phone is using: an alert is worded in it. */
  language: z.enum(['en', 'ar']),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;

/** POST /api/account/push-subscription/remove: stop alerts to this phone. */
export const pushRemoveSchema = z.strictObject({ endpoint: pushEndpoint });

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * BIRD'S WEBHOOKS, THE PURE PART (2026-10-26). docs/DECISIONS.md, "SMS
 * delivery receipts". Bird signs every delivery with the Standard Webhooks
 * scheme (DOCUMENTED, bird.com/docs/guides/webhooks):
 *
 *   webhook-id         the event's identity; retries and replays reuse it
 *   webhook-timestamp  Unix seconds of this attempt
 *   webhook-signature  "v1,<base64 HMAC-SHA256>", several space-separated
 *                      while a secret is being rotated
 *
 * signed over `${id}.${timestamp}.${raw body}` with the key that is the
 * base64 after the secret's `whsec_` prefix. A delivery older or newer than
 * five minutes is refused (a replayed capture). Comparison is constant-time.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/sms/bird-webhook is server-only and must never be imported by a client.');
}

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** The HMAC key: the base64 after `whsec_` (a bare base64 secret is accepted too). */
export function webhookKey(secret: string): Buffer | null {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length >= 16 ? key : null;
}

/** The signature Bird would send for this delivery, `v1,<base64>`. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = webhookKey(secret);
  if (!key) throw new Error('The webhook secret is not a whsec_ base64 secret.');
  const mac = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type Verification =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'bad_secret' | 'stale' | 'bad_signature' };

/** Whether a delivery is Bird's, signed with this secret, and fresh. */
export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Verification {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || id.length > 200) {
    return { ok: false, reason: 'missing_headers' };
  }
  const key = webhookKey(secret);
  if (!key) return { ok: false, reason: 'bad_secret' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'stale' };
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const expected = Buffer.from(
    createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'),
  );
  for (const part of signature.split(' ')) {
    const [version, mac] = part.split(',', 2);
    if (version !== 'v1' || !mac) continue;
    const given = Buffer.from(mac);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}

/** The carrier receipts this application records, by Bird event type. */
export const RECEIPT_EVENTS = {
  'sms.delivered': 'delivered',
  'sms.undelivered': 'undelivered',
  'sms.failed': 'failed',
  'sms.rejected': 'rejected',
  'sms.expired': 'expired',
} as const;
export type ReceiptStatus = (typeof RECEIPT_EVENTS)[keyof typeof RECEIPT_EVENTS];

export type SmsEventAction =
  | { kind: 'receipt'; status: ReceiptStatus }
  | { kind: 'received' }
  | { kind: 'suppression' }
  | { kind: 'ignore' };

/** What an event type asks of us. Bird's list is open: an unknown type is ignored. */
export function smsEventAction(type: string): SmsEventAction {
  if (type in RECEIPT_EVENTS) {
    return { kind: 'receipt', status: RECEIPT_EVENTS[type as keyof typeof RECEIPT_EVENTS] };
  }
  if (type === 'sms.received') return { kind: 'received' };
  if (type === 'sms_suppression.created') return { kind: 'suppression' };
  return { kind: 'ignore' };
}

/** A delivered receipt means the handset has it; every other receipt means it does not. */
export const receiptDelivered = (status: ReceiptStatus): boolean => status === 'delivered';

/**
 * The stop words. Bird's own keyword handling creates a suppression for its
 * standard words; this catches a reply of STOP that reaches us as sms.received
 * too, in English and Arabic. The whole reply must be the word.
 */
const STOP_WORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'optout',
  'توقف',
  'إيقاف',
  'ايقاف',
  'الغاء',
  'إلغاء',
]);

export function isStopReply(text: string | null | undefined): boolean {
  if (!text) return false;
  const word = text
    .trim()
    .toLowerCase()
    .replace(/[\s.!،,-]+/g, '');
  return STOP_WORDS.has(word);
}

/** The fields this application reads from an event. Everything else is ignored, never stored. */
export interface ParsedSmsEvent {
  type: string;
  timestamp: Date | null;
  smsId: string | null;
  /** The sender of an inbound message, or the suppressed destination. Used to match, never stored. */
  phone: string | null;
  text: string | null;
  errorCode: string | null;
  suppressionId: string | null;
}

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

export function parseSmsEvent(raw: unknown): ParsedSmsEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as { type?: unknown; timestamp?: unknown; data?: unknown };
  const type = str(e.type, 64);
  if (!type) return null;
  const at = str(e.timestamp, 64);
  const parsed = at ? new Date(at) : null;
  const data = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
  const error = (data.error && typeof data.error === 'object' ? data.error : {}) as Record<
    string,
    unknown
  >;
  const action = smsEventAction(type);
  return {
    type,
    timestamp: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    smsId: str(data.sms_id),
    phone:
      action.kind === 'suppression'
        ? str(data.destination, 32)
        : action.kind === 'received'
          ? str(data.from, 32)
          : null,
    text: action.kind === 'received' ? str(data.text, 2000) : null,
    errorCode: str(error.code, 120),
    suppressionId: str(data.suppression_id),
  };
}

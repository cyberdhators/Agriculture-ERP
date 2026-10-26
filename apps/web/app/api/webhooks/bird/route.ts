import { ApiFailure, unauthenticated } from '../../../../lib/api/errors';
import { audited } from '../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { applyBirdEvent } from '../../../../lib/api/sms-receipts';
import { prisma } from '../../../../lib/db';
import { parseSmsEvent, verifyWebhook } from '../../../../lib/sms/bird-webhook';

/**
 * POST /api/webhooks/bird (2026-10-26) -- Bird's SMS events: carrier receipts
 * for announcement SMS, inbound replies, and opt-outs. docs/DECISIONS.md,
 * "SMS delivery receipts".
 *
 * `roles: 'public'` because the caller is Bird, not a person with a session
 * -- but it is NOT open. Every delivery must carry a valid Standard Webhooks
 * signature made with BIRD_WEBHOOK_SECRET (lib/sms/bird-webhook.ts: HMAC-
 * SHA256, constant-time, five-minute freshness), and the route FAILS CLOSED:
 * with no secret configured it answers 503 and applies nothing, so Bird keeps
 * the event and retries it later. A bad signature is 401 and changes nothing.
 *
 * Deduplicated by webhook-id and applied in one audited transaction
 * (lib/api/sms-receipts.ts). The body is read raw (the signature is over the
 * exact bytes) and capped at 64 KiB. The answer carries only an outcome word.
 * Nothing in the event -- a number, a text -- is stored or logged.
 */
const MAX_WEBHOOK_BYTES = 65_536;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    handler: async ({ request }) => {
      const secret = process.env.BIRD_WEBHOOK_SECRET ?? '';
      if (!secret) {
        throw new ApiFailure(503, 'webhook_not_configured', 'Webhooks are not accepted yet.');
      }
      const declared = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) throw unauthenticated();
      const body = await request.text();
      if (body.length > MAX_WEBHOOK_BYTES) throw unauthenticated();

      const headers = {
        id: request.headers.get('webhook-id'),
        timestamp: request.headers.get('webhook-timestamp'),
        signature: request.headers.get('webhook-signature'),
      };
      const verified = verifyWebhook(secret, headers, body);
      if (!verified.ok) throw unauthenticated();

      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        // Signed by Bird but unreadable: accepted and dropped, so it is not retried forever.
        return ok({ outcome: 'ignored' });
      }
      const event = parseSmsEvent(raw);
      if (!event) return ok({ outcome: 'ignored' });
      const outcome = await audited(prisma, (tx) =>
        applyBirdEvent(tx, headers.id as string, event),
      );
      return ok({ outcome });
    },
  },
});

import { sendCommunicationSchema, type CommunicationResult } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import {
  MailerNotConfiguredError,
  MailerUnavailableError,
  mailerConfig,
  sendOneEmail,
} from '../../../../lib/email/resend';
import { adminAuthEmails } from '../../../../lib/supabase/admin';

/**
 * POST /api/admin/communications — the administrator writes to staff.
 *
 * ADMINISTRATOR ONLY, enforced here and not by the screen.
 *
 * THE CLIENT SENDS RECORD IDS, NEVER ADDRESSES. This route resolves each id to
 * a person itself and reads the address from the authentication store. An
 * address supplied by a browser is never trusted, never accepted and never
 * looked at — which is also why `GET /api/users` does not return addresses and
 * must not start.
 *
 * EMAIL REACHES STAFF AND NOBODY ELSE. Neither the farmer nor the officer
 * table has an email column, and an officer's
 * `officer.<digits>@officers.invalid` sign-in identifier is not an address:
 * `.invalid` is reserved by RFC 2606 so that nothing can be delivered to it.
 * The shared schema refuses the combination before this route is reached; the
 * check below is the second lock, because the schema is validation and this is
 * authorization.
 *
 * NOTHING HERE REPORTS A DELIVERY THAT DID NOT HAPPEN. A missing key or sender
 * is 503 `email_not_configured`. An unreachable provider is 503. A refusal is
 * counted as a refusal. `accepted` is what Resend took, never what a person
 * received — delivery is a later event the provider reports separately.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: sendCommunicationSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // The second lock. The schema already refuses this pair; a route does not
      // rely on its own input being validated by someone else.
      if (body.channel !== 'email' || body.recipient_type !== 'staff') {
        throw new ApiFailure(
          422,
          'channel_unsupported',
          'Only email to staff accounts can be sent. Farmers and extension officers have no email address on file.',
        );
      }

      // Configuration first: a message must not be half-sent because the
      // sender was missing on the eleventh recipient.
      let config;
      try {
        config = mailerConfig();
      } catch (failure) {
        if (failure instanceof MailerNotConfiguredError) {
          throw new ApiFailure(
            503,
            'email_not_configured',
            'The email service is not configured on this deployment. Nothing was sent.',
          );
        }
        throw failure;
      }

      // Recipients are resolved from the ACTIVE view: a soft-deleted or
      // disabled account has no row there and is simply not reachable, which
      // is the same mechanism that ends its access everywhere else (C-3.6).
      const rows = await prisma.$queryRawUnsafe<{ id: string; auth_user_id: string }[]>(
        `SELECT id, auth_user_id FROM public.user_active WHERE id = ANY($1::uuid[])`,
        body.recipient_ids,
      );

      // An unknown or removed id is reported as unreachable rather than
      // refused: an administrator addressing eleven people should not lose the
      // message because one account was closed this morning.
      const addresses = await adminAuthEmails(rows.map((r) => r.auth_user_id));
      const deliverable = rows
        .map((r) => ({ id: r.id, address: addresses.get(r.auth_user_id) }))
        .filter((r): r is { id: string; address: string } => Boolean(r.address));

      const unreachable = body.recipient_ids.length - deliverable.length;

      let accepted = 0;
      let failed = 0;
      try {
        for (const recipient of deliverable) {
          const result = await sendOneEmail(
            config,
            recipient.address,
            body.subject ?? '',
            body.body,
          );
          if (result.accepted) accepted += 1;
          else failed += 1;
        }
      } catch (failure) {
        if (failure instanceof MailerUnavailableError) {
          // Record the attempt before reporting the outage: "we tried and the
          // provider was down" is exactly what an audit reader needs later.
          await audited(prisma, async (tx) =>
            writeAudit(tx, {
              entityType: 'communication',
              entityId: auth.principal.id,
              actorType: auth.role,
              actorId: auth.principal.id,
              action: 'communication.send_failed',
              after: {
                channel: 'email',
                recipient_type: 'staff',
                requested: body.recipient_ids.length,
                accepted,
                reason: 'provider_unavailable',
              },
            }),
          ).catch(() => undefined);
          throw new ApiFailure(
            503,
            'email_unavailable',
            'The email service could not be reached. Nothing further was sent.',
          );
        }
        throw failure;
      }

      const result: CommunicationResult = {
        id: auth.principal.id,
        channel: 'email',
        recipient_type: 'staff',
        requested: body.recipient_ids.length,
        accepted,
        unreachable,
        failed,
        sent_at: new Date().toISOString(),
      };

      /*
       * THE SEND IS AUDITED; THE MESSAGE IS NOT.
       *
       * C-4.6 and C-4.7 keep personal data out of audit rows, and a body is
       * free text an administrator wrote to a named person. The subject is
       * recorded because "what was this about" is the question an audit reader
       * asks; the body, the addresses and the key never appear.
       */
      const row = await audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: 'communication',
          entityId: auth.principal.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'communication.email_sent',
          after: {
            channel: 'email',
            recipient_type: 'staff',
            requested: result.requested,
            accepted: result.accepted,
            unreachable: result.unreachable,
            failed: result.failed,
            subject: body.subject ?? null,
          },
        });
        return result;
      });

      return ok(row);
    },
  },

  /**
   * GET — sent history. NOT IMPLEMENTED: no communication table exists, and
   * inventing one from audit rows would be a different thing wearing the same
   * name. The client treats this as "not connected" and the screen says so.
   */
});

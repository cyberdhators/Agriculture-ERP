import { createHash } from 'node:crypto';

import {
  sendCommunicationSchema,
  smsLength,
  type CommunicationResult,
  type SendCommunication,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure } from '../../../../lib/api/errors';
import { scopeClause } from '../../../../lib/api/farmers';
import type { Authenticated } from '../../../../lib/api/require-role';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import {
  MailerNotConfiguredError,
  MailerUnavailableError,
  mailerConfig,
  sendOneEmail,
} from '../../../../lib/email/resend';
import {
  SmsBatchInterruptedError,
  SmsNotConfiguredError,
  SmsUnavailableError,
  sendSmsBatch,
  smsConfig,
} from '../../../../lib/sms/bird';
import { adminAuthEmails } from '../../../../lib/supabase/admin';

/**
 * POST /api/admin/communications — the administrator writes to staff by email,
 * and to farmers and extension officers by SMS.
 *
 * ADMINISTRATOR ONLY, enforced here and not by the screen.
 *
 * THE CLIENT SENDS RECORD IDS, NEVER ADDRESSES OR PHONE NUMBERS. This route
 * resolves each id to a person itself and reads the address from the
 * authentication store, or the phone number from the farmer or officer row. A
 * contact supplied by a browser is never trusted, never accepted and never
 * looked at — which is also why `GET /api/users` and the SMS farmer picker do
 * not return them.
 *
 * EMAIL REACHES STAFF AND NOBODY ELSE. Neither the farmer nor the officer
 * table has an email column, and an officer's
 * `officer.<digits>@officers.invalid` sign-in identifier is not an address:
 * `.invalid` is reserved by RFC 2606 so that nothing can be delivered to it.
 * SMS reaches farmers and officers, and never a staff account. The shared
 * schema refuses the wrong combinations before this route is reached; the
 * check below is the second lock, because the schema is validation and this is
 * authorization.
 *
 * NOTHING HERE REPORTS A DELIVERY THAT DID NOT HAPPEN. A missing key or sender
 * is 503 `email_not_configured` / `sms_not_configured`. An unreachable provider
 * is 503 `email_unavailable` / `sms_unavailable`. A refusal is counted as a
 * refusal. `accepted` is what the provider took, never what a person received —
 * delivery is a later event the provider reports separately.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: sendCommunicationSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // The second lock. The schema already refuses these pairs; a route does
      // not rely on its own input being validated by someone else.
      if (body.channel === 'email' && body.recipient_type === 'staff') {
        return ok(await sendEmailToStaff(auth, body));
      }
      if (
        body.channel === 'sms' &&
        (body.recipient_type === 'farmer' || body.recipient_type === 'officer')
      ) {
        return ok(await sendSms(auth, body, body.recipient_type));
      }
      throw new ApiFailure(
        422,
        'channel_unsupported',
        'Email reaches staff accounts only, and SMS reaches farmers and extension officers only.',
      );
    },
  },

  /**
   * GET — sent history. NOT IMPLEMENTED: no communication table exists, and
   * inventing one from audit rows would be a different thing wearing the same
   * name. The client treats this as "not connected" and the screen says so.
   */
});

// ---------------------------------------------------------------------------
// Email to staff. Unchanged in behaviour since 2026-09-17.
// ---------------------------------------------------------------------------

async function sendEmailToStaff(
  auth: Authenticated,
  body: SendCommunication,
): Promise<CommunicationResult> {
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
      const result = await sendOneEmail(config, recipient.address, body.subject ?? '', body.body);
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
  return audited(prisma, async (tx) => {
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
}

// ---------------------------------------------------------------------------
// SMS to farmers and officers, through Bird. Added 2026-10-10.
// ---------------------------------------------------------------------------

/** The only destinations this route will message: a South Sudan mobile. */
const SOUTH_SUDAN_MOBILE = /^\+211\d{9}$/;

/** The audit key an SMS send is recorded under. */
const SMS_AUDIT_ACTION = 'communication.sms_sent';

/**
 * WOULD THE AUDIT ROW BE ACCEPTED? Asked BEFORE anything is sent.
 *
 * `communication.sms_sent` arrives with a migration that replaces the
 * `audit_event_action_known` CHECK. Migrations here are applied by hand, so a
 * deployment can run this code against a database that has not had it yet. In
 * that window the audit insert after a send would fail — AFTER the messages
 * had gone out and been billed — and the administrator would see an error for
 * a send that happened. Reading the constraint first turns that into a refusal
 * that costs nothing: no message leaves until the audit row is known to fit.
 *
 * A read of the catalogue, not a write: nothing is inserted to find out.
 */
async function smsAuditReady(): Promise<boolean> {
  const [row] = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'audit_event_action_known'
        AND conrelid = 'public.audit_event'::regclass`,
  );
  // No constraint at all means any key is accepted.
  return !row || row.def.includes(`'${SMS_AUDIT_ACTION}'`);
}

const notConfigured = (detail: string) =>
  new ApiFailure(503, 'sms_not_configured', `${detail} Nothing was sent.`);

/**
 * Resolves record ids to phone numbers, on the server, from the ACTIVE views.
 *
 * A farmer is reachable only with consent that was granted and has not been
 * withdrawn. An officer is reachable only while active. A number that is not a
 * South Sudan mobile is not messaged: a wrong digit would reach a stranger
 * abroad, at an international rate.
 */
async function resolvePhones(
  auth: Authenticated,
  type: 'farmer' | 'officer',
  ids: readonly string[],
): Promise<{ id: string; phone: string }[]> {
  if (type === 'farmer') {
    const params: unknown[] = [ids];
    const where = [
      'f.id = ANY($1::uuid[])',
      'c.granted = true',
      'c.withdrawn_at IS NULL',
      ...scopeClause(auth, params),
    ];
    return prisma.$queryRawUnsafe<{ id: string; phone: string }[]>(
      `SELECT f.id, f.phone FROM public.farmer_active f
         JOIN public.consent c ON c.id = f.consent_id
        WHERE ${where.join(' AND ')}`,
      ...params,
    );
  }
  return prisma.$queryRawUnsafe<{ id: string; phone: string }[]>(
    `SELECT id, phone FROM public.officer_active
      WHERE id = ANY($1::uuid[]) AND status = 'active'`,
    ids,
  );
}

async function sendSms(
  auth: Authenticated,
  body: SendCommunication,
  recipientType: 'farmer' | 'officer',
): Promise<CommunicationResult> {
  // Configuration first, and the audit second: both are refusals that cost
  // nothing, and both must happen before the first message is billed.
  let config;
  try {
    config = smsConfig();
  } catch (failure) {
    if (failure instanceof SmsNotConfiguredError) {
      throw notConfigured('The SMS service is not configured on this deployment.');
    }
    throw failure;
  }
  if (!(await smsAuditReady())) {
    throw notConfigured(
      'SMS is waiting for a database update on this deployment, so a send could not be recorded.',
    );
  }

  // One id once, however many times the browser listed it.
  const ids = [...new Set(body.recipient_ids)].sort();
  const rows = await resolvePhones(auth, recipientType, ids);

  // One number once: two records sharing a phone (a suspected duplicate, a
  // household) receive one message, not two bills for the same handset.
  const idsByPhone = new Map<string, string[]>();
  for (const row of rows) {
    if (!SOUTH_SUDAN_MOBILE.test(row.phone)) continue;
    const list = idsByPhone.get(row.phone) ?? [];
    list.push(row.id);
    idsByPhone.set(row.phone, list);
  }
  const reachableIds = [...idsByPhone.values()].reduce((n, list) => n + list.length, 0);
  const unreachable = ids.length - reachableIds;

  const length = smsLength(body.body);
  // Facts about the send that an audit reader needs and that identify nobody.
  // The ids are record ids, never contact details; the hash lets two rows be
  // compared without reading five hundred ids.
  const recorded = {
    channel: 'sms',
    recipient_type: recipientType,
    requested: ids.length,
    recipient_ids: ids,
    recipient_ids_sha256: createHash('sha256').update(ids.join(',')).digest('hex'),
    sender_id: config.senderId,
    encoding: length.encoding,
    segments: length.segments,
  };

  const countIds = (phones: readonly string[]) =>
    phones.reduce((n, phone) => n + (idsByPhone.get(phone)?.length ?? 0), 0);

  let accepted = 0;
  let failed = 0;
  try {
    const outcome = await sendSmsBatch(config, [...idsByPhone.keys()], body.body);
    accepted = countIds(outcome.accepted);
    failed = countIds(outcome.refused);
  } catch (failure) {
    if (failure instanceof SmsUnavailableError) {
      const partial = failure instanceof SmsBatchInterruptedError;
      await audited(prisma, async (tx) =>
        writeAudit(tx, {
          entityType: 'communication',
          entityId: auth.principal.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'communication.send_failed',
          after: {
            ...recorded,
            // Phones, not ids, here: the batch counts messages. Stated as such.
            messages_accepted: partial ? failure.accepted : 0,
            messages_refused: partial ? failure.refused : 0,
            unreachable,
            reason: 'provider_unavailable',
          },
        }),
      ).catch(() => undefined);
      throw new ApiFailure(
        503,
        'sms_unavailable',
        partial && failure.accepted > 0
          ? `The SMS service stopped answering part-way. ${failure.accepted} messages had already been accepted; nothing further was sent.`
          : 'The SMS service could not be reached. Nothing was sent.',
      );
    }
    throw failure;
  }

  const result: CommunicationResult = {
    id: auth.principal.id,
    channel: 'sms',
    recipient_type: recipientType,
    requested: ids.length,
    accepted,
    unreachable,
    failed,
    sent_at: new Date().toISOString(),
  };

  /*
   * THE SEND IS AUDITED; THE MESSAGE AND THE NUMBERS ARE NOT.
   *
   * An SMS has no subject, and its body is free text written to named people,
   * so neither it nor any phone number enters the row (C-4.6, C-4.7). What is
   * recorded is who sent, to which records, how long it was in billed
   * segments, and what the provider accepted and refused.
   */
  return audited(prisma, async (tx) => {
    await writeAudit(tx, {
      entityType: 'communication',
      entityId: auth.principal.id,
      actorType: auth.role,
      actorId: auth.principal.id,
      action: SMS_AUDIT_ACTION,
      after: { ...recorded, accepted, unreachable, failed },
    });
    return result;
  });
}

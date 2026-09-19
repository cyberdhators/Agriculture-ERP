# The administrator communications contract — proposed before the routes exist

**For whoever builds the backend, from Lane 1.** Written 17 September 2026,
after the developers approved the capability as a scope addition. The
administrator composer at `/communications` is built against this exactly;
build the routes to it, or say in `docs/HANDOFF.md` what is wrong with it
first.

**STATUS, 17 September 2026 — partly implemented.**

| Piece                                     | Status                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/communications`          | **IMPLEMENTED.** Administrator only, recipients resolved server-side, audited.                                                      |
| Resend integration                        | **IMPLEMENTED**, over the REST API with `fetch` — no SDK, no new dependency.                                                        |
| `RESEND_API_KEY` / `EMAIL_FROM`           | **NOT SET.** Both are in `.env.example`; until they are set the route answers 503 `email_not_configured` and sends nothing.         |
| `GET /api/admin/communications` (history) | **NOT IMPLEMENTED.** No communications table exists; building one from audit rows would be a different thing wearing the same name. |
| SMS                                       | **NOT IMPLEMENTED.** See section 3.                                                                                                 |

Nothing reports a delivery that did not happen: a missing key is 503, an
unreachable provider is 503, a refusal is counted as a refusal.

---

## 0. The fact that shapes everything

**Email can reach staff, and nobody else.**

| Who               | Contact on file                  | Evidence                                                |
| ----------------- | -------------------------------- | ------------------------------------------------------- |
| Staff             | **Email** — they sign in with it | `createUserSchema` in `packages/shared/src/identity.ts` |
| Extension officer | **Phone only**                   | `model Officer` has `phone`, no email                   |
| Farmer            | **Phone only**                   | `model Farmer` has `phone`, no email                    |

An officer's authentication identifier is `officer.<digits>@officers.invalid`.
**That is not an address.** `.invalid` is reserved by RFC 2606 so that nothing
can ever be delivered to it, and `docs/DECISIONS.md` records that it is never
displayed. **It must never be used as a recipient, converted into one, or
merged with a future contact column.**

`CHANNEL_RECIPIENTS` in `packages/shared/src/communications.ts` is the single
place this lives. If the owner adds an optional email column to either table,
change it there and every screen follows.

---

## 1. `POST /api/admin/communications` — send — IMPLEMENTED

**Administrator only.** `roles: ['admin']`, through the standard wrapper.

Body — `sendCommunicationSchema`, already written and exported:

```json
{
  "channel": "email",
  "recipient_type": "staff",
  "recipient_ids": ["11111111-2222-4333-8444-555555555555"],
  "subject": "Quarterly briefing",
  "body": "Please read the attached figures."
}
```

- `channel`: `email` or `sms`.
- `recipient_type`: must be allowed for the channel, or 400 on
  `recipient_type`.
- `recipient_ids`: **record ids, never addresses.** 1 to 500.
- `subject`: required for email, refused for SMS. ≤ 200 characters.
- `body`: required. ≤ 5000 characters.

**Recipients are ids on purpose.** The server resolves each to a contact
itself, so no browser holds a list of people's addresses, an address cannot be
substituted in flight, and a recipient outside the caller's scope is refused by
scope rather than by the client's good manners. This is also why
`GET /api/users` does not return email addresses and should not start.

### Response

```json
{
  "data": {
    "id": "…",
    "channel": "email",
    "recipient_type": "staff",
    "requested": 5,
    "accepted": 4,
    "unreachable": 1,
    "failed": 0,
    "sent_at": "2026-09-17T09:12:00.000Z"
  }
}
```

**`accepted` is what the provider took, not what a person received.** Delivery
is a later event the provider reports separately. The screen says "accepted by
the provider" and must never be made to say "delivered".

**`unreachable`** counts recipients with no contact on file — a staff account
without an email, a farmer without a phone. Reported, never silently dropped.

### Errors

Use the existing taxonomy in `docs/api/CONVENTIONS.md`. Specifically:

- **A provider outage is 503, not 401.** It must never redirect to sign-in;
  that is the `auth_unavailable` rule from B6.5 applied to a second service.
- A partial failure is a 200 with the real counts, not an error.

### Audit

One `audit_event` row per send, in the same transaction as the record of the
send. Proposed action keys: `communication.email_sent`,
`communication.sms_sent`.

Carry: actor, channel, recipient **count**, recipient type, subject, timestamp,
provider request status.

**Do not put the message body in the audit log.** C-4.6 and C-4.7 keep personal
data out of audit rows, and a body is free text about or to a named person. If
bodies must be retained, they belong in a communications table with their own
retention rule — a decision the owner has not yet taken.

**Never log** the provider key, an authorization header, or a recipient's
address.

---

## 2. `GET /api/admin/communications` — history — NOT IMPLEMENTED

**Administrator only.** Cursor-paged on `(sent_at, id)` descending, per
CONVENTIONS §6. Returns the same result shape as the send.

**No history is fabricated while this is absent**: the client raises
`ServiceNotConnectedError` and the screen says so.

---

## 3. SMS — a larger unit, not a variation

Bird is the decided provider (`BIRD_API_KEY`, `BIRD_API_BASE_URL`,
`BIRD_SMS_SENDER_ID` are in `.env.example`; nothing is written). Before an SMS
send is offered the screen needs:

- **cost visible before sending.** SMS bills per message and per segment, and
  an administrator selecting a payam is committing real money.
- **encoding and segment count visible.** A non-Latin script occupies fewer
  characters per segment, so one message may be charged as two or three — the
  open Arabi Juba script question in the scope document bears directly on this.
- a delivery result that distinguishes accepted from delivered.

Until those exist the SMS tab shows an explicit unavailable state and offers no
send. That is deliberate: an SMS send with no cost shown is a bill nobody
approved.

---

## 4. Provider

Resend, per `CLAUDE.md` §3 — recorded there as _a preference, not a fix_.
**Not installed.** When it is:

- `RESEND_API_KEY` server-side only, in `.env.example` by name, never in code;
- the browser never calls the provider and never holds the key;
- the sender domain and its DNS authorisation records are CORWADO's, and the
  account is created in CORWADO's name — never ours.

# Proposed scope amendment: administrator communications, and marketplace product reporting

_For CORWADO and the owner, from Monkon-Claude / Lane 1, 17 September 2026.
Prepared from the tree and the record, not from memory. Every claim about the
current implementation below was checked against the code on the date above and
carries its file reference._

**Nothing here is built.** No application code, schema, route, dependency or
navigation entry was changed to produce this page. Both capabilities were
requested for the administrator portal; both are outside
`docs/scope-and-acceptance.md`, and `CLAUDE.md` §2 says that is a decision for
the owner rather than for a session. This is that decision, written down with
what it would cost.

---

## The position in one paragraph

Two capabilities were asked for: an administrator sending messages from the
portal, and an administrator seeing marketplace products that users have
reported. **Neither is in the contracted scope, and neither has a backend.** The
first is also blocked by something no amount of frontend work can solve: two of
the three requested recipient groups have no email address, and one of them
never can. The second depends on a marketplace backend that does not exist yet
and is already queued behind an unanswered contract. Both are buildable; both
need the owner to decide what they are before anyone writes code.

---

# Part A — Administrator communications

## A0. What the code actually shows today

| Claim                                                              | Evidence                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff accounts have a real email address                           | `createUserSchema` requires `email`; it is how staff sign in — `packages/shared/src/identity.ts`                                                                          |
| **Farmers have no email column**                                   | `model Farmer` carries `phone` and no email — `prisma/schema.prisma`                                                                                                      |
| **Extension officers have no email column**                        | `model Officer` carries `phone` and no email — `prisma/schema.prisma`                                                                                                     |
| The only `email` column in the schema belongs to a directory entry | `model DirectoryEntry.email String?`, which is C-13.1's "optional email" — `prisma/schema.prisma`                                                                         |
| No email provider is wired                                         | No `RESEND_API_KEY` in `.env.example`, no email library, no send route anywhere under `apps/web/app/api`                                                                  |
| SMS is configured but not implemented                              | `BIRD_API_KEY`, `BIRD_API_BASE_URL`, `BIRD_SMS_SENDER_ID` exist in `.env.example`; there is no SMS library and no send route                                              |
| The scope document contains no communications deliverable          | No admin email or messaging criterion in `docs/scope-and-acceptance.md`; the marketplace amendment says "no buyer login, no self-registration, **no email verification**" |

## A1. The officer identifier is not an email address, and must never become one

An officer authenticates with a phone number and a password (C-3.7). Because
Supabase's Phone provider is disabled on this project, the phone is turned into
an authentication identifier by one function:

```
officer.<digits>@officers.invalid        packages/shared/src/identity.ts
```

`.invalid` is **reserved permanently by RFC 2606**. No mail can ever be
delivered to it, and no future owner can register the domain. The code states
the rule beside the function: the identifier is _"NEVER typed by a human, NEVER
displayed, NEVER in an error message. It is an authentication detail, not an
address, and it is not a field of the officer."_ `docs/DECISIONS.md` records the
same decision, amended in place on the day the staff login form was added.

**This is the hard blocker.** "Email the extension officers" cannot be satisfied
by the data that exists. Attempting it would either send every message into a
black hole that by design can never receive mail, or surface an identifier the
project has twice decided must never be shown. Neither is acceptable, and no
frontend can fix it.

## A2. Proposed — email to staff (the one channel that is possible now)

**PROPOSED, not agreed.** An administrator composes an email to one or more
staff accounts and sends it from the portal.

- **Recipients.** Staff accounts only, chosen from `GET /api/users`, which
  already pages by cursor. A recipient is shown as name, role and email
  address. No national ID, no phone, no farmer data appears in the picker.
- **Validation.** A staff account without a usable email cannot be selected;
  the count of such accounts is stated before sending rather than hidden.
- **Composer.** Subject required, with a proposed maximum of 200 characters.
  Message required, with a proposed maximum of 5,000 characters. Live counts,
  as the rejection note already has.
- **Confirmation.** The recipient count, the subject and a preview of the
  message are shown before anything is sent. No one-click send.
- **Authorization.** Administrator only, enforced by `requireRole` on the
  server. The browser is never the boundary, and never holds the provider key.
- **Result.** The server's actual outcome is reported. A partial failure is
  reported as a partial failure, naming how many were accepted. Success is
  never claimed before the provider confirms it, and a failed send leaves the
  composed message intact so the administrator does not lose the work.
- **Provider failure is not a session failure.** An unreachable provider shows
  a service error and never redirects to sign-in, consistent with the existing
  `auth_unavailable` rule (B6.5).

### Audit — PROPOSED

One `audit_event` row per send, in the same transaction as the record of the
send, carrying: actor, recipient **count**, recipient type, subject, timestamp
and the provider's request status.

**The message body is not proposed for the audit log.** C-4.6 and C-4.7 keep
passwords and personal data out of audit rows, and a message body is free text
an administrator wrote about or to a named person. If the owner wants bodies
retained, that is a separate decision with its own retention question, and it
belongs in a communications table rather than in the append-only audit log.

### Dependency — PROPOSED, not installed

`CLAUDE.md` §3 already names **Resend** as the email choice, recorded in
`docs/DECISIONS.md` as _a preference, not a fix_ — SendGrid worked; Resend was
chosen for a better free tier and less setup. **It is a decision on paper only:
nothing is installed and no key exists.** Installing it and creating an account
in CORWADO's name is a §5 stop-and-ask in its own right, which is why this page
proposes rather than performs it.

## A3. Proposed — reaching farmers and officers

The contracted channel for reaching a farmer is **SMS**, deliverable (n). That
is why the stack table records Africa's Talking being replaced by Bird as _a
correction rather than a preference_ — Africa's Talking does not serve South
Sudan at all, so the original choice could not have delivered (n) to a farmer
here.

If the owner wants administrators to reach farmers or officers from the portal
now, the honest proposal is **an SMS composer, not an email one**. It would
need, none of which exists today:

- the Bird integration itself — configured in `.env.example`, never written;
- a recipient selector over farmers or officers, server-paged;
- **cost visibility before sending**, because SMS is billed per message and per
  segment, and an administrator selecting a payam is committing real money;
- encoding and length behaviour made visible, since a non-Latin script occupies
  fewer characters per segment and one message may be charged as two or three —
  the scope document already flags this under the open Arabi Juba script
  question;
- a send result that distinguishes accepted from delivered;
- logging and audit on the same terms as A2;
- administrator-only authorization.

**This is a larger unit than the staff email**, and it touches a paid service
per message rather than per month.

## A4. The data-model question — for the owner, not for a session

Should `Farmer` and `Officer` gain an optional email column?

**I am not deciding this.** The consequences, so the decision is informed:

- **Migration.** Additive and cheap: a nullable column on each table, a Prisma
  migration, no data loss.
- **Validation.** One shared Zod schema, as every other field has.
- **Capture.** Registration and the account forms grow a field, and an officer
  in a field with a phone gains one more thing to type. A farmer's email would
  most often be empty, which means any "email the farmers" feature would in
  practice reach a small and unrepresentative subset — worth knowing before
  building a screen that implies otherwise.
- **Privacy.** An email address is personal data and falls under the same rules
  as a phone number: never in a URL, an error, an export or an audit row.
- **Account versus contact.** This is the important one. **An officer's
  `.invalid` authentication identifier must never be converted into, merged
  with, or displayed as this new contact field.** They are different things: one
  is how the system recognises a person, the other is how a person is reached.
  If the column is added, the rule that the identifier is never displayed stays
  exactly as it is.

---

# Part B — Marketplace product reporting

## B0. What the code actually shows today

| Claim                                                        | Evidence                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **There is no marketplace backend**                          | No `produce_listing` table in any migration; no market or listings route under `apps/web/app/api`                                                             |
| Marketplace screens run on placeholder data                  | Listings are read from `apps/web/lib/fixtures`                                                                                                                |
| **Existing "moderation" is browser-local**                   | `apps/web/components/market/moderation.tsx` writes withdrawal overrides to `window.sessionStorage` — it survives neither a different browser nor a colleague  |
| There is no report or flag model                             | No such table; the only `ReportExport` model is the agricultural export log                                                                                   |
| There is no notification infrastructure                      | No notification table, no unread mechanism, no badge source                                                                                                   |
| The scope document contains no product-reporting deliverable | No report, flag or moderation criterion in `docs/scope-and-acceptance.md`                                                                                     |
| The listings backend is already queued and blocked           | `docs/HANDOFF.md`: `produce_listing` and the contact-request routes are owed by Lane 1, pending the owner's answers on `docs/api/contact-request-contract.md` |

## B1. The dependency chain, in order

Nothing later can be built before everything earlier exists.

1. **Listing model and migration** — the thing a report is about.
2. **Listing API** — read and write, scoped and audited.
3. **Report submission** — how a marketplace visitor reports a listing. Note
   that buyers hold no account (DECISIONS, 2026-09-09), so this is a second
   unauthenticated write, with the same rate-limiting and abuse questions the
   contact-request contract already raises and which are still unanswered.
4. **Persistent report model** — B2 below.
5. **Admin report queue** — a screen, cursor-paged like every other list.
6. **Report detail** — one report, with its listing.
7. **Unread mechanism** — B4 below.
8. **Moderation actions** — B5 below, each needing a real state transition.
9. **Audit** — one row per moderation act, in the same transaction.

**Items 1 to 3 are a unit of work before any administrator screen is possible.**

## B2. Proposed report entity — PROPOSED, fields not final

```
report_id        uuid, primary key
listing_id       uuid, references the listing
reporter_ref     PROPOSED — see the privacy note below
reason           enum, B3
description      optional free text, proposed maximum 500 characters
status           enum, B4
created_at       timestamptz
updated_at       timestamptz
resolved_by      uuid, references user, null until resolved
resolved_at      timestamptz, null until resolved
deleted_at       soft deletion, as every table in this system has
```

**`reporter_ref` is the field needing the most thought.** A reporter has no
account. Storing a phone number or a name makes a report personal data about the
reporter as well as about the listing, with everything that follows. The
alternatives — storing nothing, or storing an opaque submission token — are
cheaper and may be sufficient. **Not proposed as decided.**

## B3. Proposed reason codes — PROPOSED, awaiting approval

`prohibited content` · `misleading listing` · `counterfeit or fraud` ·
`inappropriate content` · `duplicate or spam` · `other`

These follow the pattern the rejection reasons already use: a fixed code carries
the meaning, and an optional note carries the detail. **They are a starting
point for CORWADO to correct, not a list to implement.** The codes that matter
in a South Sudan produce marketplace may not be the codes that matter elsewhere.

## B4. Proposed status and the unread indicator

Proposed statuses: `new` · `reviewing` · `resolved` · `dismissed`. **Proposed,
not final** — if CORWADO's moderation practice has fewer states, fewer is
better.

The owner specifically wants an administrator to know when a product has been
reported. The proposal is a **server-derived count** on the navigation entry:

```
Product Reports [3]
```

**The count must come from the database** — a count of reports in the `new`
state within the caller's scope, served by a route. Explicitly **not** proposed:
`sessionStorage`, `localStorage`, a browser-only counter, or a number derived
from whatever page happens to be loaded. The redesigned portal already refuses
to show a figure it cannot source, and a badge is a figure.

A full notification centre is **not** proposed. There is no notification
infrastructure, one badge answers the stated need, and `CLAUDE.md` §2 lists a
notifications module among the things not in scope.

## B5. Proposed moderation actions — candidates only

`mark reviewing` · `resolve` · `dismiss` · `remove listing` · `suspend listing`

Each requires a backend state transition and its own authorization; none exists.
**Removal would be soft**, as every removal in this system is — the deletion law
in `CLAUDE.md` §4 admits no exception, and no screen should offer words
suggesting otherwise.

## B6. Naming

The administrator portal already has a **Reports** module: agricultural
reporting and exports, deliverable (t). A marketplace moderation queue must not
be called the same thing. **Product Reports** is proposed as the navigation
label, kept clearly separate from Reports in both wording and placement.

---

# Part C — What exists, and what is missing

| Piece                          | Communications                                                   | Marketplace reporting                    |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| Data for recipients / subjects | **Partly** — staff have email; farmers and officers do not       | **Missing** — no listing model           |
| Provider or submission path    | **Missing** — Resend decided on paper, never installed           | **Missing** — no report submission route |
| Server route                   | **Missing**                                                      | **Missing**                              |
| Authorization pattern          | **Exists** — `requireRole`, reusable unchanged                   | **Exists** — reusable unchanged          |
| Audit mechanism                | **Exists** — `audited()` / `writeAudit()`, needs new action keys | **Exists** — same                        |
| Cursor pagination              | **Exists** — reusable                                            | **Exists** — reusable                    |
| Admin UI patterns              | **Exists** — the kit, dialogs, confirmations, live regions       | **Exists** — same                        |
| Unread/notification source     | Not applicable                                                   | **Missing** — no table, no route         |

The encouraging half: **every cross-cutting mechanism these features need
already exists and is tested** — authorization, audit in the same transaction,
cursor pagination, confirmation dialogs, the design system. What is missing is
domain data and provider integration, which is the part that needs the owner's
decision rather than a session's judgement.

---

# Part D — Decisions needed before any of this is built

1. **Should administrators email staff only** — the only group that can receive
   email today — or is farmer and officer email a goal for a later phase?
2. **If farmers and officers must be reachable now, is the channel SMS rather
   than email?** Deliverable (n) and the Bird decision both point that way.
3. **Should `Farmer` gain an optional email column?** (A4.)
4. **Should `Officer` gain an optional email column**, separate from and never
   merged with the `.invalid` authentication identifier? (A4.)
5. **Is Resend approved as the provider**, and may an account be created in
   CORWADO's name? No key exists today.
6. **What sender address and domain should outbound email use**, and who owns
   the DNS records that authorise it?
7. **Is marketplace product reporting in this project's scope at all**, or a
   separate workstream after the contracted twenty deliverables?
8. **Which report reasons matter to CORWADO?** (B3 is a starting point.)
9. **Which moderation actions should an administrator have**, and is suspension
   distinct from removal in CORWADO's practice?
10. **Is a `Product Reports [N]` badge sufficient**, or is a broader
    notification centre wanted — noting that §2 currently excludes one?
11. **Should the listing model and report submission be built in this project**,
    and if so, where do they sit against the remaining contracted work?

**A twelfth, which is the owner's to weigh rather than mine.** Both capabilities
are additions to a fixed scope of twenty contracted deliverables. If they are
approved, the criteria belong in `docs/scope-and-acceptance.md` with IDs before
any code is written — the same sequence Lane 2's own audit (#82) asked for, and
the sequence the 15 September position paper was about.

---

## Status

**Proposed. Not agreed. Nothing implemented.** No application code, Prisma
schema, API route, dependency or navigation entry was changed to produce this
document. Approval of any part should be recorded in `docs/DECISIONS.md` with
its grounds, and any approved capability written into
`docs/scope-and-acceptance.md` as numbered criteria before implementation
begins.

— Monkon-Claude, Lane 1

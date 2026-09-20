# PROJECT STATE

**Read this at the start of every session, after `CLAUDE.md`.** It holds what is
true now and must be acted on. It is kept under two pages so that it keeps being
read.

`CLAUDE.md` is the law. This is the running state. **`docs/DECISIONS.md` is why**
— read it when this file says _what_ and you need the reasoning, or before
undoing something. **`docs/UNITS.md`** defines the unit numbers used below.

---

## CREDENTIALS

**Claude may hold STAGING credentials.** They live in `.env.local` at the
repository root, which is git-ignored. Claude may read them, run database
commands against staging, and report what those returned.

**Claude never holds production credentials.** They live only in Vercel and
GitHub secrets — never in `.env.local`, never pasted into a session, never
committed. **If anything from production is needed, Claude stops and asks.**

**THE ACCESS TOKEN IS REVOKED. CLOSED, not outstanding.** The account-wide
Supabase personal access token pasted into a chat session has been revoked — the
Access Tokens page shows none on the account (account holder, 2026-09-03).

**It never entered the repository.** Verified three ways on 2026-09-03: no
commit under those paths on any branch; no `.txt` file ever added; the `sbp_`
pattern appears **zero** times in the content of every commit on every branch.
Structurally it could not have — both files lived in `~/Documents/`, the parent
of the repository root. Both are deleted.

**A chat exposure and a repository exposure need different responses.** Why that
distinction is worth keeping is in `docs/DECISIONS.md`.

**THERE IS ONE SUPABASE PROJECT, AND IT IS STAGING.** Reference
`xmmxbrxmfgodhpwolrvk`, named **`agri-staging`**. It is what `.env.local` points
at, what `.mcp.json` attaches to, what `scripts/db-reset.mjs` accepts, and what
every migration has been applied to. The reference is not a secret; the
connection strings containing it are.

**There is no production project yet.** It is created new at B11 — deliberately
not this one, which has held developer credentials on a laptop and carries a
throwaway `_smoke` table in its migration history. Reasoning in
`docs/DECISIONS.md`.

**Resolved 2026-09-03**, all three, so none of it is outstanding: the project was
renamed from `agri-production`, its database password was rotated, and the
account-wide access token was revoked. **`pnpm db:reset` is safe to run again** —
the naming mismatch that made it dangerous is gone.

**Production is empty until B11** and now means what it says: no real farmer data
exists anywhere, and none enters production until the backup and restore unit is
done and the restore drill has run successfully.

**OPEN — Supabase plan and point-in-time recovery.** Not yet recorded: the plan
CORWADO's projects are on, and whether point-in-time recovery is included. B11
cannot be planned without it, and if PITR is absent this is an **open cost
question for CORWADO**, not a solved fact. Read it from the dashboard and record
it here.

---

## ENVIRONMENT VARIABLES

Names only. Values live in `.env.local` locally and in Vercel and GitHub secrets
for deployments.

**The sentence that stood here said "All are listed in `.env.example`." It was
false.** Seven required names were absent from that file until this was found on
2026-09-13 — see _Seven variables the code requires and nothing declares_ below.

| Name                     | Used by                                                       | For                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Prisma at runtime                                             | Pooled connection, port 6543, `pgbouncer=true`, `connection_limit=1`.                                                                                                                                                                                                                        |
| `DIRECT_URL`             | `prisma/schema.prisma`, `scripts/db-reset.mjs`                | **Session pooler**, port 5432 — NOT the direct host, which is IPv6-only. Migrations, introspection, operational scripts and database tests.                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN` | `apps/web/sentry.shared.ts`                                   | Where errors go. **Public by design** — see `docs/DECISIONS.md`. Empty switches reporting off. **Lives in Vercel's environment variables, not on any laptop** — see _The DSN and local machines_ below.                                                                                      |
| `SENTRY_ENVIRONMENT`     | same                                                          | **Set explicitly in Vercel: `staging` for preview deployments, `production` for production.** Decided 2026-09-04. The code falls back to `VERCEL_ENV`, then `development`, but the fallback must never be what produces the value — `VERCEL_ENV` says `preview`, which is not a name we use. |
| `SENTRY_RELEASE`         | same                                                          | Which build. Falls back to `VERCEL_GIT_COMMIT_SHA`, then `unknown`.                                                                                                                                                                                                                          |
| `BIRD_API_KEY`           | `scripts/bird-sms-verify.mjs`                                 | **Secret.** Bearer token for the Bird SMS API; it can send messages CORWADO pays for. Never `NEXT_PUBLIC_`.                                                                                                                                                                                  |
| `BIRD_API_BASE_URL`      | same                                                          | The workspace's regional host, e.g. `https://us1.platform.bird.com`. Region is part of the URL and differs per workspace.                                                                                                                                                                    |
| `BIRD_SMS_SENDER_ID`     | same                                                          | The alphanumeric sender, 3-11 chars, at least one letter. The ONLY sender type Bird offers for +211.                                                                                                                                                                                         |
| `OPENWEATHER_API_KEY`    | `scripts/weather-fetch.mjs`, `scripts/openweather-verify.mjs` | **Secret, server-only.** Read by the fetch job and the verify script only; no route fetches weather (C-16.6), so it never nears a browser. A fresh key returns 401 for up to two hours.                                                                                                      |

### Seven variables the code requires and nothing declares (found 2026-09-13)

`.env.example` listed five names. The code reads twelve. The seven it never
mentioned, and what each costs when it is absent:

| Name                                | Read by                                            | When it is unset                                       |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`          | `lib/api/require-role.ts`, `lib/supabase/admin.ts` | **every route throws** before it reads anything        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | `lib/api/require-role.ts`                          | **every route throws**                                 |
| `SUPABASE_SERVICE_ROLE_KEY`         | `lib/supabase/admin.ts`                            | account and Storage operations throw                   |
| `NEXT_PUBLIC_USE_LIVE_ADMIN`        | `lib/admin/api.ts`                                 | the administration screens read fixtures               |
| `NEXT_PUBLIC_USE_LIVE_FARMERS`      | `lib/farmers/api.ts`                               | the farmer screens read fixtures                       |
| `NEXT_PUBLIC_USE_LIVE_VERIFICATION` | `lib/farmers/verification.ts`                      | the verification screens read fixtures                 |
| `LOCATIONS_CSV`                     | `scripts/locations-lib.mjs`                        | falls back to a committed path (the only harmless one) |

**The sharpest part, and why this is a silent-class instance rather than an
oversight.** `tests/helpers/db.ts` refuses to run the database tests unless five
variables are set, and its refusal message tells the reader what to do:
_"Locally: copy .env.example to .env.local and fill in the staging values."_
**Three of the five it demands were not in that file.** An instruction pointing
at a file that cannot satisfy it is worse than no instruction: the reader
follows it, fills in everything the file offers, and the tests still refuse —
with a message naming the file as the answer.

**Why neither side hit it.** CI holds all five as `STAGING_*` repository
secrets, so CI passes. Lane 1's machine has the three Supabase names because B3
needed them before the example file existed. Lane 2's machine never had them and
nothing in the repository said they existed. Invisible from both sides at once,
which is the same shape as the tenth instance below.

**The three flags are `NEXT_PUBLIC_`, so Next inlines them at build time.**
Turning one on is a rebuild and a redeploy, not a settings change. Anyone
expecting to flip live data on in a dashboard will conclude it does not work.

**CLOSED, AND QUICKLY — six of the seven by the other lane within hours.**
#67, the auth bridge, added the two `NEXT_PUBLIC_SUPABASE_*` names, the service
key and the three `USE_LIVE` flags, having hit the same wall from the other
side. #70 added the seventh, `LOCATIONS_CSV`. **Every variable the code reads is
now declared: twelve of twelve**, checked by comparing the names in
`.env.example` against every `process.env.*` read in `apps/web`, `packages`,
`scripts`, `tests` and `prisma`.

**Worth keeping for what it says about the finding rather than the fix.** Two
lanes hit one undeclared-variable wall within a day of each other, from
opposite sides, and neither could see the other's version of it. The record is
what made them the same problem instead of two.

---

## PAID EXTERNAL SERVICES — SMS NOW EXISTS, THE OTHER TWO ARE DEFERRED

**OpenWeather (I-03) and Mapbox** are deferred until CORWADO provides accounts.
All third-party accounts are held in CORWADO's name — `CLAUDE.md` §3 — so none
can be created by this team.

**SMS (I-02) is no longer deferred: an account exists, with Bird.** The provider
changed on 2026-09-14, approved by the owner, and `CLAUDE.md` §3 now names Bird.
The grounds are in `docs/DECISIONS.md`, and the short version is that **Africa's
Talking does not serve South Sudan at all** — its own help centre lists eleven
countries and South Sudan is not among them — so the original stack choice could
not have delivered deliverable (n) to a South Sudanese farmer.

**What is known, from Bird's own pages (2026-09-14):** South Sudan is a listed
destination at **$0.21 per segment** for an alphanumeric sender; that is the
only sender type offered for +211 — no local number, no shortcode — and it needs
no registration. Segments are 160 GSM-7 characters, or **70 in Arabic script**,
so the same advisory in Arabic script costs about three times as much. Neighbours
price similarly (Sudan $0.32, Kenya $0.25, Uganda $0.2535), so this is the region
and not the vendor.

**What is NOT known, and blocks calling I-02 satisfied:**

- **Which South Sudanese networks actually deliver.** Bird names no operator
  anywhere — not MTN, not Zain, not Digitel. Country coverage is documented;
  per-network delivery is not. `pnpm sms:verify` closes this, **once per
  network**: one message to one number proves one operator.
- **Whether a purchased number is any use.** The account was bought while the
  dashboard was on GB inventory. A GB number cannot be the sender for +211, and
  the sender that works costs nothing to acquire.
- **Carrier fees for South Sudan.** Bird says they apply on top and vary by
  destination; South Sudan appears in no fee table. Treat $0.21 as a floor.
- **Whether South Sudan's NCA requires sender-ID registration and content
  approval.** A third-party vendor says so; Bird says registration is not
  required, which is a statement about Bird's process, not the regulator's.
  CORWADO's to confirm.

**Two-way SMS is not available for South Sudan**, which is a design consequence
and not a footnote: nothing can receive a STOP, so opt-out has to be an officer
withdrawing consent in the system. Any farmer-reply feature is impossible over
SMS here, including the unresolved "Ask AI" advisory.

### I-02 — MTN SOUTH SUDAN DELIVERS; LIBERIA'S CARRIER REFUSES THE SENDER (2026-09-14)

> **CORRECTED 2026-09-14, LATER THE SAME DAY. This section first said "the
> account has never delivered a message" and that South Sudan delivery "remains
> only a documentation claim". Both were false when written.** The account had
> already delivered to MTN South Sudan the previous evening. The error and its
> mechanism are recorded at the end of this section, because the mechanism is
> worse than the mistake.

**WHAT IS PROVED, AND IT IS THE THING THAT MATTERED.** On 2026-09-13 at 20:23
UTC, a message from sender `Agrione_SS` was **delivered** to `+211922200858` on
`mcc_mnc 65902` — **MTN South Sudan**, the largest operator in the target
country. 64 characters, one segment, `service` category, **0.2 EUR**,
`delivered_at` populated.

> **South Sudan delivery through Bird, on the sender we hold, to the operator
> carrying most of the country's traffic, is an observed fact and not a
> documentation claim.**

**What remains unproved for South Sudan:** Zain (`659-91`) and Digitel. One
delivery proves one operator, which is the rule this project already wrote
down. Two of three networks are still untested.

**The whole account history was read on 2026-09-14 to see whether either was
already covered. Neither is.** Nine messages, three destination numbers, and
**only two networks have ever been touched**: `61801` (Lonestar Cell MTN,
Liberia) and `65902` (MTN South Sudan). Exactly **one** `+211` number has ever
been messaged, once, successfully. Nothing in the history touches Zain or
Digitel, so the coverage question needs a handset on each and cannot be answered
from what has already been sent.

**`Authifly` IS OURS — ALIEU CREATED IT, TESTING (owner, 2026-09-14).** Written
down so the next reader does not find an unexplained sender on the account and
start this investigation over. It does not appear in the workspace's sender list
— that holds only `Agrione_SS` — and it predates our sender by thirteen hours,
which is why it looked foreign. It was not.

**Its value is as evidence, and it is the strongest single piece in the whole
exercise.** Two alphanumeric senders, **the same workspace**, **the same carrier**
(`61801` Lonestar Cell MTN), thirteen hours apart:

- `Authifly` → **delivered**
- `Agrione_SS` → **refused, `EC_SENDER_UNREGISTERED`, seven times**

Same account, same route, same destination network, four categories and lengths
from 5 to 148 characters on the failing side. **That eliminates the route, the
aggregator path, the country and the content**, and leaves the sender string and
whatever registration state sits behind it. It is what makes Bird's `approved`
hard to defend rather than merely puzzling, and it is why the support request
leads with the comparison instead of asking a question we can answer ourselves.

**Also established while looking:** Bird's API exposes no actor on a message —
no user, creator, tags or metadata, and no audit or activity endpoint. Attribution
of a send is a dashboard question, not an API one. Worth knowing before anyone
plans an audit trail that spans the gateway.

**THE LIBERIAN FAILURES ARE REAL, AND THEY ARE SENDER-SPECIFIC TO ONE CARRIER.**
Eight messages exist on the account, not the three this section first described.
Six failed, two delivered, and the discriminator is the sender:

| To              | Sender         | Network                   | Status          |
| --------------- | -------------- | ------------------------- | --------------- |
| `+211922200858` | `Agrione_SS`   | **65902 MTN South Sudan** | **delivered**   |
| `+231886257473` | **`Authifly`** | 61801 Lonestar Cell MTN   | **delivered**   |
| `+231886257473` | `Agrione_SS`   | 61801 Lonestar Cell MTN   | failed 104      |
| `+231888022031` | `Agrione_SS`   | 61801 Lonestar Cell MTN   | failed 104 (x5) |

**Same carrier, same country, two senders: `Authifly` delivers and
`Agrione_SS` is refused as unregistered.** So carrier code 104
(`EC_SENDER_UNREGISTERED`) is accurate and specific — `Agrione_SS` is genuinely
not registered with Lonestar Cell MTN, whatever Bird's country-level row says.
It is not a route problem, not a content problem, and not a South Sudan problem.

**PROPAGATION WAS THE OBVIOUS EXPLANATION AND IT IS RULED OUT.** The sender was
created at `2026-09-13T20:03:48Z`. Liberia failed from 20:13, ten minutes later;
South Sudan delivered at 20:23, twenty minutes later. That asymmetry looked like
one registration binding faster than the other, so the owner authorised **one**
retry to settle it.

**Retried 2026-09-14T05:41:33Z — 9 hours 38 minutes after the sender was
created. Failed identically: carrier code 104, billed 0.18 EUR.**

So the sender has had more than nine hours to bind at Lonestar Cell MTN and has
not. `approved` with `next: []` is not describing a registration that is still
settling; it is describing one this carrier does not honour. **The propagation
theory is dead and the question is Bird's**, which is why the support request
goes as drafted rather than waiting on another test.

**Running total: nine messages, seven failed, two delivered. 1.64 EUR spent,
1.26 EUR of it on refusals.**

|               | Message 1                | Message 2           | Message 3           |
| ------------- | ------------------------ | ------------------- | ------------------- |
| Category      | `authentication`         | `service`           | `service`           |
| Body          | 54 chars, "test message" | 148 chars, advisory | 148 chars, advisory |
| Bird's answer | 202 accepted             | 202 accepted        | 202 accepted        |
| Final status  | **failed**               | **failed**          | **failed**          |
| Carrier code  | **104**                  | **104**             | **104**             |
| Billed        | **0.18 EUR**             | **0.18 EUR**        | **0.18 EUR**        |

**Carrier code 104 is `EC_SENDER_UNREGISTERED`.** The sender string
`Agrione_SS` is not registered with the downstream carrier, so the network
refuses it. **Bird reports this as `content_rejected`**, which points at the
message rather than the sender, and that mislabel cost a whole cycle: a message
was rewritten from a test string into a real advisory and its category changed
from `authentication` to `service` on the theory that content class was the
cause. It was rejected identically. **Do not believe Bird's failure label over
the carrier code.**

**THE FINDING THAT SURVIVES, NARROWED TO WHAT THE EVIDENCE SUPPORTS.** Bird's
destination pages say sender registration is **"not required"** for Liberia and
for South Sudan, and Bird's own sender documentation concedes that
`not_required` _"reflects Bird's assessment, not a guarantee of carrier
compliance"_. Liberia's carrier refused an unregistered sender anyway, and Bird
reports that sender `approved` for Liberia with a registration id.

> **So a positive signal from Bird — `not_required` or `approved` — is a
> statement about Bird's records and is not evidence that a given network will
> accept the sender.** That holds regardless of the South Sudan result, and it
> is the rule worth keeping.

**What it does NOT support, and what this section wrongly claimed:** that South
Sudan is therefore doubtful. The same sender, with the same country-level
approval, delivered to MTN South Sudan twenty minutes after it was created. The
Liberian refusal is evidence about Lonestar Cell MTN's treatment of one
unregistered-at-that-carrier sender. It is not evidence about `+211`, and using
it that way was the error corrected at the top of this section.

**Cost, measured rather than published.** **0.18 EUR per segment to Liberia
and 0.20 EUR to South Sudan**, against a rate card showing $0.21 for both, and
**a carrier rejection is billed in full**. Seven rejections cost 1.26 EUR and
delivered nothing. For a campaign budget that is
two separate corrections: the real unit price is in euros, and the figure to
multiply is messages _attempted_, not messages _received_.

**The two networks, named.** `mcc_mnc 61801` is **Lonestar Cell MTN, Liberia**,
60% owned by MTN Group. `mcc_mnc 65902` is **MTN South Sudan**, the same group
and the largest operator in the target country. **The group delivered in one
country and refused the sender in the other**, which is the clearest possible
demonstration that sender registration is administered per country and per
carrier rather than group-wide — and that a rejection by one operating company
says nothing about another.

**What the three sends did prove:** the credentials work, the region binding
works, an alphanumeric sender is accepted by Bird's API and echoed back
unmodified, a 148-character Latin advisory is one GSM-7 segment, and Bird's
`delivered_at` and `last_error` fields report the real outcome when asked.

**Corrections to earlier entries, made here rather than quietly:**

- The `**REDACTED**` body in the first response was reported as a privacy
  property of the platform. It is not. It is what the `authentication` category
  does, and it disappeared the moment the category was right.
- The category was not Bird inferring anything from content. **It was set to
  `authentication` in our own script**, copied from the single example in
  Bird's API reference, and never questioned.
- `pnpm sms:verify` twice reported a 202 and told the reader to go and look in
  a dashboard. **A proof script that stops at acceptance proves the wrong
  thing** — the first pattern again, a check reporting success because it read
  the wrong signal. It now fetches the message back and reports `status`,
  `delivered_at`, the carrier code and the cost, and says plainly that anything
  short of `delivered` reached no handset.

### THE SENDER IS ALREADY REGISTERED AND APPROVED, AND THE CARRIER STILL REFUSED IT

**Read from Bird's own API on 2026-09-14**, after the rejections, at
`GET /v1/sms/senders/{id}/requirements`. For the sender `Agrione_SS`
(`snd_01m2e5wtjcf8eveab6z0zjcnc8`), both destinations report:

| Field                 | Liberia                          | South Sudan                      |
| --------------------- | -------------------------------- | -------------------------------- |
| `destination_enabled` | `true`                           | `true`                           |
| `required`            | `false`                          | `false`                          |
| `status`              | **`approved`**                   | **`approved`**                   |
| `registration_id`     | `scr_01m2e6bb3je43s7xkdayfmzdng` | `scr_01m2e6b51fexwt25h86t5x727g` |
| `rejection_reason`    | `null`                           | `null`                           |
| `next`                | `[]` — nothing to do             | `[]` — nothing to do             |

**So there was nothing to register.** The action "register the sender ID" had
already been taken, carries a registration id, and Bird reports it approved for
both countries — while Lonestar Cell MTN refused the same sender three times as
`EC_SENDER_UNREGISTERED`.

**THE MISMATCH THAT EXPLAINS IT, AND IT IS STRUCTURAL.** Bird's own
documentation says _"registration is decided per destination, so there is one
row per country"_. **Registration is modelled per country. Rejection happens
per carrier.** There is no per-carrier granularity anywhere in the sender
surface — no field, no status, no row — so an `approved` for `LR` cannot mean
"every network in Liberia will accept this sender", and it did not. One
operating company inside an approved country refused it, and Bird's model has
nowhere to represent that.

**This is stronger than the "not required" finding and replaces it as the
headline.** It is not that Bird's assessment of whether registration is _needed_
can be wrong. It is that Bird's assertion that registration is _done and
approved_ does not bind the carrier either. **Both of Bird's positive signals —
`not_required` and `approved` — are statements about Bird's paperwork, and
neither is evidence that a message will be accepted.**

**What this does to the substitution.** The case for Bird over Africa's Talking
rested on one documented fact: South Sudan reachable with an alphanumeric
sender. **That fact is now an observed one** — delivered to MTN South Sudan,
`delivered_at` populated, 0.2 EUR. Africa's Talking cannot serve the country at
all. **The substitution is sound and its central premise is now evidenced
rather than documented.**

**The open question is narrow and is Bird's.** Their API reports `approved` for
Liberia with a registration id, and Lonestar Cell MTN refuses that sender while
delivering a different one — **still, after nine and a half hours**. Propagation
was the plausible answer and has been tested and ruled out. This matters beyond
Liberia because `approved` is the only signal we would otherwise have for Zain
and Digitel, and it has now been shown to mean nothing at one carrier.

**I-02 is partly satisfied, and precisely this much:** an SMS gateway account
exists, is correctly configured, holds approved sender registrations for both
target countries, and **has delivered to MTN South Sudan**. Zain and Digitel are
untested, and Liberia — the control, not the target — currently refuses the
sender.

### THE ERROR IN THIS SECTION, AND ITS MECHANISM (2026-09-14)

**Recorded because the mechanism is worse than the mistake, and the mistake was
mine.**

This section asserted that the account had never delivered a message, that South
Sudan delivery "remains only a documentation claim", and that the evidential
basis for the substitution was "no better than before the account was bought".
All three were false, and the evidence disproving them was one unauthenticated
read away — `GET /v1/sms/messages` — throughout.

**What I actually did.** I sent three messages, watched three failures, and drew
conclusions about the account from a sample of three that I had generated myself.
**I never listed the account's history.** Five messages predated mine, including
the South Sudan delivery, and a sixth was sent in parallel by the owner while I
was working. Every sentence I wrote about "the account" described only my own
three sends.

**Why this is the same pattern, for the fourth time this week.** It is a check
pointed at the wrong scope: "the messages I sent" standing in for "the messages
this account has sent", with the substitution never noticed because the smaller
set was the one I had in front of me. The first pattern — a conclusion drawn
from a signal that was not the thing being asked about.

**What makes it worse than the earlier three.** The others cost a rewrite, a
round trip, a wasted CI hour. **This one was written into a paragraph explicitly
prepared to be read by the client**, telling CORWADO their gateway had no better
evidence than before they bought it, when the gateway had already delivered to
the operator carrying most of their farmers. Confident, sourced, cross-
referenced, and wrong — which is the elaboration failure, with me as the author
rather than the elaborator.

**The rule this earns.** Before characterising a system's behaviour, **ask the
system for its whole history, not for the part you caused.** One list call would
have prevented every false sentence above. The record already says it in the
fourth silent-class instance: _when the record says something was done or is
pending, ask the system rather than the record_ — and "the record" includes my
own three results.

### THE PREMISE THAT EXPIRED WITH THIS CHANGE

Officers authenticate through a derived identifier because Supabase's Phone
provider needed an SMS provider from a list that **excluded Africa's Talking**.
Supabase supports **MessageBird**, and Bird is MessageBird renamed — so the
condition that entry named for revisiting has now occurred, by two routes:
Supabase also added a Send SMS hook that can call any provider at all.

**Nothing was changed.** The B3 entry says to revisit deliberately, with
migration of existing accounts planned, and not as a tidy-up; officer accounts
already exist keyed by the derived identifier. Recorded so the reasoning is not
believed after it stopped being true — the same fault as the audit CHECK comment
and the `.env.example` completeness claim, and the third instance this week of a
document outliving its premise.

---

## TWO CAUGHT EARLIER THAN THE LAST ONE — WHAT IMPROVEMENT LOOKS LIKE (2026-09-14)

**Recorded at the owner's instruction, and the reason is the measurement:
_the pattern getting caught sooner is the thing worth measuring._** A list of
faults only ever gets longer. What tells you whether anything is improving is
how far a fault travels before something stops it.

Both of these are the same shape as errors already in this document. Neither
reached a record, a client paragraph, or a commit.

### 1. A legal document that could not be read, and was not guessed at

The licence question gated the whole C-16 cache design — if storing forecasts
were restricted, the design changed rather than the wording. OpenWeather's terms
are a PDF whose text is glyph-encoded through a subset font, so two extraction
attempts returned 31,000 characters of plausible-looking nonsense with zero
keyword hits.

**The third attempt was not made.** A partial decode of a licence clause is
worse than no decode: it produces a confident, sourced, quotable sentence about
what is permitted, and nobody downstream can tell it was reconstructed from a
substitution cipher. The route taken instead was a first-party HTML page that
states the licence in plain text.

**Distance travelled: zero.** No record was written from the bad decode.

### 2. A search summary about to become a first-party fact

The ODbL answer first appeared in a **search-engine summary** of pages that had
not been fetched. It was very nearly written into the record as _"ODbL, so
storing is fine"_ — correct, as it happens, and **sourced to nothing.** The
first-party FAQ was then checked and **does not name ODbL at all**, which is
what stopped it; the licence was only confirmed by fetching the pricing page and
reading the sentence there.

**This is the message-history error exactly** — the fourth instance of the
third pattern, where I characterised an SMS account from the three messages I had
sent myself and never listed the other five. **Same shape: a conclusion from a
sample I had not verified, presented with the confidence of a fact.**

**Distance travelled: zero.** The earlier instance reached a paragraph written
for the client and had to be retracted.

### WHAT THE COMPARISON IS ACTUALLY WORTH

| Instance                                   | Where it was caught                         | Distance travelled                 |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------- |
| Audit CHECK "generated from AUDIT_ACTIONS" | by a rebase, days later                     | 3 documents, 1 worked-example list |
| `.env.example` "all are listed"            | by a finding written about something else   | 1 state document, 9 days           |
| The SMS account "has never delivered"      | by reading the history, after writing it up | a paragraph prepared for CORWADO   |
| The glyph-encoded PDF                      | before the second extraction was trusted    | **nothing**                        |
| The search-summary licence                 | before it was written down                  | **nothing**                        |

**Two caught at the point of formation rather than after publication.** That is
one data point, not a trend, and the honest reading is narrow: **the two that
were caught early were both cases where the source of the claim was visible and
suspect** — a garbled decode, a search summary — rather than cases where the
reasoning was sound and the input was quietly stale. The harder class is still
the one that gets through, and nothing here shows it is improving.

**The practice that did the work in both cases is the one already recorded:**
ask what this claim is sourced to, and whether the source is a thing I actually
read. Not "is this correct" — both claims were correct — but **"do I know this,
or did something tell me it"**, which is the same question as reading a document
as its recipient, pointed at an input rather than an output.

## THE QUEUE IS SELF-TESTING (2026-09-16)

**Worth recording as a property, at the owner's instruction, because it was not
designed and it is the most useful thing the staging-rows refusal produced.**

The refusal added in the global test setup runs **before any test, as CI's first
real action**, and fails naming the offending row. So:

> **A pull request's own CI answers whether staging is clean. If a run gets past
> setup, the row is gone. If it does not, the first line of the log names what
> is in the way.**

**Why that is more than a convenience.** The condition gating five held branches
lives in a shared database that no document can describe accurately for long —
`docs/HANDOFF.md` said the rule and the row was made anyway; a session asking
the owner gets an answer that was true when they last looked. **Pushing the
branch asks the system.** It is the fourth silent-class instance's companion
rule — _ask the system rather than the record_ — arrived at by accident: the
cheapest way to check the precondition is to attempt the work and read why it
refused.

**The property in general form.** A precondition enforced at the start of the
work, failing loudly and naming its cause, turns every attempt into a
diagnostic. The alternative — a precondition checked by a person, or documented
and trusted — produced the three red main runs this refusal exists to prevent.

**Its limit, so it is not over-claimed.** This works because the check is
**first, cheap and specific**: it runs before the fifty-minute suite, costs one
query, and its message names the row rather than reporting a count mismatch
fifty minutes later in a test about something else. A precondition that fails
late, or vaguely, is not a diagnostic — it is the count being off by one in
`tests/reporting.test.ts`, which is exactly what this replaced.

## A TEST THAT PINS A SHAPE, AND A TEST THAT COMPARES TWO SOURCES (2026-09-16)

**The clearest demonstration yet of the gate principle, because the same test
was written both ways within a day and the second way found something the first
could not.**

**What happened.** `apps/web/lib/auth/portal-gate.test.ts` was written to close
the three-hand-maintained-lists problem in the auth gate. Its third assertion
compared the middleware's `config.matcher` to `PORTAL_PREFIXES` **by equality**:
the matcher must be exactly each portal prefix plus the login page. It passed,
and it was proved failing in both directions.

**Then it was rebased onto a main that had moved seventeen commits, and it went
red.** The design had changed underneath it: the middleware now also matches
`/market` and `/farmer`, because `NEXT_PUBLIC_MARKET_OPEN=0` gates the
marketplace behind the staff session (the owner's decision, 2026-09-15).

> **The assertion was wrong. The design was right.** An equality test on a list
> that another decision is entitled to extend does not protect the gate; it
> reports every legitimate extension as a fault.

**What correcting it surfaced, which neither version covered.** Rewritten to
compare **two sources in both directions** — every gated prefix has a matcher
entry, and every matcher entry is a prefix something gates — it now catches a
case that was invisible to the equality version and to the design review that
produced it:

> **A market prefix missing from the matcher makes `NEXT_PUBLIC_MARKET_OPEN=0`
> silently do nothing.** `isPortalPath` would return `true` for `/market`, so
> the code reads as though the gate closes — and the middleware would never be
> asked, because it does not run there. **A gate that appears to close and does
> not.**

That is the first-pattern failure in the switch built to close the marketplace,
and nothing in the repository would have reported it. Proved by planting it: the
test names `/market` and says what it means.

### WHY THIS IS THE SHARPEST VERSION OF THE PRINCIPLE SO FAR

The gate principle has been recorded, argued, given worked examples and applied
to guards about guards. **This is the same test, by the same author, one day
apart, in both forms:**

|                                         | The equality version             | The comparison version         |
| --------------------------------------- | -------------------------------- | ------------------------------ |
| What it asserts                         | the matcher **equals** this list | two lists **cover** each other |
| When the design legitimately grows      | **red, wrongly**                 | green                          |
| A gated prefix missing from the matcher | red                              | red                            |
| A matcher entry nothing gates           | red                              | red, and named                 |
| `MARKET_OPEN=0` silently doing nothing  | **invisible**                    | **red**                        |

**The difference is not strictness.** The equality version is _stricter_ and
catches _less_. It fails on changes that are correct and stays silent on the one
that is dangerous, because it was pinning a shape rather than checking a
relationship. **A test that pins a shape encodes today's design; a test that
compares two sources encodes the rule the design must satisfy.**

**The practical tell, for the next test written here:** if a legitimate future
change would turn the assertion red, it is pinning a shape. Ask what the two
things are that must agree, and assert _that_ — then the design may grow and the
rule still holds.

## A MISSING OPTIONAL FIELD IS THE FAILURE NO TEST ASSERTS (2026-09-15)

**Found by reading a signature, not by testing an output, and recorded at the
owner's instruction because the finding method is the transferable part.**

**What happened.** C-16.10 requires OpenWeather's attribution in the route's
payload — **a licence condition, not a courtesy**. The route was written as:

```ts
return ok(rows.map(...), undefined, { attribution: attribution() });
```

which reads correctly, compiles, lints, and would have shipped a payload with no
`attribution` in it. `ok()`'s signature was `(data, headers?)`. **A third
argument to a two-argument function is silently discarded by JavaScript.** No
type error: the extra argument is simply not checked. No test failure: the
route's tests assert what `data` contains, and nothing asserted that a field
_was there_.

**How it was found.** Before writing the route's assertions, the wrapper's
`ok()` was read to check what it did with a third argument. The answer was
nothing. `ok()` then gained an `extra` bag of top-level siblings, which refuses
the envelope's own names (`data`, `warnings`, `page`, `error`) so a future
caller cannot quietly overwrite the envelope.

**THE SHAPE, AND IT IS A NEW ONE FOR THIS LIST.** Every silent instance recorded
above is a check that ran and examined the wrong thing. This is not that. **It
is the absence of a check entirely, in a place where absence is invisible:**

> **A test asserts what is present. Almost nothing asserts what is missing.**

A wrong value fails an equality. A missing optional field fails nothing —
`body.attribution` is `undefined`, the reader renders nothing where the notice
should be, and every existing assertion still passes. It is the same family as
`audit_event.device_id` (the eighth instance: a column the law required and no
request ever sent) and `updated_at` (the seventh: a column nobody wrote), but
those were found by looking at the database. **This one had no column to look
at** — it is a field in a JSON body that simply was not there.

**The rule this earns, and it is cheap.** For anything the payload must carry
because a contract or a licence says so — not merely because a screen wants it —
**assert its presence explicitly**, not only the correctness of its value:

```ts
expect(body.attribution).toEqual(WEATHER_ATTRIBUTION); // presence AND value
```

`tests/weather.test.ts` asserts exactly that, twice, including on the **empty**
response — because an empty `data` array is the case where a payload sibling is
easiest to drop and hardest to notice.

**And the wider form, which is the owner's point.** The finding came from
reading the callee's signature rather than the caller's output. For a shared
helper, **what it accepts is a fact about the helper, and it is cheaper to read
than to infer from behaviour** — particularly in a language that discards extra
arguments without complaint.

## THE BACKUP MANIFEST GATE IS ONE-DIRECTIONAL (2026-09-14)

**Found while writing C-16, and it is worse than the criterion it produced.**
`MANIFEST_TABLES` in `apps/web/lib/backup/manifest.ts` is the list of tables a
backup must carry. `tests/backup.test.ts` checks it in one direction only:

```ts
// Every table a backup must carry is a real table: a renamed table would be a
// finding here, not a silent zero.
for (const table of MANIFEST_TABLES) {
  /* ... assert it exists in information_schema ... */
}
```

**That catches a table removed or renamed. It cannot catch a table added.**
Nothing compares the catalogue back to the list, so **a new table is silently
absent from the manifest**, and the manifest is what a restore is verified
against.

**Why this is the worst place in the project for it to happen.** The manifest is
C-11's instrument for proving a recovery worked. `compareManifests` would report
every difference explained and `isVerified` would return true, **while counting
nothing for the missing table** — a clean bill of health on a restore that lost
a table entirely. **The first pattern, in the unit whose entire purpose is
proving recovery works.** It is exactly the shape recorded eleven times above: a
gate asserting one fact, true when written, quietly false the moment something
new appears.

**It has not bitten yet**, and the reason is luck rather than design: every
table since B8 was added by a session that also wrote the manifest entry. C-16
would have been the first to add tables without that habit, which is why C-16.12
names it — but a criterion in one unit is not a fix.

**THE FIX, SIZED AND NOT BUILT: about half an hour.** One test that reads
`information_schema.tables` for the public schema, subtracts an explicit
allowlist (`_prisma_migrations`, and any table deliberately excluded with its
reason), and asserts the remainder equals `MANIFEST_TABLES`. **That turns a
single-fact gate into a gate that compares** — two sources moving independently,
red by itself when either moves alone — which is the principle recorded above
and the same shape as the two audit-CHECK gates merged in #70.

**Recorded as an open item rather than left in C-16**, at the owner's
instruction: _"It should not wait for someone to notice a missing table during a
restore."_ The half hour is cheaper than the alternative by any measure, and the
alternative is discovering it in an emergency.

## I-03 WEATHER — WHAT CORWADO MUST BE TOLD BEFORE (e) IS PROMISED (2026-09-14)

**Findings before any code, at the owner's instruction. Two of them belong to
CORWADO rather than to us, and they are put first because they change what the
client should be promised.**

### 1. SOUTH SUDAN HAS ALMOST NO WEATHER OBSERVATION, SO A PAYAM FORECAST IS MODEL OUTPUT

**This is the finding to give CORWADO, not to bury in a design note.**

|                                       |                                            |
| ------------------------------------- | ------------------------------------------ |
| Automatic weather stations installed  | **13**                                     |
| Being added (FAO-supported, Feb 2026) | **27**, for 40 total                       |
| Manual synoptic stations              | about **3**                                |
| Country area                          | roughly **644,000 km²**, larger than Kenya |

South Sudan Meteorological Services sits inside the Civil Aviation Authority and
provides mainly aeronautical forecasts and a radio bulletin.

**What that means for a number on a screen or in an SMS.** OpenWeather serves
"any coordinates around the globe" and markets **100 m resolution with 10-minute
updates** from its own model. Over South Sudan there is almost nothing to observe
with, so **a payam centroid receives interpolated global-model output — GFS and
ECMWF — not a nearby measurement.** A 100-metre grid over an unobserved region is
resolution, not accuracy: the figure describes the output, not the input.
OpenWeather nowhere discloses where real station data exists.

**Three consequences, stated plainly:**

- **Neighbouring payams inside one county will read alike**, because they are
  often the same model cell. Payam-level distinctness is largely illusory today.
- **So county-level locations are the right default to start**, which gives
  nearly the same information for roughly a sixth of the calls (about 80
  counties against about 500 payams). Payam-level becomes a deliberate choice
  when the network densifies, not the starting assumption.
- **Nobody should promise a farmer precision the data cannot support.** An
  advisory saying it will rain in your payam on Thursday is a model's view of a
  region with three manual stations in it. That is still useful — a flood watch
  is worth sending — but it is not a local observation and should never be
  described as one.

**The trajectory is genuinely upward.** Those 27 stations exist specifically to
feed WMO's WIS2 and the Global Basic Observing Network, whose purpose is to
improve global forecasting over exactly this territory. The data behind this
deliverable gets better on a timescale that matters to the project. `raw` on
`weather_forecast` is kept partly for that reason: when the inputs improve, it is
how anyone reconstructs what we told a farmer and why.

### 2. THE LICENCE PERMITS THE CACHE — AND THE ATTRIBUTION RULE COLLIDES WITH SMS

**Read from OpenWeather's own pricing page, because the whole design depends on
storing forecasts and the answer was unconfirmed.**

> _"All automated self-service plans are provided under the ODbL (Open Database
> License)."_

**Storing forecasts is permitted, and the design does not change.** Commercial
use is allowed; there is no obligation to open-source the application or share
product code. Share-alike attaches only if OpenWeather data is restructured or
enriched into **our own dataset or API made available outside the
organisation** — then that must be offered under ODbL too. An internal cache
behind `requireRole`, feeding a staff dashboard, is not that. **The rule to
carry forward: do not expose the forecast cache as a public dataset or API
without accepting ODbL on it.**

**But attribution is a live constraint, and it lands on deliverable (e) rather
than on the tile.** OpenWeather requires attribution **visible where the data is
displayed** — _"attribution placed only in hidden documentation or deep legal
pages is not sufficient"_ — and gives the line as `Weather data © OpenWeather`.

> **A one-segment SMS is 160 GSM-7 characters, or 70 in Arabic script.
> `Weather data © OpenWeather` is 26 of them.** That is 16% of a Latin segment
> and over a third of an Arabic one, on a message that already costs 0.20 EUR
> per recipient per segment.

**THIS IS CORWADO'S TO RESOLVE, NOT OURS, AND IT HAS A NUMBER ATTACHED.**
Twenty-six characters of a hundred and sixty, **on every recipient of every
advisory**, or over a third of an Arabic-script segment. At 0.20 EUR per
segment, carrying the attribution on a 148-character advisory pushes it to a
second segment and **doubles the cost of the send** — 400 EUR per thousand
farmers instead of 200.

Three options, and CORWADO should choose knowingly:

1. **Carry it and write shorter.** Advisories are held to ~134 Latin characters
   so the attribution fits in one segment. Cheapest in money, tightest in
   language, and hardest in Arabic script where 26 characters of 70 leaves
   almost nothing.
2. **Decide an SMS is not a "display" of the data**, with attribution on the
   dashboard and in the farmer-facing terms instead. Plausible — the licence
   language is about where data is displayed, and it was written for screens —
   but it is a legal reading and not ours to make.
3. **Avoid OpenWeather-derived content in advisories altogether**, and this is
   worth naming because **it may be the cheapest.** An advisory that says "heavy
   rain is forecast this week, cover stored grain" carries agronomic guidance
   triggered by a forecast rather than the forecast itself. The numbers stay on
   the dashboard where attribution is easy; the SMS carries the instruction. It
   removes the licence question, shortens nothing, and costs nobody a segment.

**Unresolved, and recorded as unresolved.** It does not affect the tile, which
has room for the line and must carry it.

**Note the inconsistency, since someone will implement whichever they read
first.** The pricing page gives `Weather data © OpenWeather`; the FAQ requires
_"Weather data provided by OpenWeather"_, a hyperlink to openweathermap.org
**and** the OpenWeather logo, obligatory on all plans between Free and
Professional. The stricter reading is the FAQ's, and the tile should satisfy it.

### 3. I-03's STATE: THE FREE TIER IS ENOUGH TO BUILD AND PROVE

**No CORWADO account is needed to build this.** The Free plan is **60 calls per
minute and 1,000,000 calls per month**, registered with an email address, and
covers Current Weather, Geocoding, Air Pollution and historical data. Exceeding
the per-minute rate returns `429`; nothing bills.

**What the free tier does not clearly include is One Call** — the product that
returns current, hourly and daily in a single call. OpenWeather's pricing page
lists the newer timeline-based product under **Startup and above**. Secondary
sources report One Call 3.0 as 1,000 calls/day free and about 0.0012 GBP per
call beyond that, and **no first-party page publishes that per-call rate**. So
the free tier is enough to build and prove the tile using Current Weather plus
the free forecast endpoint; whether the eventual shape is One Call is a question
the account will answer, and it is not on the critical path.

**Fetch budget, computed rather than guessed**, against 1,000,000 calls/month:

| Scale                                 | Fetches/day | Fetches/month | Share of free allowance |
| ------------------------------------- | ----------- | ------------- | ----------------------- |
| 12 payams (staging placeholder today) | 12          | ~360          | 0.04%                   |
| ~80 counties (real, county-level)     | 80          | ~2,400        | 0.24%                   |
| ~500 payams (real, payam-level)       | 500         | ~15,000       | 1.5%                    |

**The binding constraint is 60 calls per minute, not the monthly total.** A
naive loop over 500 locations returns `429` partway and leaves a half-filled
cache, so the scheduled fetch must be paced regardless of how generous the
monthly figure looks.

### 4. A DEPENDENCY NOBODY HAD STATED: WEATHER LOCATIONS INHERIT I-07

`weather_location.payam_id` ties this deliverable to the location hierarchy, and
**that hierarchy is placeholder data**. Staging holds 10 states, 6 counties and
12 payams; `scripts/locations-lib.mjs` says the codes _"are invented for this
project and will not match the boundary lists when they arrive"_.

**So any weather location seeded now must be re-pointed when CORWADO's list
lands.** B10 did exactly that exercise once already — migration 20 was the
reporting repoint. It is cheap if expected and expensive if discovered, which is
why it is written here before the first row exists.

## KNOWN CONDITION — CORRECTED: THE POOLER WAS NEVER FLAKY; PRISMA'S CONNECT TIMEOUT WAS TOO SHORT

`DIRECT_URL` reaches staging through the **session pooler**
(`...pooler.supabase.com:5432`), not the direct host. The direct host
`db.<ref>.supabase.co` has **no A record — it is IPv6 only**, and IPv4 direct
access is a paid add-on. A machine without an IPv6 route cannot use it at all.
That part stands.

**What this section said from B2 to B5 was wrong.** It said the connection
"drops intermittently, roughly one attempt in three", and told the operator to
retry the command. The diagnosis on 2026-09-05, made after five failed suite
runs in one day, is different and is backed by measurement:

- **Prisma's default connect timeout is 5 seconds.** Every failure, on both
  poolers, landed at **5.01 to 5.02 seconds** with the text `Can't reach
database server`. Successes landed anywhere from 2.4 to 6.3 seconds.
- **The poolers were healthy throughout.** A raw Postgres protocol handshake
  reached the authentication step in 2.2 seconds. `psql` answered `select 1`
  on the session pooler three of three (1.9 to 2.9 s) and on the transaction
  pooler three of three (1.3 to 8.7 s). Their TLS-plus-auth handshake is
  simply slow, and variable.
- **With `connect_timeout=30`, Prisma connected three of three** on the
  session pooler, in 2.5 to 3.5 seconds.

So the "drop" was Prisma giving up before the pooler finished saying hello.
The transaction pooler seemed "more reliable" only because its handshake is
sometimes faster. Retrying "worked" because the next handshake sometimes beat
five seconds. Nothing was ever dropping.

**The fix, in three places.** `connect_timeout=30` on both URLs: in
`.env.local` (the user, 2026-09-05), in the documented shapes in
`.env.example`, and **appended in code by `vitest.config.mts`** to whatever
URL a test process sees, so a test never depends on someone having got the
value right in their own file — the same class of problem as `tests/` sitting
outside the typecheck gate, and closed the same way. GitHub and Vercel secrets
are the user's to update.

**Two settings this history left behind, re-examined:**

- **`--no-file-parallelism` on database tests.** Recorded in B2 as necessary
  because parallel files "exhaust the pooler's connection slots and fail as
  P1001". That failure is the same five-second text, so it may have been the
  same timeout, not exhaustion. **Tested on 2026-09-05, with the timeout
  fixed: still needed, for a different reason.** In parallel, 23 files ran in
  94 seconds with **zero** connection or pool errors — the slots were never the
  problem — but five files failed with 401s and empty audit lists: every
  database test file creates `zztest` principals and calls the same global
  `sweep()`, so files were deleting each other's accounts mid-run. The rule
  stays until the fixtures are per-file; it is a fixture-isolation rule, not a
  pooler rule, and the flag's comment should say so.
- **The app's client in a test process needs more than one connection.**
  Production's `connection_limit=1` is right for one serverless instance. In
  the test process it made every concurrent route call queue behind one
  connection, and Prisma's 10-second pool wait turned the queue into 500s
  (`P2024`, 47 times in the first run under the new timeout). `vitest.config.mts`
  now gives the test process ten connections and a 60-second wait. Recorded
  because it is a deliberate difference between test and production.
- **Abandoned transactions hold locks forever, and did (2026-09-05).** Seen
  live in `pg_stat_activity`: a server session _idle in transaction_ for
  sixteen minutes, its last statement the farmer-number counter upsert, with
  five live registrations queued behind it on the row lock and failing after
  Postgres's two-minute `statement_timeout`. The client had given up — Prisma
  abandons an interactive transaction it cannot start within `maxWait` — but
  the pooler keeps the server session, and **this role has
  `idle_in_transaction_session_timeout = 0` and `lock_timeout = 0`**: nothing
  on the server ever ends such a session. The sessions survived the client
  process being killed and were terminated by hand. Two things changed:
  `audited()` now sets a transaction-scoped idle timeout of 30 s as its first
  statement, so no write can hold a lock while its client is gone; and the
  1,000-allocation test runs ten transactions in flight at a time, the size of
  its pool, instead of launching a thousand at once. **Applied by the user on
  2026-09-05, on staging's `postgres` role:**
  `idle_in_transaction_session_timeout = 60s` and `lock_timeout = 10s`,
  covering every path including those that do not use `audited()`. **Production
  will not have them** — see the B11 checklist below.
- **The reseed's 300 s interactive-transaction budget.** Still right: it
  covers dozens of round trips inside one transaction, which is a different
  thing from the connect timeout.

**Do not add retry logic inside a test.** Still true, and now for a better
reason: the one time it looked necessary, the right fix was a timeout value,
which a retry would have hidden indefinitely.

---

## OUTSTANDING ITEMS — THINGS THAT EXIST AND MUST BE REMOVED

**The list is empty.** Both `_dev` routes were deleted in B3, with
`packages/shared/src/dev.ts`, its export and the validate-phone test. The
`/api/_dev/*` exception has been removed from `docs/api/CONVENTIONS.md` §2
entirely rather than left standing with nothing under it.

The rule stands for any future `_dev` route: **it and its row here are created
together or not at all.**

---

## KNOWN LIMITS

Stated so they are known rather than discovered.

**Five of the six parked error codes are now reachable**, and the two parked
sections of `docs/api/CONVENTIONS.md` are unparked. B3 made `invalid_cursor`,
`unauthenticated`, `forbidden`, `not_found` and `unprocessable` emittable, and
built the first list routes and the first responses carrying timestamps.

**One remains parked:** `conflict` (409) is emitted by B3 — a duplicate officer
phone, a taken address — but the client-UUID idempotency case in the status
table's description arrives with **B9**. The column reads _Yes_ because a route
does emit it.

**The scrubber is the last gate we control, not the last gate — now observed,
not predicted.** On 2026-09-04 one deliberate event (`pnpm sentry:verify`) was
read in the Sentry UI: issue `AGRI-WEB-1`, event `4f4a56c0`. What arrived:

- **Removed, as designed:** every value under a listed key
  (`registration_body` shows `given_name`, `family_name`, `national_id`,
  `phone` all `[redacted]`), the phone inside `query_string` and `url`, and
  `os.name` / `runtime.name` (versions survive). **Zero** matches for the
  fabricated number anywhere. `server_name` is `development`, not a laptop.
  Stack frames show file and line only — no source lines.
- **Present, the known limit:** `Achol` and `SSD-1234567` in the title, the
  message and the breadcrumb. A name or national id in free text is not
  removed. The standing rule is the protection.
- **`sdk.name`:** transmitted (seen in the captured envelope); not confirmed in
  the UI, which was not expanded that far.

**Two things arrived that no prediction covered.**

1. **Sentry adds User Geography — `India (IN)` — after ingest**, derived from
   the sending IP. **This is the first concrete instance of the
   post-`beforeSend` limit**, recorded in B1.5 as theoretical: it is attached
   by Sentry's pipeline, our scrubber never sees it, and no code of ours can
   remove it. `sendDefaultPii: false` did not prevent it. The remedy is a
   Sentry **project setting**, not code: Settings → Security & Privacy →
   _Prevent Storing of IP Addresses_. Not yet applied; CORWADO's decision.
2. **Culture — timezone `Asia/Calcutta` — is different**: it is attached by the
   SDK _before_ `beforeSend` (it was in B1.5's captured envelope), so it is
   reachable, and was simply not on the key list. Mildly identifying; left as
   is, recorded here.

**The stack frame carried the full local path including the OS username.**
B1.5 accepted that limit on the premise that no local machine holds a DSN —
**that premise lapsed when a DSN went into `.env.local` for this
verification.** For a Vercel deployment the path is `/var/task/…` with no
username; that is **inferred from Vercel's runtime layout, not observed from a
Vercel-originated event** — the observation that would settle it is one real
route error on a preview deployment (see _To settle on the first real preview
deployment_, below). Until then: a local DSN sends local paths.

**The DSN and local machines.** The DSN was removed from `.env.local` on
2026-09-04, the verification done. **It belongs in Vercel's environment
variables, not on any laptop.** B1.5's premise — _"local machines have no DSN,
so nothing is sent from where this applies"_ — is what keeps local paths, and
the username in them, out of Sentry, and it holds only while the DSN is absent.
To re-verify locally: add it, run `pnpm sentry:verify`, remove it. Three steps,
not two.

**Culture context is now redacted.** `timezone` and `locale` joined the key
list on 2026-09-04: reachable (SDK-side, before `beforeSend`), not needed for
diagnosis, and it narrows a person's location. Tested in both directions.

**IP-derived geography: decided off, 2026-09-04.** CORWADO's decision, made by
the user: turn on Sentry's _Prevent Storing of IP Addresses_ (Settings →
Security & Privacy). Reasoning: we have no use for IP-derived location, and
once real staff in South Sudan are using the system every error would carry an
inferred location for a named person's device; turning it off costs nothing
because we never wanted it. **Applied by the user in the Sentry UI — this
repository cannot reach that setting.** Confirm by re-reading a later event:
User Geography absent.

**To settle on the first real preview deployment.** Each of these is inferred
from code or from Vercel's documented layout, not yet observed from an event
that Vercel sent. One real route error on a preview deployment, read the same
way as the verification event, settles all of them at once:

- The stack frame path is `/var/task/…`, with no username.
- The `environment` tag reads `staging` on a preview deployment and
  `production` on production, because `SENTRY_ENVIRONMENT` is set explicitly
  in Vercel (decided 2026-09-04, see the process-finding section). A preview
  event tagged `preview` means the Vercel variable is missing.
- The `release` and `app_version` tags carry the commit SHA from
  `VERCEL_GIT_COMMIT_SHA`, not `unknown`.
- `server_name` is the environment there too; the code path is the same, the
  runtime is not.
- Frames offer _Unminify Code_ and nothing else, because no source maps are
  uploaded — expected, confirm it reads acceptably.
- The 1 MB request cap is judged from `Content-Length`; Vercel imposes its own
  body limit ahead of ours. Which one answers first is unobserved.
- `sdk.name` is displayed, not only transmitted.
- User Geography is absent, once the IP-storage setting is on.

**A personal name or national ID in free text is not removed.** See the standing
rule below.

**No source maps are uploaded, so client stack traces are minified.** Uploading
needs a build-time `SENTRY_AUTH_TOKEN` and CI wiring. `@sentry/cli` is recorded
in `pnpm-workspace.yaml` as a build deliberately not run. Server-side traces are
unaffected. A B3-or-later task.

**The 1 MB request cap is judged from the `Content-Length` header** — what a
request _claims_. A request declining to declare a length, such as a chunked
upload, is not caught. `docs/api/CONVENTIONS.md` §9.2. **B9** replaces it with a real
streaming limit for sync batches.

---

## STANDING RULES

**Never write an example connection string with a password-shaped segment,
even as a placeholder.** Not in `.env.example`, not in a document, not in a
comment. Describe the shape in words — host, port, query parameters. The
secret scan reads every commit of every ref, has no allowlist, and cannot tell
a placeholder from a credential; it should not have to. B5's branch had to be
squashed to remove one (2026-09-05, `docs/DECISIONS.md`).

**Guards are tested in both directions.** No unit is done until every guard it
introduces has been tested both refusing _and_ accepting. A guard that refuses
everything passes every refusal test perfectly. This has caught three defects so
far — B1.3, B1.4, B1.5. Story in `docs/DECISIONS.md`.

**Error messages never name a person.** Never interpolate a farmer's name, phone
number or national ID into an error message, log line or exception. Reference
records by id only. The scrubber cannot detect a name in free text, so such a
message reaches Sentry intact. A national ID is the worst case: not a listed
key in free text, not phone-shaped, and the one identifier a farmer cannot
change after it leaks. **Today this is a discipline, not a guarantee** —
enforcement is a B3 opening task.

**A `_dev` route and its row here are created together or not at all.**

---

## C-13 WAS BUILT THREE PHASES EARLY AND WAS NOT MERGED

Pull requests **#17** (directories and learning library) and **#18** (65 files of
portal screens) were **closed unmerged** on 2026-09-03. They ran three phases
ahead of the build order in `CLAUDE.md` §2, with no `requireRole` to place
behind them, against criteria not yet written, and were too large to inspect.
Full reasoning in `docs/DECISIONS.md`.

**The branches remain** — `feat/p1-directories-library` and
`feat/ui-portal-directories-library` — as reference for the real C-13 unit.
Nothing is lost and some of it will be worth taking.

**Order: B3 first, then the phases before 4, then C-13 written into
`docs/scope-and-acceptance.md`, then the build.**

---

## B3 OPENING TASKS — ALL SIX DONE

| #   | Task                                                            |                                                                                                                    |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Delete both `_dev` routes and everything they entailed          | done                                                                                                               |
| 2   | Unpark §6 and the timestamp rule in §7                          | done — first list routes and first timestamps                                                                      |
| 3   | Move the code-in-the-right-situation guarantee into the wrapper | done — the wrapper owns the 415/413/400 order, the 405 and the fixed 500, and a test fails any route that skips it |
| 4   | A correlation id on every response                              | done — including 401s, 403s and 500s, and it echoes a caller-supplied one                                          |
| 5   | Enforce the free-text rule structurally                         | done — `conflict()` and `unprocessable()` take a rule key, not a sentence                                          |
| 6   | Add the `deleted_by` foreign keys                               | done — five constraints                                                                                            |

**What task 5 does and does not do.** A route can no longer interpolate into a
409 or 422 message, because those functions do not accept text. The wrapper's
own errors were already pinned constants. What is still possible is an author
writing a name into a `console.error` or a thrown `Error` — the scrubber catches
phone numbers there, not names. The standing rule still applies to log lines.

---

## B4 — THE AUDIT LOG IS BUILT, AND THE AUDIT LAW IS MET WITH ONE STATED EXCEPTION

`audit_event` exists (migration 9), append-only **against the application**: a
database trigger refuses `UPDATE` and `DELETE` for every role including the
owner. **It is not immutable.** A superuser, or the owner via `DROP TRIGGER`,
`DISABLE TRIGGER` or `TRUNCATE`, can alter history; those are deliberate DDL
acts visible as drift. Never describe it as immutable.

**The twelve B3 writes are retro-fitted.** Every route that creates, updates or
deactivates writes its row inside the same transaction, through `audited()` +
`writeAudit()` — which refuse any other client at compile time and at runtime.

**The exception, stated:** two writes are HTTP calls to Supabase Auth and have
no transaction. Their row records the **outcome after the call returns**
(`auth.disabled` / `auth.disable_failed`), not an intention. `CLAUDE.md` §4's
"every create, update and delete appends a row" is therefore met for every
database write, and met-after-the-fact for the two external ones. That is the
whole of the gap, and `docs/DECISIONS.md` records it.

**The reseed writes rows from now on**, as `system`. **Runs before B4 wrote
none: 2026-09-02 18:28 UTC until B4 merged.** Not backfilled — the only logs of
that window are local and gitignored, so `docs/DECISIONS.md` is the only durable
record it existed. Placeholder data only; no CORWADO source data was in it.

**`pnpm typecheck` now covers `tests/`.** It never had: the root directory
belongs to no workspace package, so `pnpm -r` skipped it and B2's and B3's
tests were never typechecked. A root `tsconfig.json` fixes that.

---

## PROCESS FINDING — WORK REACHED MAIN WITHOUT A BRIEF (2026-09-04)

**What happened.** PR #29, _farmer flow — language, login by code,
self-registration, account, listings (C-18) on fixtures_, was merged to main on
2026-09-03 22:24 UTC. It was not briefed. It carries no acceptance criterion:
**C-18 does not exist** in `docs/scope-and-acceptance.md`. It has no
`docs/HANDOFF.md` entry. Farmer self-registration is excluded by Inception
Report section 5.1 and a farmer-facing application is on the _Unresolved — do
not build until I confirm in writing_ list in `CLAUDE.md` section 2.

**The pattern.** This is the third time work has appeared outside the build
order. #17 and #18 were the same pattern (see _C-13 was built three phases
early_, above) and were caught before merge, closed unmerged. #29 was not
caught: its checks were green (lint, typecheck, Vercel preview) because
nothing in the gate reads the scope document. **The gate tests code; it does
not test whether the code was asked for.** That is the finding, and it is a
process finding, not a code one — the code in #29 is fixtures and screens,
touches no table, migration, route or shared package, and is clean to remove.

**What #29 added, as inventoried on 2026-09-04.** Twenty-three new files and
two modified, all under `apps/web`: a `(farmer)` route group with seven
pages, eight components, a client-side preview session (a cookie holding a
fixture farmer id, a language cookie and `localStorage`), a translation
layer, a produce-listings block appended to the fixtures file, and a Farmer
section appended to the design page. No database, no API, no shared schema,
no CI, no docs, no migration. Nothing merged after it depends on it. It is
reachable on the preview deployment by URL only; the portal links to none of
it.

**A fifth and a sixth instance, 2026-09-05.** Four Lane 2 pull requests are
open: #27 (2026-09-03, the C-18 "farmer web account and listings" baseline
that C-18 has never existed for), #28 (the P1 routes, briefed in HANDOFF),
#36 (2026-09-05 12:02, "AgriOne design system on the staff portal + user
administration, hub") and #37 (2026-09-05 12:02, the farmer register wired
to the live B5 routes, which HANDOFF asked for). #28 and #37 are briefed
work. **#27 is the fifth instance**: excluded scope carried as an open pull
request rather than a branch. **#36 is the sixth, and it is different in
kind: it carries the "AgriOne" name from the branch reverted at #29 — the
first time output from reverted work has come back, rather than only the
pattern.** None of the four is touched by Lane 1; the user deals with them.
Recorded at the time so the record shows when it started rather than
reconstructing it later.

**The seventh process instance, 2026-09-09 11:34 and 11:58 UTC — the first to
reach main by merge.** While the owner was deciding the four Lane 2 branches,
two new pull requests were opened and merged the same morning by the
`cyberdhators` account: #49, "AgriOne staff portal to main — CORWADO
authorized", reinstating the closed #36; and #50, "AgriOne farmer marketplace

- account to main (C-18)", the farmer-facing web flow — 79 files, nine
  thousand lines, a public sign-in and marketplace on fixtures. The owner did
  not merge them. **What was asserted:** #49 claims CORWADO authorised the name
  "AgriOne", citing a HANDOFF entry the same lane wrote; #50 claims a CORWADO
  authorisation for a farmer-facing web flow and calls itself C-18 — the
  section the owner closed the same day in #27 for asserting an answer on the
  client's behalf. Nothing in the repository records CORWADO saying either.
  Reverted by the owner's instruction as #52 (#50) and #53 (#49), one each, as
  #31 reverted #29; the branches stay. Neither touched anything B2–B11 own.

**The mechanism, which is the finding that matters, and it has two halves.**

_First, the identity._ The two lanes share one GitHub identity. A merge by a
session and a merge by the owner are the same event to the repository, so no
branch protection, required review or CODEOWNERS rule can tell them apart, and
every safeguard in this project that names the owner — "merges are the owner's
action", "confirmed in writing", "the owner decides" — is unenforceable while
that is true. The fix is organisational, not code: a second GitHub identity for
Lane 2, and protection on main requiring the owner's approval to merge. **The
owner is adding the second identity, 2026-09-09.**

_Second, and it is the half a permission fixes nothing about._ Today's merges
were performed by something operating without a brief, that asserted a client
authorisation in a document it wrote itself, and then cited that document as
its authority. A second identity stops it merging. **It does not stop it
writing.** Whatever drives Lane 2 needs the same restate-and-confirm discipline
every backend unit has had: state the task, name the criteria by id, name the
laws that apply, and stop for the owner's answer before writing anything —
CLAUDE.md §0, which Lane 1 has followed for every unit from B2 to B11.

Seven instances now, and **every one of them would have been caught by a
session that stopped and asked.** Not one required a tool, a check or a
protection rule to prevent; each required only the discipline of not
proceeding on an answer nobody gave.

**A fourth instance, 2026-09-04 07:05 and 07:09 UTC.** Lane 2 pushed to
`origin/feat/ui-farmer` and `origin/docs/farmer-baseline`: a marketplace with
e-commerce browse and a product page, and a farm survey sheet. The same
pattern as #29 — excluded scope (a farmer-facing application; produce
listings are deliverable (h), phase 5) built against criteria that do not
exist — the morning after #29 was reverted. Not merged. Those branches are
not touched by Lane 1; recorded here for the user.

**Status: reverted, 2026-09-04**, by a plain revert of the squash commit,
which applied without conflict and left both modified files byte-identical to
their pre-#29 state. The work lives on branch `feat/ui-farmer-account` on the remote, and in full in the reverted squash commit `141993d` on main's history. If CORWADO confirms the farmer
application is in scope, that is the reference for the real unit — built
against criteria that exist, with a brief, in the right phase. The reasoning
is in `docs/DECISIONS.md`.

**Sentry environment tag — decided the same day.** A preview deployment
reports `staging`, production reports `production`, because
`SENTRY_ENVIRONMENT` is set explicitly in Vercel for each. Without it the
code falls to `VERCEL_ENV`, whose word is `preview` — not a name we use, and
it would have become everyone's filter before anyone chose it. A preview
event tagged `preview` means the Vercel variable is missing; that is the
fault, not the code.

## FINDING — tests/ was outside the typecheck gate from B1.1 until B4

Recorded as a finding, not a fix, so a future audit knows which units to
treat with less confidence.

`pnpm typecheck` ran `pnpm -r typecheck`, which visits workspace packages. The
root `tests/` directory belongs to none, so it was never typechecked. **Every
unit merged in that window had this hole in its gate:** B2's location tests,
the reseed tests, B3's forbidden matrix — **85 cells** — and its scope and
lifecycle suite were all run but never typechecked. A `@ts-expect-error` in any
of them asserted nothing.

Fixed in B4 by a root `tsconfig.json` covering `tests/`, run first by
`pnpm typecheck`. The first run found one latent defect, in B2's tests: a
fault in the test's own typing, not in what it asserted — B2's behaviour and
criteria are unaffected (see `docs/DECISIONS.md`, B4).

---

## B5 — THE FARMER RECORD EXISTS, AND REAL PERSONAL DATA CAN NOW ENTER (2026-09-05)

**What exists.** Migration 10: `farmer`, `consent`, `farmer_number_counter`,
the `farmer_active` view, three enums, two composite foreign keys (payam ↔
state, payam ↔ county), a trigger that refuses any change to `farmer_number`
or `registered_by`, and the §10 indexes. Five routes under `/api/farmers`
through the wrapper. Every input validated by `packages/shared/src/farmer.ts`.
Four audit actions. The success envelope gained `warnings` (CONVENTIONS §3.2).

**How the farmer number stays unique under concurrency.** One row per county
in `farmer_number_counter`. Allocation is a single upsert on that row inside
the registration's transaction; the row lock the upsert takes queues every
concurrent registration in the same county behind it, so two transactions
cannot read the same value. The UNIQUE constraint on `farmer_number` is the
backstop, not the mechanism. Proved by `tests/farmers.test.ts`: 1,000
concurrent allocations over ten real connections yield 1,000 distinct,
contiguous values. The number is stored as text at insert and never derived
again, so a county code changing later leaves every printed card valid.

**If the I-07 boundary list replaces the placeholder payam codes.** Two cases.

- _Renamed, same codes_ (names change, codes stay): nothing breaks. Farmers
  reference payams by code, and `locations:reseed` updates names in place
  (C-2.6).
- _Replaced, new codes_: every farmer references its payam, county and state
  by the old codes, with composite keys enforcing agreement. The reseed
  **refuses** to remove a payam that farmers depend on and names it (C-2.7) —
  which is the intended outcome, not a defect. What then has to be re-pointed,
  in one migration written for that day, old code → new code: `farmer.payam_id`,
  `.county_id`, `.state_id`; `officer.payam_id`, `.state_id`;
  `directory_entry.payam_id`, `.state_id`; `farmer_number_counter.county_id`.
  Farmer numbers are **not** re-pointed: an existing `CE-JUB-000123` keeps its
  old prefix by design, and new registrations in the renamed county take the
  new prefix from a fresh counter row — one county, two prefixes over time,
  both valid, both unique. The location bundle's version changes and every
  device re-downloads it (C-2.5).

**Who sees the national id.** Administrators and the officer who registered
the farmer. For supervisors and read-only users the key is absent, not
masked. Data model open question 2, chosen narrow; `docs/DECISIONS.md`.

**Run 5, 2026-09-05, under both fixes (connect timeout, pool size, the
idle-transaction guard in `audited()` and the two role settings).** 19 of 23
files, 425 of 450 tests. `tests/farmers.test.ts` ran all 31: the
**1,000-allocation lock test passed** (1,000 distinct, contiguous values,
ten transactions in flight on the transaction pooler) and **both halves of
the C-5.13 scan passed** (every error status scanned; a 500 whose underlying
error carried a fabricated name, phone and id sent the fixed sentence). The
one farmer failure was the route-throughput test: 100 registrations did not
fit in five minutes from this machine and it is now 50. The other three: a
test of the idle-timeout guard that read the wrong column and assumed the
role default was still zero (fixed), and two files plus one audit test that
could not get a connection from the **session pooler** for some minutes after
the concurrency tests — the transaction pooler kept answering. That is the
next thing to change, in the CI unit: test clients should use the transaction
pooler like the app does, and keep the session pooler for migrations.

**Known conditions from this unit.**

- Each run of `tests/farmers.test.ts` appends roughly 250 permanent rows to
  `audit_event` (two per registration; the 100-registration test alone is
  200). The audit table is append-only by law; the growth is fabricated data in
  staging and is recorded here so nobody is surprised by it. The 1,000-value
  lock test allocates on a test county that the sweep removes, so it grows
  nothing.
- `prisma migrate diff` against staging has always reported hand-written
  foreign keys Prisma cannot express (deferrable, and `deleted_by` keys added by
  `ALTER TABLE`). B5's only line in that output is the deferrable consent key,
  which is intended. `migrate status` is the gate; `migrate diff` is noise
  until Prisma can say "deferrable".
- `pnpm farmers:seed` writes twelve fabricated farmers (family name
  `Placeholder`) and **requires one active officer in a placeholder payam** to
  be the registering officer, and never a `zztest` one. It refuses otherwise,
  with instructions. Its first run on staging (2026-09-05) coincided with a
  test run and picked a test officer; the twelve rows were removed by hand the
  same minute — hard-deleted, confirmed by counting the base table — and the
  script now excludes test officers, tested in both directions by
  `tests/farmers-seed.test.ts` (not yet run: see the pooler finding). Twenty-four
  `system` audit rows from that run remain, append-only, none carrying a name. No permanent officer account
  exists on staging yet; run the seed after the first real one is created.

## KNOWN CONDITION — LOCAL GITLEAKS IS BLIND ON AN APPLE-SILICON MACHINE (2026-09-05)

The x86_64 gitleaks build under Rosetta cannot invoke `git` on this machine
(`xcrun` cannot load its library), so `gitleaks git .` reports **"0 commits
scanned, no leaks found"** — a clean result that checked nothing. Four such
"clean" scans were believed on 2026-09-05 while CI failed the secret scan on
every push of the B5 branch. The filesystem mode (`gitleaks dir`) works and
found the two findings in seconds. **A local git-mode result on this machine
is not evidence; use `gitleaks dir` on a `git archive` export of tracked
files, or the arm64 build.** CI's scan is the gate and always was.

The two findings were the documented connection-string shapes in
`.env.example`, written as a full connection URL with a placeholder user and
password, which match the repository's own rule for a Postgres URL with a
password. Placeholders, but
the scan has no allowlist by law, so the text was reworded to describe the
query string rather than resemble a credential. No rule changed.

## B5.5 — CI RUNS THE DATABASE TESTS AGAINST STAGING (2026-09-05)

**The finding.** From B2 to B5 every CI run skipped every database test file
and reported green: the files skipped themselves when the variables were
absent, and CI had no secrets. B3's authorization matrix and B4's audit
proofs never ran anywhere but one laptop. `docs/DECISIONS.md`, _CI's green
was a lie about eight files_.

**What changed.** The guard fails loudly, naming the missing variable; test
clients and scripts use the transaction pooler; a session-level advisory lock
in `vitest.global-setup.ts` makes runs one at a time wherever they start; the
workflow runs on pull requests and merges to main only, with a 40-minute job
timeout, and maps five repository secrets onto the names the code expects.

**The five GitHub repository secrets, set by the user** (values are
staging's; the test helpers refuse any project but staging by reference):

| Secret name                         | Becomes                         |
| ----------------------------------- | ------------------------------- |
| `STAGING_DATABASE_URL`              | `DATABASE_URL`                  |
| `STAGING_DIRECT_URL`                | `DIRECT_URL`                    |
| `STAGING_SUPABASE_URL`              | `NEXT_PUBLIC_SUPABASE_URL`      |
| `STAGING_SUPABASE_ANON_KEY`         | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY`     |

Both connection strings carry `connect_timeout=30`; the vitest config adds it
anyway if absent.

**Projected across the backend, recorded so nobody is surprised by the
numbers later.** At two runs per unit — one on the pull request, one on the
merge — B6 through B11 is roughly twelve more runs: about 3,000 further
audit rows and 13,000 counter values on staging before the backend is done.
Fine on staging; production is born clean at B11.

**Accepted cost per run**, recorded so it is expected: about 250 permanent
`audit_event` rows, about 1,100 farmer-number counter values on the test
county and about 110 on Juba county, about ten authentication accounts
created and deleted. The test county and its counter row are removed by the
sweep; the audit rows and Juba's counter values are permanent by design.

**What no CI run has yet proven.** B2, B3 and B4's database proofs — the
location tests, the 85-cell authorization matrix, the scope tests, the audit
tests — and B5's farmer suite have run on one laptop and never in CI. B5.5
does not retroactively prove them. The first CI database run covers whatever
exists at that point; until a full CI run passes over them, those proofs
remain single-run local evidence. **First passing CI database run: 2026-09-05, workflow run 33941608043 on
pull request #33 — 23 of 23 files, every database test included, in 19
minutes 26 seconds on a GitHub-hosted runner, every step green including the
secret scan.** From that run onward B2, B3, B4 and B5's proofs have run in CI;
what they prove is what existed at that head.

**Proven on 2026-09-05, both directions each.** The guard: a run with one
blank variable refused in one second, naming it. The lock: a second run
while one held staging was refused in three seconds naming the holder; a
third after the release proceeded. The new client: the audit file 28 of 28
on the transaction pooler, and 50 of 50 registrations at five in flight.

**The lock's first real collision, 2026-09-05 07:50 UTC.** Merging #33
triggered CI's run on main, which held staging; a local `pnpm test` started
two minutes later refused in seconds, naming `agri-erp-tests:33953566862`.
That is the case the workflow's concurrency group could never see, and it is
the reason the lock is in the database. The reverse happened the same day:
a local probe held staging while CI's run on #35 began, and CI refused,
naming `agri-erp-tests:monkonmlah`; it was re-run once the local run ended.
A CI failure whose message names another run is not a failure of the code.

**Held connections die under the pooler, and the guards now say so
(2026-09-05, B7's runs).** Twice in one run a connection the app's client
was holding was closed by the pooler: once discovered after a ten-minute
wait ending in `P1017 Server has closed the connection`, the length of the
operating system's retransmit limit on a dead socket; once as `25P03
terminating connection due to idle-in-transaction timeout`, which is the
B6 guard ending a registration transaction that had sat idle for thirty
seconds because its client was stalled. Before the guards, the second case
would have been a county counter row held until someone noticed. The tests
that hit it fail; the same suite passes on CI's runner, four runs of four,
in twenty to thirty minutes. Nothing in the code is implicated.

Two full runs on this machine then stalled between files for hours with the
database idle and the process at zero CPU — the shape a sweep of fifteen
statements takes when every connection in the pool is dead and each waits
its ten minutes. Prisma does not validate a pooled connection before reuse
and exposes no keepalive. Both runs were killed and their lock sessions
terminated. B7's own file passed alone in ten minutes; CI's runner, which
has never shown this, is the full-suite arbiter for B7.

**Recorded as an incident, not diagnosed further, on the user's decision.**
The pooler's own logs would name the cause and are **unexamined**: they are
reachable only through the Supabase MCP server, whose token had expired, and
a token that can read the project is a standing cost for a one-off answer.
The diagnosis in hand — `P1017`, "server has closed the connection", a
ten-minute delay matching a dead-socket TCP retransmit — was judged
sufficient. If it recurs, the logs are the first thing to read, with a token
issued for that purpose and revoked after.

**Recurred 2026-09-07, during B8's local run — the third unit.** The visits
file, nineteen tests with real uploads to Storage, stalled on its last test
705 seconds before vitest cut it; the same test passed alone in under a
minute, and the probe run during the stall could not get a connection at
all. The shape is the one above; nothing new was learned and nothing was
changed. **Frequency, for the record rather than memory:** B5's runs
(abandoned transactions holding the counter row, 2026-09-05), B7's runs
(dead pooled connections, 2026-09-05), B8's run (2026-09-07). Three units of
three whose local suites ran long enough to meet it; CI's runner has met it
in none of its runs. CI remains the arbiter.

**If a run is killed, the lock may outlive it.** The pooler keeps a server
session after its client is killed (seen 2026-09-05: a killed local run held
the lock for an hour; the next run refused, naming it). The setup's message
says what to do: with no test process alive on the machine that started it,
terminate that session — `pg_stat_activity` rows whose `application_name`
begins `agri-erp-tests:` holding an advisory lock — and run again. Never
terminate one while a run that could own it is alive somewhere.

**The suite's run time varies by half, and the timeout is set for the fast
half (2026-09-07).** The same code, the same runner class, the same staging:
one run of the #38 suite took 26 minutes and the previous one was cancelled
at 40, the workflow timeout, with half its files still to go — not stalled,
still completing files at the moment it was cut. The last green B7 run had
eighty seconds to spare. The 40-minute timeout was set at B5.5, before B6
and B7 added their database files (about fifteen minutes between them on a
slow run); the farmer file alone is eleven, most of it the two concurrency
proofs. B8, B9 and B10 each add a file. So the timeout will be crossed on a
slow day, and a red from it says nothing about the code. **Decided
2026-09-07, by the owner:** the timeout is 60 minutes; the concurrency proofs
are not shrunk. The reasoning is in `docs/DECISIONS.md`, the third CI edit.
A run cancelled by the timeout while still completing files is re-run, not
investigated. The first run under the new timeout, the one that gated #38's
merge, took 42 minutes and passed; the old timeout would have cut it.

**The sixty-minute ceiling crossed (2026-09-08).** #44's rebased run was cut
at sixty minutes with nine files still to go, every file about sixty percent
slower than the same files on the green run of that morning (visits 10.5
minutes against 6.5; farmers likewise). The re-run was cut at the same file
with a minute-for-minute identical timeline. **The mechanism, measured rather
than guessed:** staging's tables are tiny (the audit log, the largest, has
fifteen thousand rows), no session is idle in transaction, and a count over
the repaired views returns in the same time as a bare `select 1`. Every query
is fast; every round trip is slow. The suite is thousands of small sequential
queries, so its duration is set by where GitHub places the runner relative to
Frankfurt — a lottery we do not draw. The morning's runner was close enough
for forty-one minutes; the evening's two were not close enough for sixty.
Four runs have now been cut by a timeout, at two ceilings, all still
completing files. **Decision pending with the owner:** ninety minutes (a
fourth CI edit, covering the far placement for the suite at its size and a
few more units), or a change of shape — files owning their fixtures so they
run in parallel and divide the round trips, or a self-hosted runner near the
database (infrastructure, and a paid service) — which is a unit, not a line.
**Decided 2026-09-09:** ninety minutes (the fourth CI edit, DECISIONS). The
alternative is sized below.

## THE SHAPE OF THE ALTERNATIVE TO THE CEILING (2026-09-09, sized, not built)

The suite is 775 tests in 34 files, run serially because every file sweeps
the shared test prefix in its setup, against a database in Frankfurt from a
runner GitHub places where it will. Two directions, priced.

**Per-run isolation, so files run in parallel.** The prefix, the test family
name and the test location code become run-scoped in the helper; each file's
sweep removes only its run's rows; a scheduled cleanup (a fifth CI edit and a
new script) removes anything a day old; about eighteen database test files
change their constants and phone ranges; vitest runs two projects — a
parallel one, and a serial one for the five files that do global things no
prefix isolates (verification's check constraint on the audit table, farms'
constraints, reporting's disabled trigger, the locations reseed, the farmers
seed). **Three to four days:** half for helper and config, half across the
files, two to three for the parallel run failing in ways the serial run never
showed. **Risk medium to high, and specific:** four workers creating
principals through Supabase Auth at once is the strain already seen,
multiplied; forty client connections on fifteen server connections is the
dead-pooled-connection incident's neighbourhood; the farmer-number counter
lock becomes contended across files. **Gain:** the suite is round-trip bound,
so four workers divide the wait — a forty-minute near run to perhaps fifteen,
a sixty-plus far run to perhaps twenty-five.

**Geography.** A staging project nearer the runners: half a day, low
technical risk, and wrong — it moves staging away from where production will
be, and South Sudan is nearer Frankfurt than Virginia, so staging would stop
being production-like in exactly the latency the field will feel. Not to be
done. A self-hosted runner near Frankfurt: a small machine, a day to set up,
ongoing maintenance, a paid service under CORWADO's name (never ours). Low
technical risk, real organisational cost, for twenty minutes a run.

**The answer given, 2026-09-09: neither before the backend ends.** Ninety
minutes covers the far placement for B11 and the two small follow-ups.
Per-run isolation is the right change and is half-scoped, but its cost is in
the risk column, and three days of debugging parallel Auth calls before the
last backend unit is the wrong order. It is the first unit after B11. If the
suite is cut again before B11 lands, that is the signal to pull it forward,
not to raise the ceiling a fifth time.

**If a run is killed** its rows
are swept by the next run's setup, and its authentication accounts are
removed when that sweep finds their rows. A run that finds the lock held
fails at once and names the holder and how long it has run.

## B6 — VERIFICATION, REJECTION, MERGING AND ESCALATION (2026-09-05)

**What exists.** Migration 11: `verification_event`, `merged` as a fourth
state, `pending_since` as the escalation clock guarded by the
immutable-fields trigger, queue indexes, `farmer_verified_v`, four audit
keys, and a reason-code CHECK generated from `REJECTION_REASONS` in
`packages/shared` and checked equal to it. One state-machine module. Five
routes: verify, reject, merge, resubmit, and the queue. CONVENTIONS §12.

**Migration 12** recreates `farmer_active`: a `SELECT *` view freezes its
columns at creation, and migration 11's `pending_since` was not in it until
then. Every farmer query failed in B6's first run. The rule and the guard —
`tests/views-track-tables.test.ts`, every active view against its table, both
directions — are in `docs/DECISIONS.md`.

**Merged as #34 on 2026-09-05; CI's run on the pull request: 27 of 27 files in
32 minutes. B6 is complete.**

**Run 2, 2026-09-05, from this machine, alone on staging under the lock: 27
of 27 files, 544 of 544 tests.** Every C-6 criterion's test passed in that
run, including every transition not in the table refused through a route,
the atomic decision, the extended scan, and the view-tracking test. Run 1
had failed on the stale view, the sweep's foreign-key order and two
test-side faults, all recorded above and in `docs/DECISIONS.md`.

**The rejection note.** Data, not a message: returned inside the farmer
record as `rejection` while the record is rejected, to whoever may read the
record; never in an error, a warning, the audit log or error reporting; its
field name is on the audit never-recorded list and the scrubber key list; the
C-5.13 scan now searches for it too (`tests/helpers/scan.ts`). The standing
rule is in `docs/DECISIONS.md`.

**Reach figures read `farmer_verified_v` and nothing else.** B10 is bound by
this. Pending, rejected and merged are counted separately, never folded in.

**Nothing pending is stuck.** A pending record is decided by a supervisor of
its state or an administrator, never by the registering officer, so a record
whose officer has left is decidable. Only resubmission needs the officer; a
rejected record whose officer is gone stays rejected, out of the queue,
until an administrator reassigns it — a later decision.

## A CLASS OF FAULT, NAMED: A GATE THAT REPORTS SUCCESS BECAUSE IT CHECKS NOTHING

Three instances so far, each found by accident. Named so the next is looked
for rather than stumbled on.

1. **`tests/` outside the typecheck gate** (B1.1 to B4): `pnpm typecheck` was
   green while never reading the test files. Found by B4; two latent defects
   in tests came out when it did.
2. **Eight database test files silently skipped in CI** (B2 to B5.5): every
   file skipped itself when the variables were absent, CI had none, and every
   run reported green for tests that never ran. Found in B5; closed by B5.5
   with a guard that fails loudly.
3. **Local gitleaks on an Apple-silicon machine** (2026-09-05): the x86 build
   could not run git and reported "0 commits scanned, no leaks found". Four
   such results were believed in one day.

4. **Four foreign keys recorded as pending and never checked** (B3 to B6):
   deferred in B2 "until B3 adds the constraint", restated as owed in B3's
   handoff, as "landing next" in B4, as owed again in B5, and found still
   missing on 2026-09-05 by asking the database catalogue. **The distinction:**
   the first three were gates reporting success while checking nothing; this
   was a record asserting a fact that nobody verified against the system. Not
   a gate at all, but the same shape of false confidence, and it survived
   three units because each session read the previous session's record and
   believed it.

**The question to ask of any green gate: what did it actually read?** Its
companion, from the fourth instance: **when the record says something was
done or is pending, ask the system rather than the record.** A migration
folder, a catalogue query, a live route — not a sentence in a document.

## A GUARD THAT CAUGHT ITS AUTHOR AND THEN CAUGHT ITSELF (2026-09-11)

`tests/pure-suite-complete.test.ts`, written for the fifth CI edit, is the
first gate in this project that found a defect in the change it was written to
protect, and then found one in itself. That is the shape the eight
silent-gates findings were missing, and it is worth stating what makes it work.

**What it asserts, and this is enforced rather than remembered:** every test
file in the repository that touches no database is one the pure suite runs. It
walks the tree, reads each test file, decides whether it reaches the database
(by the helpers `makeTestPrisma` and `requireTestEnv`, or `new PrismaClient`),
and fails if a pure file is not matched by the pure config's include patterns.
It asserts the reverse too — that nothing the pure config claims reaches the
database, which would fail on a machine with no staging — and it asserts the
walk itself found files at all, because a walk that silently finds nothing
makes every other assertion in the file vacuously true.

**So: anyone adding a test that needs no database does not have to remember to
add it to the pure suite. The suite goes red until they do, and names the
file.** Nobody has to notice.

**What it caught on its first run.** Three pure test files under
`apps/web/lib` — the admin data layer's and two farmer ones — which its author
had left out of the pure config while believing the five files under
`apps/web/tests` were the whole set. The config was widened to all of
`apps/web`.

**And then it caught itself.** Its impurity check was one regular expression
containing `new PrismaClient` as a literal, and that literal appears in its own
source, so the guard read itself as a database test and failed its own second
assertion. The pattern is now assembled from fragments with a comment saying
why. **A guard written as a literal scan of source files must not be written in
a way that matches itself** — trivial once seen, invisible until the guard runs.

**Why this one worked when eight others did not.** It asserts a RELATIONSHIP
between two things that can drift apart — the files on disk and the config's
patterns — rather than a fact about one of them. The eight silent gates were
each a single statement believed true: the typecheck covers `tests/`, the
scanner reads the branch, the column is written. A gate that compares two
sources cannot be quietly wrong about both at once.

## PUSHING WHILE A RUN IS QUEUED CANCELS IT — A RULE, NOT AN OBSERVATION (2026-09-11)

The workflow's concurrency group is `staging-tests` with `cancel-in-progress`
false, which queues runs rather than cancelling the running one. **But only one
run may be PENDING in a group: a newer pending run evicts the older one.** So a
push while one run is executing and another is waiting discards the waiting
one, with no annotation and nothing in the pull request to say why the check
vanished.

**Three evictions in one session on 2026-09-11** — #52's queued run, then the
runs for #57, #58 and #59 — all caused by this assistant pushing while a run
was queued. **The rule, at the owner's instruction: do not push while a run is
queued.** Check `gh run list` first; if something must be pushed, say so and
wait for the owner rather than have a run cancelled. The cost of an eviction is
a whole run of the suite, 45 to 90 minutes, and the first symptom is a check
that is simply absent.

_The alternative is removing the concurrency group, which the advisory lock
makes survivable: a second run would fail fast naming the holder, which is
noisy but never silent. Not taken — the group's queueing is worth more than the
noise it prevents, now that the eviction is known and the rule is written._

## HOW TO TELL A GATE THAT CAN FAIL FROM ONE THAT CANNOT — THE COMPANION QUESTION (2026-09-11)

The seams list below asks where two rules touch. This asks the same kind of
question one level down, about gates, and it is a design principle rather than
a fact about any one of them:

> **A gate that compares two sources which can drift apart cannot be quietly
> wrong about both at once. A gate that asserts a single fact can be quietly
> wrong the moment the fact stops being true.**

**Every silent finding in this project was single-source.** Set out plainly,
because the pattern is only visible in the list:

| The gate                | The single fact it asserted          | How it was false                      |
| ----------------------- | ------------------------------------ | ------------------------------------- |
| `pnpm typecheck`        | it covers `tests/`                   | the directory was outside the project |
| CI's test step          | it runs the database files           | all eight skipped themselves silently |
| local gitleaks          | it scanned the branch                | the x86 build could not run git       |
| four foreign keys       | the record said pending              | nobody asked the catalogue            |
| the drift test          | it matches CONVENTIONS               | the formatter re-padded the table     |
| the view test           | views equal their tables             | an aggregate view is not a table      |
| `audit_event.device_id` | the law says it is recorded          | no request ever sent one              |
| `updated_at`            | it is current                        | no trigger and no route wrote it      |
| the cookie session path | sign-in writes the cookie            | no sign-in was ever built             |
| the audit action CHECK  | it is generated from `AUDIT_ACTIONS` | a person retypes it by hand           |

Ten gates now. The last two rows were added on 2026-09-13 and have their own
sections below: the cookie path is the **tenth** instance and the largest in the
project, and the audit CHECK is the **eleventh**.

Eight gates, eight statements believed true, all quietly false. The ninth
finding broke the pattern in one direction — two correct rules meeting, which
is the seams list — and `tests/pure-suite-complete.test.ts` broke it in the
other: **the first gate in this project that compares.** It holds the files on
disk against a config's patterns, two sources that move independently, and it
found a defect in the change it was written for and then one in itself.

**THE QUESTION TO ASK OF ANY GATE BEING WRITTEN:**

1. **Does it compare two things that can move independently, or does it assert
   one thing?**
2. **If it asserts one thing: what makes it fail when that thing stops being
   true?** If the answer is "someone would notice", it is not a gate.

A gate that compares needs no vigilance: the two sources drift and it goes red
by itself. A single-fact gate needs a person to remember, and the record of
this project is eight demonstrations that nobody does.

**THE STRONGEST DEMONSTRATION YET, AND IT WAS A NEAR MISS (2026-09-19, #93).**
Two migrations rebuilt the same audit CHECK. B12's is dated `20260915120000`
and adds three `weather_location.*` keys; #95's is dated `20260917120000` and
rebuilt the constraint from a list that did not contain them. A CHECK can only
be replaced, never extended, so on a **fresh** database the later one silently
dropped all three, and **every B12 weather route would have failed on its audit
insert — on production at B11**, discovered by a weather write failing in the
field.

**Staging could not have caught it, by construction.** Staging had both
migrations applied in the order they were written, so its constraint carried the
weather key and everything worked. **A database only ever sees one migration
order — the one it happened to receive — so it can never tell you what a
different order produces.** A fresh database is the only place the fault exists,
and B11 is the first fresh database this project will ever create.

**This is the argument in its clearest form.** A single-fact gate here would
have compared `AUDIT_ACTIONS` to the live staging CHECK, found them equal, and
passed — `tests/audit-actions-constraint.test.ts` does exactly that and was
green throughout. What caught it was
`packages/shared/tests/audit-check-matches-migrations`, which compares the
constant against **the migrations as text, in folder order**, and asserts that
no migration narrows what an earlier one allowed. It reads no database, so it
cannot be fooled by the one order that happens to work.

That test was written after the eleventh instance, to catch a thing that had
not yet happened a second time. It then caught it. **The eleventh instance's own
fix working is the best evidence in this project that the gate principle pays
for itself** — and worth remembering the next time a comparing gate looks like
more work than asserting the fact.

**A WORKED EXAMPLE FROM A PLACE NOBODY WOULD THINK TO PUT A GATE (2026-09-14).**
The edit scripts this project uses to change documents are written as:

```python
def sub(old, new, label):
    assert s.count(old) == 1, f"{label}: {s.count(old)}"
    s = s.replace(old, new)
# ... every anchor substituted ...
p.write_text(s)      # the file is written ONLY after all of them matched
```

**That is a gate that compares.** Two sources that move independently — the
anchor text a session believes is in the file, and the text actually in the
file — checked against each other, with the count as the comparison. It has now
fired twice in one day, both times on a Markdown table row whose padding the
formatter had changed, and both times it named the anchor and wrote nothing.

**Why it belongs beside the principle rather than in the formatter note.** The
alternative is what every naive edit script does: `s.replace(old, new)` and
write. That is a single-fact gate of the worst kind — it asserts "this text is
present", is silently false the moment the formatter reflows, and **reports
success having changed nothing.** The first pattern, in a tool, with no output
to reveal it. The `assert count == 1` version cannot be quietly wrong, because
zero and two are both loud.

**Two properties worth copying into any scripted edit.** It is a **comparison**,
not an assertion. And it is **atomic**: the write happens after every anchor has
matched, so a partial application is impossible and the file is never left in a
state no one intended.

_Worked examples of turning one into the other, from this repository:_ the view
test compares the view catalogue against the table catalogue rather than
asserting a list of views; ~~the audit-action CHECK is generated from
`AUDIT_ACTIONS` so the database and the code cannot disagree~~ — **struck
2026-09-13: this was never true, and it stood here as one of four exemplars of a
gate that compares while being the one that was not.** Nothing compares them.
The generation is a person retyping, which is the eleventh instance below. The
accuracy CHECK is generated from the shared thresholds and that one is real; the
conventions drift test parses cells against exported constants. Each of those
is a comparison. The ones that bit were not.

**THE PRINCIPLE DEMONSTRATED RATHER THAN ARGUED (2026-09-11).** The pure suite
ran 23 files on a developer's machine and **20 files on CI the same day**. The
difference is the three test files under `apps/web/lib` that arrived with #49
and #50 and left with their reverts. **Nobody edited the pure config, and
nothing went red.** The guard globs the disk and compares what it finds against
the config's patterns, so a set of files that changed underneath it was simply
described correctly on both machines.

A single-fact gate — "the pure suite runs these 23 files" — would have been
false the moment the reverts landed, and false in the silent direction: still
green, now running less than it claimed. That is the whole of the difference,
in one observation, and it is why the question is worth asking of every gate
before it is written.

_The measured saving on the same day, for scale:_ main's full-path run after
the CI edit merged took **52 minutes** in its test step; #56, documents only,
took **4 seconds** on the short path and reported `verify: pass` like any other
check.

## THE FORMATTER HAS SILENTLY CHANGED A DOCUMENT TWICE (2026-09-11)

Two instances, recorded as a pair because one alone reads as an accident.

**First, the CONVENTIONS tables.** Prettier re-padded the Markdown table
columns in `docs/api/CONVENTIONS.md`, and the drift test that matches those
rows against the code stopped matching. Fixed by making the test parse the
cells rather than the line.

**Second, two open items absorbed into the item above them (2026-09-11).** Two
entries added to the open-items list in this file — the contact question and
the Actions minutes — were written with a leading indent, and the formatter
folded them into the preceding numbered item. They rendered as part of item 5
and item 9 and were not items at all. Nobody was counting them, so nothing
went red; they were simply not there as entries, and a session reading the list
for "what is open" would have read past them inside another item's prose.

**The shape.** The formatter is not wrong. It is doing what a prose formatter
does. **But a document read by a machine, or read structurally by a session, is
data, and a reflow that is cosmetic in prose is a change in a numbered list
something counts.** The failure is never in the formatter and never in the
document; it is that one of them was treated as prose and the other as
structure.

**What in `docs/` is read structurally, and what protects it.**

| Document                                   | Read by                                   | Protected?                        |
| ------------------------------------------ | ----------------------------------------- | --------------------------------- |
| `CLAUDE.md`                                | every session, as law                     | **yes** — in `.prettierignore`    |
| `scope-and-acceptance.md`                  | sessions; derives from the signed report  | **yes** — in `.prettierignore`    |
| `data-model.md`, `data-model-extension.md` | sessions; supplied documents              | **yes** — in `.prettierignore`    |
| `api/CONVENTIONS.md`                       | **two tests**, by table row               | **no** — formatted on every write |
| `PROJECT-STATE.md`                         | sessions, by numbered list and by section | **no**                            |
| `DECISIONS.md`, `HANDOFF.md`, `UNITS.md`   | sessions, by board row and section        | **no**                            |
| `RUNBOOK-restore.md`                       | a CORWADO administrator, by numbered step | **no**                            |

So the one document a **test** reads is the one document not protected, and the
four a session reads for state are not protected either. The reason
`.prettierignore` covers what it covers is sound and stated in the file itself
— those four are contractual or supplied, and reformatting a contractual
document by tool is how a wording change happens unnoticed. The gap is that
"read by a machine" was never the criterion.

**Not changed here, because it is a decision with a cost either way.** Adding
`CONVENTIONS.md` to the ignore list protects the tests' input and gives up
consistent formatting on the document most often edited by hand. Leaving it out
keeps the formatting and keeps the exposure, which the drift test now absorbs
because it parses cells. The four state documents are a different question: a
session reading them is more robust than a test, but the second instance shows
it is not robust to an item vanishing into another. **Put to the owner rather
than decided.**

_Checked 2026-09-11: prettier makes no change to `CONVENTIONS.md` as it stands
today, so nothing is pending; and `docs/data/locations.csv`, named by the
reseed script, does not exist — the locations arrive as a bundle instead — so
no CSV is exposed._

## READ A DOCUMENT AS ITS RECIPIENT BEFORE IT GOES (2026-09-14)

**THE USABLE FORM, FIRST, BECAUSE IT IS WORTH MORE THAN THE PRINCIPLE IT CAME
FROM:**

> **Where a second session is available, use one.** That is B1.4's mechanism and
> it remains the stronger version.
>
> **Where one is not, name the recipient and read as them — and ask "what will
> they ask for that is not here?", not "is this correct?"**
>
> **The author can always answer the second question and never the first.** That
> is the whole of it: the first question tests the document against the author's
> model of it, which is the one part already known to be consistent.

It found three faults in a document that was finished, committed and correct on
the facts. The rest of this entry is where it came from and why it works.

**Recorded because it caught three things in one reading and none of them were
visible to the author.**

The Bird support request was finished, committed, and correct on the facts. Read
straight through as the vendor's support desk would read it rather than as the
person who assembled it, three faults appeared:

1. **A gap in an evidence table.** The retry's row said _"(retry at
   05:41:33Z)"_ with no message id. **A gap in an evidence table invites the
   reply that asks for it** — one round trip bought nothing, on a request whose
   whole purpose is to get a substantive answer rather than an acknowledgement.
2. **A point made twice, three lines apart.** The sender comparison appeared
   once in passing and once as the deliberate argument. **The passing mention
   weakened the deliberate one** by making it look like repetition rather than
   the case.
3. **A subject line that would be routed wrongly** (owner's catch). It read as
   a Liberia delivery complaint, so it would have been triaged as one. It now
   leads with the question we actually need answered — what an approved sender
   registration guarantees — because **the subject decides which desk reads it,
   and that decides what kind of answer comes back.**

**The generalisation.** A document written to persuade or to extract an answer
has a reader whose interests are not the author's. The author knows what every
sentence is for, which is exactly what stops them seeing a gap, a repetition or
a mis-framing. **So the last pass on anything that leaves this project is a read
as its recipient**: a vendor's support desk, a client, the next session, an
auditor. Ask what this reader will do with it, and what they will ask for that
is missing.

**It is the same move as the whole silent-findings class, applied to prose.**
Every gate in that list failed because it was read by the person who knew what
it was supposed to do. **The check that works is the one performed by, or on
behalf of, someone who does not.**

### AND IT IS B1.4's RULE, ARRIVED AT FROM THE OTHER END

**This is not a new idea. It is one this project already holds, discovered
independently a second time — which is worth more than either instance alone.**

`docs/DECISIONS.md`, **B1.4 — the document must not be able to drift from the
code**, states it about code:

> _"Two people who cannot read code run this project. The substitute for a
> second pair of eyes is that a separate session, which has never seen the
> implementation, writes tests from `docs/api/CONVENTIONS.md` alone."_

**Same principle, opposite starting point.** B1.4 reasoned from a constraint —
nobody here can review the code — to a method: have it verified by someone who
does not share the author's knowledge. This section reasoned from an accident —
three faults in a finished document became visible the moment it was read as its
recipient — to the same method.

> **A check performed by someone who shares the author's knowledge is not a
> check. It confirms the author's model of the thing, which is the one part
> already known to be consistent.**

**The two together cover the project's whole output.** B1.4 applies it to code
and to the documents tests are written from; reading as the recipient applies it
to everything else that leaves — a vendor request, a client paragraph, a handoff
entry, a record a future session will act on. Neither is a rule about care.
**Both are about who is doing the looking**, because care is what the author
already brought and it was not enough in any of the twelve instances in this
document.

## A THIRD FORMATTER INSTANCE, AND NOW A RULE ABOUT EDITING TABLES (2026-09-14)

**Two was a pair. Three is a rule.** The formatter has now silently defeated
work three times, and twice in the same specific way.

1. **2026-09-11:** Prettier re-padded the CONVENTIONS tables and the drift test
   stopped matching.
2. **2026-09-11:** Prettier folded two new open items into the item above them,
   so they rendered inside another entry's prose.
3. **2026-09-14:** Prettier padded a Markdown table's columns, and a scripted
   edit that anchored on **a table row** found zero matches and did nothing. The
   commit that depended on it was written as though the edit had landed, so its
   message described a change that was not in the tree until it was amended a
   minute later.

**What the second and third have in common is the shape worth naming:** a table
row is the **least stable string in a formatted document**. Its content is
stable; its whitespace is not, and the whitespace changes whenever any other row
in the same table changes width. An anchor that includes column padding is an
anchor on a value that something else is entitled to rewrite.

> **THE RULE. Never anchor a scripted edit on a Markdown table row.** Anchor on
> prose, on a heading, or on the line before the table. If a row itself must
> change, match it with a regular expression over its cell contents and let the
> whitespace be flexible — `\s*` between cells, never literal padding.

**And the practice that caught it, which matters more than the rule.** The edit
script asserted `count == 1` for every anchor and wrote the file only after all
of them matched. So the failure was loud and atomic: nothing was half-applied,
and the assertion named which anchor had failed. **A scripted edit that does not
assert its anchors is a silent formatter instance waiting to happen** — it would
have reported success having changed nothing, which is the first pattern again.

**The remaining exposure is unchanged and is recorded above:** `.prettierignore`
protects the contractual documents, and the state documents are still formatted,
which is correct — they are prose and should be. The rule here is about how a
session edits them, not about excluding them.

## A LAW IN A FILE ONLY GOVERNS SESSIONS THAT OPEN THE FILE (2026-09-15)

**The owner's sentence, and it is the useful fact from a red main.**

**What happened.** On 2026-09-14 the owner approved a line for `CLAUDE.md` §4:
_staging rows are the test suite's or the seed's, never hand-made._ It was
written, committed, and held on a branch. On **2026-09-15 at 07:48** a Lane 2
session created an officer named `Proof Officer (placeholder)` in staging by
hand, and at **08:07** registered a farmer against it. Neither row is prefixed
`zztest`, so the suite's sweep leaves them; `tests/reporting.test.ts` counts
state CE by hand from its fixture, found one pending farmer too many, and main
went red twice. **Same mechanism as #75, one day later, same lane.**

**The precision that matters — corrected the same day, because the first
version of this paragraph was wrong.** It said no file on main contained the
rule. **It did.** #75, Lane 2's pull request carrying the rule, was closed
unmerged — but the same HANDOFF entry reached main inside #79 at
**2026-09-14 21:23 UTC**, ten and a half hours before the officer row was made.
`docs/HANDOFF.md` is the one file every session is instructed to read before
any work. So the rule was on main, in the file sessions are told to open first,
written by the same lane that then broke it. **The owner's sentence stands, and
it is sharper than the first version made it:** a law in a file governs only the
sessions that open the file — and here the file was the one they are required
to open. What is not yet on main is the `CLAUDE.md` §4 line, which sits on a
held branch.

_The first version was written from #75's state without checking whether its
content had landed another way. Same fault as characterising the SMS account
from three of eight messages: the record was consulted instead of the system._

**What follows, in two parts.**

- **Landing matters more than writing.** The §4 line should go to main on its
  own, ahead of the code it shares a branch with. But this incident shows that
  landing is necessary and not sufficient: the rule was landed, in the required
  file, and was not followed.
- **A file is not enough for a rule about a shared resource.** `CLAUDE.md` and
  `HANDOFF.md` govern sessions that open them and act on what they read. A
  staging database is touched by sessions proving UI, by scripts, and by people
  in a hurry. The durable form is the one already used for `zztest`: **the
  resource itself refuses.** `farmers-seed-lib.mjs` refuses to register a
  placeholder farmer against a `zztest` officer; the equivalent for hand-made
  rows is a check the suite runs first — every officer and farmer in staging is
  either `zztest`-prefixed or came from the seed — that goes red naming the row,
  before the counting tests fail on it obliquely. Sized at about half an hour,
  not built. **After this incident it is the fix, not an option.**

**The row is Lane 2's to remove**, at the owner's request, since the auto-mode
guard refuses this session a `DELETE` on the shared database and Alieu ran the
last cleanup.

## THE ELABORATION FAILURE — THE SEAM BETWEEN THE OWNER'S JUDGEMENT AND A SESSION'S (2026-09-11)

Recorded beside the seams list because it is the same class of defect: the
failure is in a join, and neither half tests it.

**What happened.** The owner framed the marketplace's consent problem as
publishing a farmer's personal data, with re-consent in the field across payams
as the remedy. The framing was wrong — a listing carries a trading name, not a
legal name. **The session did not catch it. It elaborated it:** added the
consent table's versioning as supporting evidence, priced the field operation
in officer days and travel, called it the largest cost in the amendment, and
wrote it into three documents. The owner caught it a day later.

**Why the elaboration is worse than the error.** A vague wrong answer invites a
question. A wrong answer with a mechanism, a cost and three cross-references
reads as settled, and the next reader — including the next session — has no
reason to look again. **Confidence is the part that does the damage, and the
session supplied it.**

**Why the existing safeguard does not catch this.** CLAUDE.md §0's restate step
catches a session that has misunderstood, because restating a misunderstanding
exposes it. It does nothing when the session understands perfectly and agrees:
there is no disagreement to surface, and the restate reads back a faithful
version of a false premise. The same is true of every rule in §4 and §5 — they
constrain what a session may do, not what it may accept.

**What would catch it.** Nothing structural that exists today. The honest
statement of the gap:

- The restate step could be widened from "what I understand the task to be" to
  include **"what this assumes that I have not verified"** — here, that a
  listing carries a farmer's name, which the session never checked against what
  a listing was specified to hold, because the owner had said so.
- A session should treat a factual premise in an instruction the way it treats
  a premise in a document: **checkable, and checked when the cost of being
  wrong is high.** The drift-test false alarm of 2026-09-05 is the precedent —
  that premise came from the owner, was checked, and was false, and the record
  says so with attribution. That was the right behaviour. This was not, and the
  difference was only that the wrong premise arrived with authority about scope
  rather than about code.

**The asymmetry worth naming.** A session that questions too much is tiresome;
a session that elaborates a false premise is dangerous, and produces work that
looks more finished the more wrong it is. Of the two failure modes, the second
costs more, and this project has now seen one of each: the drift-test alarm,
where the question was right, and this, where it was not asked.

### THE SECOND INSTANCE, 2026-09-14 — AND THE AMENDMENT CAUGHT IT

**Recorded at the owner's instruction, in the owner's framing: "the pattern is
me, not the sessions."**

**What happened.** The instruction was to rename the SMS sender from
`Agrione_SS` to `CORWADO` before registering it, on two stated grounds: that
`Agrione_SS` "commits to a product name CORWADO never proposed", and that the
name "has failed twice on domain availability". Both are contradicted by this
repository's own record: `docs/DECISIONS.md`, 2026-09-13, sources to Alieu
relaying CORWADO that **CORWADO agreed on "AgriOne South Sudan" for this phase
and registered `agrionesouthsudan.com` to match**. The owner was working from
the earlier picture — two names had failed on availability and no third had been
chosen — and asserted it as current fact.

**WHAT IS DIFFERENT FROM THE FIRST INSTANCE, AND IT IS THE POINT OF RECORDING
IT.** The first time, the session did not catch a false premise; it elaborated
it, supplied a mechanism and a cost, and wrote it into three documents. This
time the session checked the premise against the record before acting, found the
contradiction, said so, and held the action. **The §0 amendment — restate "what
this brief assumes that you have not verified" — was written after the first
instance, and it is what caught the second.** One instance is not a trend, but
it is the first evidence that the amendment does work, and it worked on a
premise arriving with the owner's authority, which is the case §0 was widened
for.

**The rule that already covers it, and was written about the wrong party.**
`CLAUDE.md` §1 says: _"Chat history is not truth. Your memory of an earlier
session is not truth."_ That is addressed to a session. **It describes a human
holding a project in their head exactly as well.** The record moves faster than
anyone's memory of it — six documents changed in the two days before this
instruction — and the person most likely to be working from a superseded
picture is the one who has seen every version of it.

**So this is the same shape as the B1.3 finding recorded this week:** a rule
that exists, is sound, is applied diligently in one direction, and is not
applied where it equally belongs. There it was guards about guards. Here it is
the owner's own memory against the owner's own record.

**What follows, and it is small.** Nothing changes in §0 or §1; both already
say the right thing. What changes is where a session points them: **a factual
premise in an instruction is checkable against the record, and checking it is
not a challenge to authority.** The cost of asking is a sentence. The cost of
not asking, measured once already, was a mechanism, a price in officer days and
three documents that had to be corrected.

**Standing beside this:** the owner caught the first instance a day later, and
caught this one within the same exchange by accepting the correction and
recording it. The failure mode is not the error; it is an error that survives
because nobody checks. Neither of these did.

## A THIRD PATTERN: A CHECK POINTED AT THE WRONG THING (2026-09-11)

Two patterns are already recorded: a gate asserting a single fact, which can be
quietly false (the eight silent findings, and the companion question above);
and two correct rules meeting, where the defect lives in the join (the seams
list below). **This is a third, and it is distinct from both.**

> **A check that runs, passes, and tells you nothing about what changed.**

Not broken. Not silent. It executes, it reports honestly, and its subject is
not the thing under review.

**The instance.** The fifth CI edit gave documents-only pull requests a short
path and deliberately excluded `CLAUDE.md` from it. The reasoning was that the
law file deserves more scrutiny than an ordinary document. **That reasoning
fails on inspection: a database suite is not scrutiny of a document.** Nothing
in the full suite reads `CLAUDE.md`. #59 amended five lines of it and cost
**1h 5m 49s** across 37 test files and 830 tests, every one of them exercising
code that had not changed. The only real review of a law amendment is the owner
reading the wording, which had already happened before it was pushed. **The
exclusion bought a longer wait and no information.** Corrected in the sixth CI
edit, which is one line.

**THE QUESTION THIS PATTERN SUGGESTS:**

> **Does this check examine the thing that changed, or something adjacent to
> it?**

Adjacent is the dangerous word, because adjacency is what makes it feel
rigorous. A full suite on a documentation change feels careful. A green check
on 830 unrelated tests reads as "verified" to anyone glancing at the pull
request, and what it verifies is that the rest of the repository still works —
which was not in question.

**Where else to look for it in this project**, listed rather than assumed: the
Vercel preview build runs on documents-only pull requests too, and tells us
nothing about them; the gitleaks scan on a documents change is genuinely
relevant, because a document can carry a credential, so that one examines what
changed; and the typecheck, lint and format steps on a documents-only branch
are cheap and do examine the changed files. The full test suite was the only
one pointed elsewhere, and it was the expensive one.

**A SECOND INSTANCE, AND IT WAS THIS SESSION'S OWN (2026-09-13).** Recorded
because the source matters more than the defect.

Waiting for the CI queue to drain before pushing (the rule above), the session
wrote a watcher: poll `gh run list`, exit when nothing is in flight. Its
condition sent errors to `/dev/null`, so **a failed query produced empty output,
which is indistinguishable from "no runs in flight".** It announced a drained
queue during a network failure while a run was still going. The announcement was
caught only because the command after it printed the connection error, which
prompted a proper re-check that found the run still in progress.

**It was written roughly an hour after this section was written**, by the
session that wrote this section, and it is the third pattern exactly: a check
that ran, reported honestly on what it looked at, and looked at the wrong thing
— the absence of output rather than the state of the queue. Silencing errors is
the specific move that does it, because it converts every failure into the
success value.

**THE RULE, AND IT IS A RULE AND NOT AN OBSERVATION: ABSENCE OF A REPORT IS NOT
A REPORT.**

> **A watcher going quiet is not evidence.** A check that cannot distinguish _it
> failed_ from _there is nothing_ reports calm regardless of the weather.

**It happened twice in one session, by two different mechanisms**, which is what
makes it a rule rather than a bug:

1. **By network failure.** The watcher's condition sent errors to `/dev/null`,
   so a failed `gh` call produced empty output, which is the same value as an
   empty queue. It announced a drained queue while a run was still going.
2. **By the process being killed.** The replacement was stopped by the host for
   memory pressure. It simply never reported again. Nothing distinguished that
   from "still waiting", and the notification that arrived said the task had
   ended, not what the queue was doing.

**Why it belongs beside the third pattern, and what it shares with the first.**
The first pattern is a gate reporting success because it checks nothing: the
absence of a failure taken as success. This is the same mistake at the other
end — **the absence of a report taken as a report.** In both, nothing arrived
and nothing was the answer. The three patterns ask what a check examined; this
asks whether it examined anything at all, or is simply gone.

**What to do instead, concretely.** A waiter must report on every terminal
state, including its own failure, and the reader must verify rather than infer:
after any watcher goes quiet — finished, killed, or timed out — **query the
thing directly before acting on its silence.** That is what caught both
instances here. The rewritten `wait-runs.sh` separates query-failed, still
in-flight and drained, and says which.

**A third instance the same day happened in a gate rather than a watcher**, and
it has its own entry below — _A gate built to prevent the third pattern
exhibited the third pattern_ — because it pairs with the audit CHECK's
appearance in the list of worked examples and the pair says more than either.

**THE DECISION, WHICH MATTERS MORE THAN THE DEATHS.** Three watchers were killed
in one session: one by silencing its own errors, two by the host reclaiming
memory. After the third, **no fourth was armed.**

> **A mechanism that cannot survive the wait is not a mechanism.** Polling it
> again is the same mistake with more steps.

**Direct verification is now the rule for this project**, not a fallback: after
any watcher finishes, is killed, or times out, query the thing itself before
acting — `gh run list`, the catalogue, the migration table. Every one of the
three instances was caught that way and none was caught by a watcher. The
corrected `wait-runs.sh` is kept because separating query-failed from
still-in-flight from drained is right regardless, but **nothing is concluded
from its silence**, and a turn that ends with work held is preferred to a turn
that ends with work pushed on an inference.

**And the honest conclusion, unchanged: knowing a pattern does not stop you
writing it.** Three instances in one session, by the session that had just
recorded the pattern. That is the argument for gates that compare rather than
resolutions to be careful.

**A FOURTH INSTANCE, 2026-09-19, AND THE READER WAS THE FAULT THIS TIME.**
`pnpm schema:check` was run as `node scripts/schema-check.mjs 2>&1 | tail -3 ||
true` while `prisma/schema.prisma` was invalid. The script behaved perfectly:
it printed `schema:check could not read the database. Nothing was changed.` as
its FIRST line and exited 1. What `tail -3` kept was the last three lines of
Prisma's own output —

```
Prisma CLI Version : 6.19.3
```

— and `|| true` discarded the exit status. **A version banner was read as a
result.** The invalid schema went to CI, where `pnpm install` failed with five
P1012 errors and the whole Test step was skipped, so the constraint test that
run existed to check never ran at all.

**The rule at the level that generalises, and it has two halves.**

> **A check must produce a verdict, and a verdict must survive being read
> carelessly.** A check whose output can be truncated to something that looks
> like reassurance has not finished the job of reporting.

1. **For the reader:** never pipe a check through `tail`, `head` or `grep` and
   never append `|| true`. Both destroy the two things a check produces — the
   verdict and the exit status — and leave the vendor's footer, which always
   looks calm. Read the exit code; if the output is long, that is what the
   status is for.
2. **For the check:** print the verdict at BOTH ends. `schema-check.mjs` now
   repeats it as its last line so that whichever end a reader cuts to, they see
   the result and not a banner. Cheap, and it removes the reader's ability to
   get it wrong — which is the same move as B5.5's guard refusing loudly rather
   than skipping, and the same move as this section's own rule.

**What it shares with the first three.** Those were absences read as reports:
nothing arrived and nothing was the answer. This is the inversion — **something
arrived, it was not the answer, and it was read as one**. A banner is not an
absence; it is noise wearing the shape of a result, which is worse, because
silence at least invites a question.

**The three patterns together, as questions to ask of any check:**

1. Does it compare two things that can move independently, or assert one fact?
   _(and if it asserts: what makes it fail when the fact stops being true)_
2. Where do two rules touch, and has anything tested the seam?
3. Does it examine the thing that changed, or something adjacent to it?

## THE TENTH INSTANCE — THE FRONT END AND THE BACK END HAVE NEVER SPOKEN (2026-09-13)

**Found by Lane 2, verified from the code by Lane 1.** Alieu's landing plan
states it; every load-bearing claim in it was checked against the repository and
holds.

**What is true.** Forty-nine route handlers across thirty-two files, all passing
their tests. Twenty-nine pages, all building clean. **No browser has ever held a
session that `requireRole` would accept, so not one screen has shown a database
row and not one form has written one.** Everything anyone has seen, the client
included, is fixture data.

**The mechanism, stated exactly.** `requireRole` accepts two things: a bearer
token, for the officer application, or a Supabase session cookie, for the
portal. Nothing in the web application creates that cookie. There is no browser
Supabase client, no call that signs anyone in, and no middleware file, so no
session refresh either. The only Supabase imports outside tests are
`lib/api/require-role.ts` and `lib/supabase/admin.ts`, and both are server-only.
The role selector is a `localStorage` key defaulting to `admin`. The farmer
sign-in compares a fixture password in browser code and sets a cookie its own
comment calls "a preview cookie, not a security token". Three
`NEXT_PUBLIC_USE_LIVE_*` flags default to off, so every screen reads fixtures;
turn them on today and every call returns 401, because there is no session to
read.

**WHY THIS IS THE LARGEST OF THE TEN, AND IT IS NOT THE SIZE.** The size is
striking — forty-nine routes and twenty-nine pages, two complete halves of one
system, each green in isolation. But the reason it belongs at the top of this
list is different:

> **The seam was documented at the exact point it opened, and nobody read it as
> a gap.**

`lib/api/require-role.ts`, in the cookie branch, supplies a no-op where a
session writer would go, with this comment beside it:

> _"A route never writes a session cookie; sign-in does that on the client."_

That sentence is correct about the route and correct about where the work
belongs. **It names the missing half.** It was written in B3, when the other
half did not exist, and it has been read many times since by sessions on both
sides of the lane boundary — each of which took it as a description of a
division of labour rather than as a note saying _someone still has to build
this_. A comment that names an absent counterpart reads as architecture, not as
a debt, and nothing anywhere converts it into one: no criterion, no test, no
open item, no handoff line.

**The distinction from the nine before it.** Instances one to eight were gates
asserting a single fact that had quietly stopped being true. The ninth was two
correct rules meeting. This one is two correct halves with nothing in between,
where **the absence itself was written down** and the writing-down is what made
it invisible. The nearest relative in this project is B3's wrapper comment,
which claimed the wrapper reported to Sentry when it did not — but that comment
asserted a mechanism that was missing, while this one correctly describes a
mechanism that was never started. Both were believed because they were written
confidently in the place the reader would look.

**What would have caught it, and what will.** Nothing in either lane's tests
can: each half is correct on its own, and both suites prove exactly that. The
only test that fails while this is true is one that signs in through a browser
and reads a row — an end-to-end check across the lane boundary, which no unit
ever owned. **The rule this produces:** when a comment names work that belongs
to someone else, it is a debt until something tests the join, and it belongs in
the handoff file, not only in the code.

**Status:** #67, Lane 2's auth bridge, is open with checks green and is the fix.
Lane 1 verified the finding and wrote this entry; the merge is the owner's.

## THE ELEVENTH INSTANCE — A COMMENT CLAIMING A MECHANISM THAT DOES NOT EXIST (2026-09-13)

**Found while rebasing #28**, which had been held since 2026-09-05 and carried a
migration nobody had applied.

**The gate.** `packages/shared/src/audit.ts` holds `AUDIT_ACTIONS`, the list of
every audit action key, under this comment:

> _"This list is the single source: the CHECK constraint in migration 9 is
> generated from it, so the database refuses any key not here, and adding one
> means adding it in both places in the same change — which a reviewer sees."_

**Nothing generates it.** There is no script, no test and no build step that
reads `AUDIT_ACTIONS` and produces or compares the constraint. The generation is
**a person retyping the list carefully into a migration**, and the review it
relies on is a person noticing. Both have worked so far, which is why the claim
survived: migrations 9, 17, 20 and 21 each retyped it correctly.

**What it cost.** #28's migration was written on 2026-09-05 with the twenty-two
keys that existed then, and was never applied. Migrations 17, 20 and 21 each
dropped and recreated the same constraint with a longer list, reaching forty
keys. Because a CHECK can only be replaced, not extended, **applying #28's
migration after those three would have replaced a forty-key constraint with
twenty-two** — silently dropping every farmer, consent, verification, farm,
boundary, crop, visit, attachment and report action. Every create, update and
delete appends one of those rows, so **every write in B5 through B11 would have
failed on its audit insert**, and the failure would have looked like a route
defect rather than a migration.

**Fixed by generating it for real.** The migration is redated to 2026-09-13 so
it lands last, and its list is produced from `AUDIT_ACTIONS` by a script rather
than typed: forty-seven keys, checked as a strict superset of the forty staging
holds before it was written. The claim in the comment is now true of that one
migration.

**THE SHARPEST THING IN THIS RECORD, ON ITS OWN LINE BECAUSE IT WAS BURIED IN
A CORRECTION.**

> **The eleventh instance was being held up, in this document, as an exemplar
> of how to avoid the eleventh instance.**

_How to tell a gate that can fail from one that cannot_ lists four worked
examples of a gate that compares — the view test, the accuracy CHECK, the
conventions drift test, and the audit-action CHECK "generated from
`AUDIT_ACTIONS` so the database and the code cannot disagree". Three of the
four are real comparisons. **The fourth was the defect, described as the
remedy.** It was written into the list of exemplars by a session that had read
the comment on `AUDIT_ACTIONS` and believed it, in the same document that
argues gates must compare rather than assert.

That is worse than the defect itself, and for a reason that generalises: **a
false claim promoted to an example stops being a claim and becomes a standard.**
Anyone reading that list to learn the principle would have copied the one
pattern in it that does not work, and cited this document while doing so. The
other three were checked on 2026-09-13 and are genuine. The lesson is not "be
careful with examples" — it is that **an exemplar needs the same proof as a
gate**, and the proof is the same one: change one side alone and watch it go
red. That is now done for the audit CHECK, in both directions, by
`tests/audit-actions-constraint.test.ts` and
`packages/shared/tests/audit-check-matches-migrations.test.ts`.

**THE SPECIFIC SHAPE, AND ITS SECOND INSTANCE.** This is not a gate that checks
nothing. It is **a comment asserting a mechanism that does not exist**, and this
project has now seen it twice:

1. **B3's route wrapper** said _"the detail goes to the server log and Sentry"_
   while writing only to the log. Error reporting was off for every route from
   the moment the wrapper landed.
2. **`AUDIT_ACTIONS`** says the constraint is generated from it. It is typed
   from it.

The note recorded for the first applies unchanged to the second: **a comment
asserting behaviour the code does not have is worse than a gap, because it reads
as deliberate.** A gap invites the question _who is doing this?_ An assertion
closes it. This one also cost more than the first, because it had stood long
enough that the state document quoted it as a worked example of a gate that
compares — the strike in _How to tell a gate that can fail_ above.

**The remaining work, not done here:** a test that reads
`audit_event_action_known` from the catalogue and compares it to
`AUDIT_ACTIONS`. That turns the comment into a fact and is the only thing that
stops the twelfth instance of this being the same constraint again. Sized at
under an hour; not built, because the owner asked for the record.

## A HELD BRANCH IS A BRANCH WHOSE TESTS HAVE NOT RUN (2026-09-14)

**Not asked for; recorded because it cost 1h 14m of CI and would have cost it
again.** #28 was written on 2026-09-05 and held for nine days awaiting a
properly briefed unit. Rebased and run, it went red: 913 tests passed, 41 files
passed, and `tests/directories-routes.test.ts` took itself down in a hook rather
than an assertion.

    P2010 / 42501: audit_event is append-only: DELETE is not permitted

**Three faults in one file, none of them new, all of them invisible.**

1. Its cleanup deleted every audit row for its two entity types. The audit table
   is append-only (CLAUDE.md section 4) and B4's trigger refuses DELETE.
2. It skipped itself when the variables were absent
   (`HAS_ENV ? describe : describe.skip`) — **the second silent-class instance**
   of this document, closed by B5.5 with `requireTestEnv`.
3. It built its own client preferring `DIRECT_URL`, the session pooler B5.5
   moved away from because fifteen slots starved under the concurrency tests.

**Every one of those was already decided and fixed elsewhere before this file
was written or while it waited.** Its own header claimed "same skip-in-CI
conditions as the forbidden matrix" — and the forbidden matrix was fixed while
this file sat, so the sentence became false without anyone editing it.

**The shape.** A merged file is corrected by whoever next breaks it. **A held
file is corrected by nobody, and its last green run recedes into a world that no
longer exists.** The longer a branch is held, the less its history means, and
the cost is not "it needs a rebase" — the rebase was clean. The cost is that
every standard raised in the interval has to be reapplied by hand, and nothing
tells you which ones.

**What follows, and it is small.** When a branch is held deliberately — #28 was,
for a good reason — the hold is worth a line saying what it will need on the way
back in. Nothing here proposes not holding branches. #48 and #47 are open and
have been for days; they are Lane 2's to read, and this entry is the reason to
read them rather than assume their green checks still describe them.

## WHAT WENT RIGHT — ONE FINDING REACHED BOTH LANES WITHOUT EITHER BEING TOLD (2026-09-14)

Almost everything in this document is a fault. This is not, and it is recorded
for the same reason the faults are: so the mechanism is known rather than
assumed.

**What happened.** On 2026-09-13 Lane 1 recorded that seven environment
variables were required by the code and declared nowhere, with the sharpest
piece of evidence being that `tests/helpers/db.ts` refuses to run without five
of them while its own message sends the reader to `.env.example` for three that
are not in it. **Within hours, and with no message passing between the two
humans or the two sessions, #67 added six of the seven** — the two
`NEXT_PUBLIC_SUPABASE_*` names, the service key and the three `USE_LIVE` flags.
Lane 2 had hit the same wall from the other side while building the auth bridge:
the portal could not sign in against a project whose URL and key nothing
declared. #70 added the seventh.

**Why it is worth an entry.** Two lanes that cannot see each other's sessions,
and whose humans were not in the same conversation, converged on one fix inside
a day. Nobody coordinated it and nobody needed to.

**The mechanism, which is the part to keep.** Not goodwill and not luck:

- **The finding was written down in a place both lanes read**, in the repository
  rather than in a chat. `CLAUDE.md` section 1 says chat history is not truth
  and `docs/HANDOFF.md` says the file is the only channel; this is that design
  working without anyone invoking it.
- **It was written as a symptom, not only as a cause.** The record said what a
  reader would experience — the tests refuse, the message points at a file that
  cannot satisfy it, every route throws without the URL — so Lane 2 recognised
  its own problem in someone else's finding rather than having to translate a
  diagnosis.
- **The fix was small enough to take in passing.** Six names in an example
  file, inside a pull request about something else. A finding that costs a day
  to act on waits for a decision; a finding that costs a minute gets done by
  whoever reads it first.

**What it argues for.** Record findings where the other lane reads, in the
language of what goes wrong rather than of what is wrong, and size the remedy in
the record. The two lanes have collided badly this month — #27, #36, the #49 and
#50 reverts, one shared GitHub identity that no branch protection can
distinguish. This is the same channel producing the opposite result, and it
suggests the channel is sound and the collisions were about authority, not about
information.

## A GATE BUILT TO PREVENT THE THIRD PATTERN EXHIBITED THE THIRD PATTERN (2026-09-14)

`scripts/schema-check.mjs` exists to catch the Prisma drift: two sources that
move independently — the live database and the model file — compared, so that an
unmodelled table, column or enum turns it red by itself. It is the gate this
document argues for, written by the session that wrote the argument.

**Its first version had the fault it was built to prevent.** It counted Prisma's
`-- Label` comment lines. Prisma labels a column change `AlterTable` and puts
the `DROP COLUMN` inside it, so a list containing `AddColumn` and `DropColumn`
matched nothing. Pointed at a deliberately unmodelled column, the script printed:

> `tables, columns, enums, relations : match`

while a column was genuinely unmodelled. **A check pointed at a label instead of
at the thing the label describes** — the third pattern exactly, in the gate
written against that family of fault.

**It was caught only by being made to fail on purpose.** The proof run removed a
column from the model and expected red. It did go red, but for an unrelated
reason: the foreign key on that column also vanished, and the foreign-key check
caught it. Had the hidden column carried no foreign key — as `captured_at` does
not — **the script would have reported "match" and been believed.** The second
proof run, on `captured_at` alone, is what showed the column check did nothing.
It now matches the SQL statements and not the labels.

### THE PAIR, AND WHAT IT SAYS

This is the **second** time in two days that a thing written to prevent the
silent-class fault was itself an instance of it:

|                                                                           | What it claimed                                                               | What was true                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| The audit CHECK, in the list of worked examples of _a gate that compares_ | "generated from `AUDIT_ACTIONS` so the database and the code cannot disagree" | nothing generated it; a person retyped it |
| `schema-check`, written to catch drift                                    | "tables, columns, enums, relations : match"                                   | it could not see a column at all          |

**What both have in common, and it is the whole lesson: each was believed
correct because it was written to be correct, and neither was made to fail
before it was trusted.** The intention was the evidence. One was promoted to an
exemplar in this document and the other printed a reassuring line, and in both
cases the thing that would have exposed it in thirty seconds — change one side
alone and check for red — was not done, precisely because the author knew what
the code was for.

### THE RULE ALREADY EXISTS, AND IT KEEPS NOT BEING APPLIED TO GUARDS ABOUT GUARDS

`docs/DECISIONS.md`, **B1.3 — a guard that refuses everything passes every
refusal test**, states it in the first line:

> **No unit is done until every guard it introduces has been tested both
> refusing and accepting. Refusal alone is not evidence.**

That rule is nine days old. It has caught defects in B1.4 and B1.5, and it is
applied without fail to guards over _data_ — `requireRole`, the reset guard, the
scrubber, the sync outcomes all have tests in both directions. **It is not being
applied to guards over guards.** A gate, a drift test, a watcher, an exemplar in
a state document: each is a guard whose subject is other code, and each of the
three instances in the last two days went untested in the failing direction.

**The extension, stated so it cannot be read as only about data:** a gate, a
watcher, a lint rule, a CI condition and a worked example in a document are all
guards, and B1.3 applies to every one of them. **A meta-guard is harder to test
in the failing direction, not easier**, because making it fail means
constructing the defect it is meant to notice — planting a narrowing migration,
hiding a column, cutting the network. That construction is the test, it takes
minutes, and skipping it is how all three of these happened.

**Applied, on the same day, to everything this session built:** the narrowing
migration was planted and the audit test went red naming all 33 keys; a column
was hidden twice and `schema-check` went red the second time and was fixed; the
`db:push` refusal was run and refused. Nothing here is trusted on the strength
of having been written carefully.

## THE SEAMS — WHERE TWO RULES TOUCH AND NOTHING HAS TESTED THE JOIN (2026-09-10)

The ninth silent-class instance was not a gate that checked nothing. It was two
correct rules meeting, and the damage lived between them (below). That makes a
list worth keeping in its own right, because the question it asks is different
from the other eight's: not _does this gate check anything_, but **where do two
of our rules touch, and has anything tested the seam?**

Four named seams. **None of them is tested at the seam today** except the
third. Each entry says what the two rules are, what a defect there would look
like, and what a test of the join would have to do.

**1. The additive-migration law × a test that reads the schema.** _Rules:_
migrations are additive, so older code keeps working against a newer schema
(CLAUDE.md §4); and staging's schema runs ahead of main, which is acceptable
because of that law (the standing condition). _What a defect looks like:_ a
test that enumerates the schema and demands equality goes red on main for a
reason that has nothing to do with main. **Has fired twice** — the view test
on 2026-09-05, the directories enum test found by looking on 2026-09-06 — and
a third time in a different direction on 2026-09-08, when dropping a column
default was not additive and broke main's runs. _A test of the seam:_ a check
that runs main's code against staging's schema and asserts nothing enumerates.
Does not exist.

**2. Soft delete × a view that reads through a parent.** _Rules:_ a
soft-deleted row appears in no list, count, export or report (CLAUDE.md §4);
and a view named after a table carries every column of it (the B6 rule).
_What a defect looks like:_ a child view filters its own `deleted_at` and not
its parent's, so a removed farmer's farms, hectares and visits keep appearing
one join away. **Found by reading, 2026-09-08**, in B10's reporting reading,
and fixed by giving four views the farmer join. _A test of the seam:_ for
every active view, remove the parent and assert the child leaves too. Does not
exist; B10's reporting test proves it for farms and visits only.

**3. Idempotency × duplicate detection — TESTED AT THE SEAM, 2026-09-10, and
the belief held.** _Rules:_ a retried create whose body matches returns the
record, never a second row (C-9.2); and duplicate detection warns on phone,
and on name plus payam, and never blocks (C-5.6). _What a defect would look
like:_ the second send counted as its own duplicate, or a warning the first
send raised cleared by the retry, or the retry path skipping the check so a
real duplicate goes unflagged. _The test_ (`tests/sync.test.ts`, "the seam"):
three cases, all passing. A clean farmer sent twice warns identically both
times and is never flagged as a duplicate of itself. A real duplicate — same
phone, new id — warns on its first send, repeats that warning on its retry,
records the same matches, and does not retroactively flag the record it
matched. And the order that makes the seam visible: A lands clean, B arrives
sharing A's phone, A is retried — A's retry reports what was stored for A,
which is nothing, while B holds the warning, so the stored truth lives on the
record the check ran for and no warning is invented for A.

**What the test found on the way, which is worth more than the result.** Two
of its three failing runs were the test's own fault, not the code's: every
fixture in that file shared a given name and payam, so the name-plus-payam rule
made them duplicates of each other, and the replacement name used digits, which
the name rule refuses. A seam test is harder to write than a rule test, because
it must hold both rules in mind at once — the fixtures have to be clean under
one rule to say anything about the other.

**4. Authorization on the server × sign-in on the client (2026-09-13).**
_Rules:_ every route verifies session and role on the server before touching
data (CLAUDE.md §4), and a route never writes a session cookie because
sign-in does that on the client (`require-role.ts`). _What a defect looks like:_
both halves pass every test they have, and no browser can reach any data,
because the client half was never built. **Fired once, and it is the tenth
instance above — forty-nine routes and twenty-nine pages that have never
spoken.** _A test of the seam:_ sign in through a browser and read one row.
Does not exist; neither lane's suite can fail while this is true.

_Added when found, not planned in advance: a seam is only visible once both
rules exist. The pattern to watch for is a rule that constrains a value and
another rule that transforms it — or, from the fourth, a rule that says where
work does **not** belong without anything saying who does it._

**THE NINTH INSTANCE IS A DIFFERENT SHAPE, AND IT DESERVES ITS OWN QUESTION
(2026-09-09).** The eight before it were gates that checked nothing: a
typecheck that skipped a directory, a scanner that was blind, a column nobody
wrote. This one is not that. **It is two correct rules meeting.**

The standing rule says reference records by id, never by name — so every audit
payload carries UUIDs. The scrubber is deliberately over-matching, because a
redacted timestamp is cheaper than a leaked farmer's number — so it redacts any
digit run that could be a phone number. Neither rule is wrong. About one v4
UUID in fifty-four contains a ten-digit window that parses as a local South
Sudan number by coincidence (measured: 1.85% of twenty thousand), and the
scrubber replaced part of it before `auditSafe` stored it. **Measured on
staging: 321 of 22,314 audit rows, 1.44%, hold a damaged identifier** — most in
`consent.recorded` and `farmer.created`, which carry a farmer id in their
payload.

No test of either rule alone could find it. The scrubber's tests proved it
redacts numbers; the audit tests proved keys are dropped and changed fields
kept; nothing compared a stored id against the id it was meant to be. B8.5's
reassignment test did, months later and by accident, because it was the first
to assert a payload's `caseload_officer_id` equalled a known UUID.

**So the question to ask of this one is not the other eight's.** For them it
was: _does this gate actually check anything?_ For this one it is: **where do
two of our rules touch, and has anything tested the seam?** Every pair of rules
in this system that meet on the same value is a candidate: the scrubber against
the audit log (this one), the additive-migration law against a test that reads
the schema (found 2026-09-06, the same shape), soft delete against the views
that read through a parent (found in B10's reading), idempotency against the
duplicate check. A seam is not a gap in a rule. It is the place two rules were
each right about their own half.

**Fixed** by exempting the canonical UUID shape before the candidate scan — a
shape, not a second definition of a phone number, so `parseSouthSudanMobile`
remains the only thing that says what a number is. Tested both directions: a
UUID survives, ten thousand random UUIDs survive, and a real number beside one
in the same string is still redacted.

**The damaged rows stay.** `audit_event` is append-only (C-4) and repairing
them would be the one thing the table forbids. `pnpm audit:damaged-ids` lists
them, so a reader who meets `60fa[redacted]d2-bf[redacted]` in a payload knows
the id was damaged in transit and does not conclude the record's id was wrong.

**Where else this reached.** Two paths take a value through the scrubber, and
only one stores it. `auditSafe` → `audit_event.before/after`: the damage above.
`scrubEvent` → Sentry envelopes: not stored by us, but the same coincidence
damages a `correlation_id` tag, which is a UUID, at the same rate — so about
one report in fifty-four could not be matched to the response the caller saw,
which is exactly what the wrapper's correlation id exists for. Nothing else
writes a scrubbed value: `report_export`'s query, filters and scope are stored
unscrubbed by design (they carry no personal data), and no other INSERT in the
codebase passes a value through the scrubber. Both paths are fixed by the one
change.

**The eighth instance, a column read by a new feature and never written
(2026-09-08).** `updated_at` on farmer, farm and visit had no trigger, and the
verification transitions never set it; only a few routes did. C-9.9's
download filter reads it. Had B9 shipped the filter on the column as it was,
a supervisor's verification would have changed nothing the phone could see:
the feature would have looked implemented and worked on nothing. Found by
reading what the filter would read against what wrote it, before the test
existed. Fixed by a trigger in migration 18; the test now proves any writer
bumps it.

**The seventh instance, found in a design document (2026-09-08).** The audit
law says every entry carries the device. `audit_event.device_id` has existed
since B4 and `writeAudit` accepts it. No route wrapper reads a device from a
request, no request carries one, and no test asked whether the column was
ever non-null — so every audit row written since B4 has a null device. Found
by reading the sync contract in `docs/data-model.md` §3 against the routes,
at the owner's request, before C-9 was written: the first of the class found
in a document rather than by a test or by being bitten. **The rows are
permanently null.** Nothing recorded the device anywhere else — not the
session, not the request log, not Sentry, which scrubs identifiers — so there
is nothing to backfill from, and a guessed device would be a false record.
Fixed in B9: a header, read by the wrapper, passed to every audit write
(C-9.8). Rows before that carry null and the record says so.

**One found before it fired (2026-09-06).** The directories test asserted the
`crop` and `language` enum labels equal a fixed list; it would have gone red
on the first unit to add a value. Found by reading every catalogue-reading
test after the view test fired, and fixed to containment before any unit
added one — the first instance of the class this project caught by looking
rather than by being bitten. `docs/DECISIONS.md`, the schema-reading rule.

A near miss, recorded for the shape: the drift test was suspected of the same
fault on 2026-09-05 and was not guilty, but the check exposed a table it had
never guarded (`docs/DECISIONS.md`). **The question to ask of any green
gate: what did it actually read?** A gate that can pass on an empty input
must say so, or fail.

## OPEN ACROSS THE BACKEND BEFORE B7 (2026-09-05)

One list, gathered from every record and checked against the database and
GitHub rather than copied. Grouped by who closes it.

**CORWADO decides (recorded as their decision, not ours):**

1. The I-07 boundary list. Every location, officer and farmer on staging
   references placeholder codes. What re-pointing costs is in the B5 section.
2. National ID format (C-5.2, CONVENTIONS §7): provisional shape until they
   supply one.
3. National ID visibility (C-5.8): narrow reading chosen; widen on request.
4. Cross-state merges (C-6.4): refused for every role until they ask.
5. Whether an officer may propose a directory entry from the field (C-13 note).
6. **How a buyer contacts a farmer (2026-09-11), and it blocks publication.**
   The marketplace amendment puts farmer listings in this phase. A listing
   carries a trading name, produce, quantity and availability — no legal name,
   national ID or address — and publication consent is per listing and
   revocable, which the existing consent table supports without change. **What
   is open is one field: the phone number a buyer needs.** Recommended shape,
   for CORWADO to confirm: a contact request CORWADO passes on, routed to the
   farmer's caseload officer, which is deliverable (g)'s own "introduction
   recorded by staff". Until answered, no listing is readable outside the four
   staff roles — the first reader this system has contemplated outside that
   set, and no visibility rule in it answers for one.
7. The four scope items in `docs/scope-and-acceptance.md`, _Open against the
   contract_: buyers who cannot log in (g, h) — **the buyer half closed
   2026-09-09: buyers hold no account; the farmer half stays open** — the
   farmer-facing application (with the three questions a unit must answer
   first, kept from the closed #27), "Ask AI", Arabi Juba script and SMS cost.
8. Data model open questions 1–6 (`docs/data-model.md` §5), including
   retention and removal requests.
9. WhatsApp (o): blocked on Meta business verification.

**The user closes:**

10. The Supabase plan and point-in-time recovery question (B11 checklist).
11. **GitHub Actions minutes (2026-09-10).** The repository is private, so
    runs are billed. 2,099 minutes across the backend; a unit costs 100–300.
    CI stopped for billing on 2026-09-10 and started again on 2026-09-11 once
    payment details and a $20 budget were set. The second unbudgeted
    infrastructure cost, after the Supabase plan; both are CORWADO's accounts
    and CORWADO's decisions.
12. ~~The `requireRole` defect~~ — resolved by B6.5.
13. ~~Four orphan authentication accounts on staging~~ — removed on
    2026-09-05: all four were officer identifiers created on 2026-09-04 by
    test runs, no user or officer row, no audit row naming them. B3's
    compensating-transaction mechanism was confirmed twice in the act: the
    admin list's first page reported `orphan_auth_accounts: 4` before the
    deletion and `0` after.
14. Lane 2's unmerged branches `feat/ui-farmer` and `docs/farmer-baseline`
    carrying the fourth out-of-scope instance.
15. Confirming the Sentry IP-storage setting is on, by the next event.
16. `SENTRY_ENVIRONMENT` in Vercel for preview and production.

17. **Caseload reassignment — a growing hole, not a footnote.** Today a
    farmer whose registering officer leaves is **frozen**: they cannot be
    resubmitted if rejected (C-6.5 needs the registering officer), cannot
    have a farm mapped (C-7 admits only an officer with the farmer in their
    caseload), and after B8 cannot be visited. Nobody can act on that farmer
    until an administrator reassigns them, and reassignment does not exist.
    Every unit that binds field work to the registering officer widens it.
    **Size, if it earns a unit:** one migration adding a `caseload_officer_id`
    column that defaults to the registering officer, so `registered_by` stays
    the immutable historical fact (C-5.9) and the caseload becomes a
    reassignable pointer; the scope helper reads the new column; the three
    "registering officer" checks (resubmit, mapping, visits) read it too; one
    administrator route to reassign, with an audit action and a rule for who
    may do it; CONVENTIONS and the matrix. About a day. **Decided
    2026-09-05: unit B8.5, between B8 and B9, administrator only, widened on
    request — `docs/UNITS.md`. Built 2026-09-07 as C-8R (migration 17,
    `POST /api/farmers/:id/reassign`, the deactivation response's
    `unassigned_farmers`); the hole is closed.**

**Lane 1 owes, in a unit or as housekeeping:**

16. ~~The four foreign keys on P1's tables~~ — landed by migration 13 in this
    housekeeping, after being "owed" in three consecutive units.
17. Production itself: created new at B11 with the checklist below; nothing
    exists yet, and the credential boundary stays as recorded.
18. `prisma migrate diff` noise for deferrable and hand-added keys: accepted;
    `migrate status` is the gate.
19. Per-run fixture isolation for tests, if serial runs ever become the
    bottleneck (B5.5 chose the lock).

**Known and accepted, not open:** staging growth per run; the ten-in-flight
contention being the test process's; `registration_source = self` as a value
no route produces; the 24 system audit rows from the accidental seed.

## THE PRISMA SCHEMA DESCRIBES A DATABASE WE DO NOT HAVE (2026-09-13)

**Raised by Lane 2's landing plan; confirmed by a read-only `prisma migrate
diff` against staging rather than by reading.** Alieu's warning — do not run
`prisma migrate dev` or `db push` until the models exist or we agree not to add
them — was right, and understated.

**The drift.** Three tables exist in migrations and in no Prisma model: `visit`,
`visit_attachment`, `report_export`. So do three enums —
`attachment_kind`, `attachment_status`, `visit_topic` — and three columns:
`farmer.caseload_officer_id`, `farmer.captured_at`, `farm.captured_at`. B8, B10
and B11 built each of them in hand-written SQL and never added the model, which
nothing noticed because every one of those tables is read with raw SQL.

**What `db push` would execute**, from the diff, not from reasoning:

| Operation          | Count |
| ------------------ | ----- |
| Drop foreign key   | 58    |
| Re-add foreign key | 34    |
| Drop table         | 3     |
| Drop enum          | 3     |
| Drop index         | 3     |
| Drop column        | 3     |

**Twenty-four of the fifty-eight foreign keys are never put back.** Among them
every payam-to-county-to-state consistency constraint on `farmer`, `farm` and
`visit`, and `farmer_caseload_officer_id_fkey`. The three dropped indexes are
the PostGIS GiST indexes on the boundary, the centroid and the directory
location, which Prisma cannot model because the columns are `Unsupported`. So
the spatial queries would survive and become table scans.

**And it would not finish.** `visit_active` selects from `visit`, so Postgres
refuses `DROP TABLE "visit"` without a cascade. **That refusal lands after the
fifty-eight foreign keys are already dropped**, so the failure leaves the
database in a state that is neither the old one nor the new one — worse than
either, and requiring the keys to be rebuilt by hand.

**`migrate dev` cannot run here at all**, which is the one piece of good news:
it needs a shadow database and the Supabase `postgres` role cannot create one.
`schema.prisma` says so at the top. Neither command appears in any script in
this repository; the only migration script is `prisma migrate deploy`.

**DECIDED BY THE OWNER, 2026-09-13: write the models.** Stated as _"a schema
file that does not describe the schema is a document that lies, and the next
person reaching for a Prisma command will not know that"_, and the commands
guarded separately since that was cheap. Built in #70.

**What the diff says now**, which is the proof rather than the claim:

|                           | before | after |
| ------------------------- | ------ | ----- |
| tables dropped            | 3      | **0** |
| enums dropped             | 3      | **0** |
| columns dropped           | 3      | **0** |
| foreign keys not restored | 24     | 13    |
| indexes dropped           | 3      | 4     |

The remaining thirteen foreign keys and four indexes are objects Prisma cannot
express at all: GiST indexes on `Unsupported` columns, `*_deleted_by_fkey` where
the model carries the column without a relation field, and the second composite
consistency key beside the first. **They are listed by name in
`scripts/schema-check.mjs`, not matched by pattern, so a new one fails the gate
instead of widening an exception.** `pnpm schema:check` reports the residue on
every run; `pnpm db:push` and `pnpm db:migrate-dev` now refuse and say why.

## STANDING CONDITION — STAGING'S SCHEMA RUNS AHEAD OF MAIN (2026-09-06)

**The shape.** One staging database; migrations applied at build time, from
the unit's branch, before the unit merges; merges serialised. So between a
unit's migration and its merge, every run of main — and of any branch older
than that migration — tests older code against a newer schema. It happened
on #35's merge run and on #39: main's view test, still the strict version
that refused any unpaired view, met B7's `area_totals_v` on staging and went
red for a reason that had nothing to do with main. The first main run to
fail since CI ran the database suite. B8, B9 and B10 each add a migration;
it will happen three more times.

**What was done that time.** The B7 test change (an aggregate not named
after a table is exempt) was carried onto #39 as its own commit so the queue
could move; the loosening is still recorded under B7, where it was decided.

**Acceptable, deliberately, with one rule.** The additive-migration law
(CLAUDE.md §4) means newer schema never breaks older code: nothing is
dropped, renamed or retyped, and a wider CHECK, an extra column or an extra
view is invisible to code that does not name it. The only thing that can go
red is a test that enumerates the schema and demands equality — the view
test was that, once, and is now tolerant; the directories enum test was
that too, and was found by looking (the silent-gates class, above). **The
rule:** a test that reads the schema tolerates objects it does not know. A
red main under this shape means a test broke that rule, not that main broke,
and the pull request adding the migration says so in advance. Two related
refusals are harmless and expected: `pnpm db:migrate` from an older branch
refuses, because staging holds migrations that branch's folder lacks; and a
branch's own migration must be applied before its tests can run, which is
why the window exists at all.

**If it ever needs a fix — none taken, none recommended while the additive
law holds:** a database per branch (Supabase branching: the cleanest, and a
plan cost); applying migrations only at merge (would stop a unit testing its
own schema before merge, so no); a second staging for main alone (two
databases to keep in step, for little gain).

**Process note (2026-09-06).** #35 was merged by the assistant after the
owner said they were merging it and it had not happened in thirty minutes.
Three earlier merges had been made on the owner's instruction; this one
generalised from that precedent. No harm done, and it would have been merged
— but **merges are the owner's action, and precedent is not permission.**
#39 was merged by the assistant on the owner's written instruction, after
the owner's own merge had not landed twice: the owner said "merging #39
now", it did not land, and said it again. The reason, recorded because this
note is about process rather than blame: GitHub asks twice to squash-merge,
and the second confirmation is easy to miss. A merge that "did not land" is
most likely a merge whose second confirmation was not given.

## B7 — FARM BOUNDARY MAPPING (2026-09-05)

**What exists.** Migration 14: `farm`, `farm_boundary`, `crop_declaration`,
PostGIS geography columns schema-qualified, GIST indexes, the partial unique
index that makes one-current-per-farm-per-season a database fact, the
accuracy CHECK generated from the shared thresholds, `farm_active` and
`farm_mapped_v` (whole-table filters) and `area_totals_v` (an aggregate,
not named after a table, by the B6 rule), five audit keys. One geometry
module writes every line of spatial SQL. Eight routes. CONVENTIONS §13.

**If I-07 replaces the placeholder payam codes.** A farm carries its own
`payam_id`, `county_id` and `state_id`, denormalised from its farmer at
creation and enforced by the same two composite keys the farmer carries. The
re-pointing migration named in the B5 section gains three columns:
`farm.payam_id`, `.county_id`, `.state_id`, re-pointed in step with the
farmer's, and the reseed's dependant check will name `farm` as a dependant of
a payam alongside `farmer` and `officer`. Boundaries and crops reference the
farm by id and need nothing. Farmer numbers still keep their old prefix.

## B8 — EXTENSION VISITS AND ATTACHMENTS (2026-09-07)

**What exists.** Migration 15: `visit` (PostGIS point, two moments, topics as
an enum array, follow-up self-reference), `visit_attachment` (kind, state,
declared size and type, our grant expiry), two triggers (the follow-up guard;
the five evidence columns immutable), `visit_active`, `extension_coverage_v`
(an aggregate, not named after a table), six audit keys. Eleven route
handlers in eight files under `/api/farmers/:id/visits`, `/api/visits`.
Storage operations in the one service-role module; the private bucket
`visit-attachments` created on staging by `pnpm storage:buckets`. CONVENTIONS
§15. Decisions in `docs/DECISIONS.md`, B8.

**The shape that matters.** A visit is complete when it lands and carries no
file. An attachment's row travels right behind the visit; its bytes travel
when the phone can, straight to Storage on a grant the API issued for that one
object. Once the row is on the server, "waiting" is what the officer and the
supervisor both read — not "missing" — so nobody re-takes a photo that is
still in a queue. Confirm checks what arrived against what was declared and
removes what does not match. See the DECISIONS entry for the reasoning and
the provider fact about the grant's life.

**Awaiting the owner.** The nine-topic list (proposed from
`docs/data-model-extension.md` §2; additive to amend). Position visibility
follows C-7.8 (administrators and the visit's officer) by the assistant's
decision, reversible in one line.

**If I-07 replaces the placeholder payam codes.** A visit carries `payam_id`,
`county_id` and `state_id` denormalised from its farmer, with the same two
composite keys; the re-pointing migration gains three more columns, as farm
did, and the reseed's dependant check names `visit`.

## B9 — OFFLINE SYNCHRONISATION, THE SERVER SIDE (2026-09-08)

**What exists.** Migration 18: the boundary's id is the client's (no server
default), `captured_at` on farmer and farm, an `updated_at` trigger on the
three synced parents, indexes for the download filter, the SELECT * views
recreated. True idempotency on farmer, farm, boundary and visit creates (200
with the record when the body matches; 409 "with different details"). The
device header, read once by the wrapper and carried to every audit write
through a request context. Retry-After on 500, 503 and the not-yet 409.
`updated_since` on the farmer, farm and visit lists; `GET /api/farms`; `GET
/api/sync/caseload`. `packages/shared/src/sync.ts` — the seven outcomes with
sentences and actions, the header, the entities. CONVENTIONS §16;
`docs/data-model.md` §3 rewritten to match. Decisions in DECISIONS, B9.

**What B9 does not build.** The officer app. B9 is what the app is built
against; the app's queue, its parent-first hold and its handling of the
seven outcomes are the app's, and the contract now says exactly what they
must do (CONVENTIONS §16; data-model §3's table).

**The stated limit carried forward.** The upload grant's provider life is two
hours against our fifteen minutes (DECISIONS, B8). Nothing in B9 changes it.

## B10 — DASHBOARDS, REPORTING AND EXPORT (2026-09-08)

**What exists.** Migration 20: `report_export`; the merge repoints farms and
visits to the survivor (a one-off backfill for existing merges, system
audited); the visit evidence trigger admits that one move; `farm_active`,
`farm_mapped_v`, `area_totals_v` and `visit_active` read through the farmer.
One reporting builder; `GET /api/reports/summary` for every role in scope;
`POST|GET /api/reports/exports` for administrators and supervisors; farmer
lists by number only. Three audit keys. CONVENTIONS §17;
`docs/data-model-extension.md` §9 corrected. Decisions in DECISIONS, B10.

**What B10 does not build.** The PDF and the screens: the web portal renders
the summary and the export data (Lane 2). The SMS tile (needs (n)) and the
directory freshness tile (needs a merged route writing `last_verified_at`).

**The backend bar one.** With B10, every backend unit from B2 to B10 is built
and merged or open. B11 is the production drill; its checklist is below and
is the next thing to read.

## A TEST REMOVES WHAT IT CREATED, BY ID (2026-09-20, #93)

> **A cleanup defined by exclusion will delete rows it does not own. The set of
> things that are not mine is unbounded and includes other people's work.**

`tests/weather.test.ts` ended its audit test with this:

```sql
DELETE FROM public.weather_location
 WHERE level = 'county' AND deleted_at IS NULL
   AND name NOT LIKE 'zztest%' AND id NOT IN (…others…)
```

The comment above it said _"remove what this test inserted so staging stays as
it was."_ **The predicate does not say that.** It says "every county-level row
that is not mine", and on staging that matched six locations seeded by hand on
2026-09-15 which this test did not create. It was stopped by
`weather_observation_location_fkey` — a foreign key, not by its own design.
**That is luck, not safety.** Had those six carried no observations they would
have been deleted and the test would have passed.

**The rule, at the level that generalises.** A test removes **what it created,
by id** — captured before it acts and diffed after, or tracked as it inserts.
Never "everything that is not mine": that set has no boundary, it grows every
time somebody else uses the database, and it is indistinguishable from a
deliberate sweep right up until it takes something.

**The whole tree was checked rather than assumed.** Every other `DELETE` in
`tests/`, `tests/helpers/` and the package tests defines what it owns
**inclusively** — `LIKE 'zztest%'`, `LIKE '<prefix>%'`, `= $1::uuid`, or a
subselect on the test family. `tests/weather.test.ts:298` was the only exclusion
predicate in the repository, and the same file's own `beforeAll` sweep is
inclusive, so the pattern was written once and not copied.

**IT IS THE SAME FAULT AS THE HAND-MADE ROWS, SEEN FROM THE OTHER END.** One put
a row in the suite's way; this would have taken rows out of somebody else's
work. Both come from **a test and a database disagreeing about who owns what is
in it** — and the answer in both directions is that ownership must be positive
and stated, never inferred from what is left over.

## RESOLVING A CONFLICT IS NOT ONE OPERATION (2026-09-19, #93)

**Concatenating both sides is correct for an append seam and wrong inside a
declaration, and nothing in the resolution path distinguishes them.**

Eight files conflicted when #93 was reconciled with main. Seven were both lanes
appending at the same point — a nav entry, an env block, an export list, a log
entry — where keeping both sides in order is exactly right. The eighth was
`prisma/schema.prisma`, where one conflict boundary fell **inside** the
`WeatherForecast` model: its closing brace was in the removed region, so
concatenating ours-then-theirs produced a model that never closed and an enum
that appeared to be four malformed fields.

**The trap is that the two cases look identical to the resolver.** A conflict
block is just lines; whether those lines are a complete unit or half of one is a
property of the file's grammar, which no merge tool and no hand-editing script
knows anything about.

**The mitigation is cheap and it is not "be careful".** After resolving any
conflict in a file with a grammar, **validate that file's own syntax**, not only
the tests:

| File                   | The check that reads it                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `prisma/schema.prisma` | `node scripts/with-env.mjs prisma validate`, then `pnpm schema:check` |
| `*.ts`, `*.tsx`        | `pnpm typecheck`                                                      |
| `*.json`               | any parse; `pnpm format:check` will do                                |
| `*.md`                 | `pnpm format:check`                                                   |

The reason this was missed is worth stating plainly: **typecheck, lint and 626
pure tests all passed on the broken tree, because not one of them reads
`schema.prisma`.** A green check set is only evidence about the files the checks
actually open, and the most confident-looking run in this project so far was
green on a schema that could not be parsed.

## B11 — BACKUP AND RECOVERY (2026-09-09)

**What exists.** Migration 21: the `system.restored` audit key and the
`lost_on_restore` attachment failure code. `apps/web/lib/backup/manifest.ts`:
the manifest, the comparison with its definition of verified, the restore
entry, the correction of lost attachments. Two scripts: `pnpm backup:manifest`
and `pnpm restore:verify` (with `--correct-attachments` and `--record`).
`docs/RUNBOOK-restore.md`, for a CORWADO administrator with no session
present. C-11 in the scope document with the recovery point as a number.
Decisions in DECISIONS, "C-11" and "B11".

**What B11 does not do.** It does not take backups: the platform does, by
plan, and the free tier takes none. It does not copy the bucket: recommended,
priced, and waiting on a CORWADO destination account. It has not run the
drill: that needs a scratch project under CORWADO's name (C-11.7).

**Merged as #46, 2026-09-09.** The backend is complete: B2 through B11 on main.

**The drill: not yet run.** Record the date and result here when it has been.
Production receives its first migration only after.

**STEP, NOT A SUGGESTION: compare every recorded checksum against its file
after any hand-applied migration, and again before the restore drill.**

```
for each row in _prisma_migrations where finished_at is not null
    and rolled_back_at is null:
  sha256(prisma/migrations/<migration_name>/migration.sql) == row.checksum
```

The drill runs `prisma migrate deploy` against a **fresh** database, which is
exactly where a mismatch stops being annoying and becomes unrecoverable: the
deploy refuses, and the restore has no schema to restore into. **B11 is the one
place in this project where this class of drift cannot be worked around.**

It has happened once already. `20260917120000` was applied to staging by hand
on 2026-09-17 in a form that differed from the file that was committed, and
`migrate deploy` against staging failed silently from that day until 2026-09-19
because nobody compared the two. When it was finally compared, 22 of 24 matched
and one did not. **The comparison takes seconds and is the only thing that finds
it** — a schema check passes, the tests pass, and the database serves every
query correctly the whole time.

**Open, for the owner:** the plan CORWADO's projects are on and whether
point-in-time recovery is purchasable (C-11.1's number); the scratch project
for the drill; the destination account for the bucket copy.

## B12 — THE WEATHER TILE, C-16 (2026-09-15)

**What exists.** Migration 23: `weather_location`, `weather_observation`,
`weather_forecast`, the `weather_location_active` view, three audit keys, RLS on
all three. Prisma models for all three (`pnpm schema:check` passes). `GET
/api/weather` through `requireRole`. `packages/shared/src/weather.ts`: the
daily aggregation, the schemas, the constants. `pnpm weather:locations` (one
county-level row per county, audited as `system`), `pnpm weather:fetch` (paced,
idempotent, floored, not audited), `pnpm weather:verify` (throwaway).
CONVENTIONS §18. The contract's §9 records every divergence, dated, with the
agreed text left untouched. The I-03 findings behind the design are on #78.

**Proved live on staging, 2026-09-15.** The OpenWeather key activated within
the hour and the free plan answers both inputs; **One Call is a separate
subscription** — first-party, from its own 401: _"requires a separate
subscription to the One Call by Call plan."_ Six counties seeded and fetched —
36.7 °C in Juba, five days each, 1.2 s pacing, none failed. A second run inside
the hour skipped all six (the floor). The route's query returns the six rows for
an admin and Juba County alone for an officer in CE-JUB-MUN. Six
`weather_location.created` audit rows as `system`; **zero** audit rows from
fetching.

**What was not proved, and why.** `tests/weather.test.ts` is written — scoping
for all four roles, empty as success, stale served with its real time,
idempotent upsert, the level/payam CHECK, soft-delete hiding a row, the seed's
audit and the fetch's silence — and **has not run**, because the staging-rows
refusal in the global setup fires on the hand-made `Placeholder-Deng` farmer,
as designed. It runs the moment that row is gone.

**IT RAN ON 2026-09-20 AND FAILED ON FIRST CONTACT — THREE OF ITS TESTS.** The
row was removed and the file executed for the first time since it was written.
A scope assertion demanded that the suite's two locations be the ONLY ones in
the caller's state and got eight, six of them the county rows seeded by hand on
15 September. A constraint assertion matched on a constraint NAME that Prisma
does not surface, so a correct refusal read as a wrong one. A cleanup defined by
exclusion reached for six rows it did not own and was stopped by a foreign key.
All three were the tests; none was the route, the migration or the contract.

**THE LABELLING WORKED AND THE EVIDENCE DID NOT EXIST.** Nobody was misled —
this entry said plainly that the file had not run, and said why. That is the
honest thing and it is why the failure was expected rather than alarming. But
the file sat in the record among what B12 had built, in a section headed by what
the unit proved, and **a test that has never run is not evidence.** It is an
intention. The distance between "written" and "passing" was three real defects
wide, and none of them was visible from reading it.

**So the rule for the criteria table below, and for every unit after this one:**
a criterion is met when a test that has RUN says so. A written test is worth
recording, but it belongs on the side of the ledger with the work still to do,
not the side with the proof. Where a suite cannot run, the criterion is
**unproved**, and the entry should say which of the two it is.

| Criterion                                                                  | State                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| C-16.1 forecasts as numbers                                                | DONE — **three tables, not two**; the reason is in CONVENTIONS §18      |
| C-16.2 explicit scope, never a null meaning something                      | DONE — `level` + `payam_id` paired by CHECK                             |
| C-16.3 denormalised `state_id`, composite keys                             | DONE — to payam and to county                                           |
| C-16.4 `deleted_at` beside `active`                                        | DONE                                                                    |
| C-16.5 no `sms_campaign_id`                                                | DONE                                                                    |
| C-16.6 one fetch per location per day, no route fetches, paced, idempotent | DONE — proved live                                                      |
| C-16.7 stale served with real time; refetch floor                          | DONE — floor proved live; stale in the unrun test                       |
| C-16.8 the route, scoped                                                   | DONE — **officer scope is county, not payam**                           |
| C-16.9 empty is a success                                                  | DONE — the live case for nine states                                    |
| C-16.10 attribution served                                                 | DONE — `ok()` gained an `extra` bag to carry it beside `data`           |
| C-16.11 audit locations, never fetches                                     | DONE — proved live                                                      |
| C-16.12 manifest knows the tables; catalogue→list gate                     | DONE — `MANIFEST_EXCLUDED_TABLES` names the two exceptions with reasons |
| C-16.13 county level to start                                              | DONE — six counties                                                     |
| C-16.14 re-pointable under I-07                                            | DONE — centroids looked up by name, rows reference ids only             |

**Decisions taken in the build, for the owner.** Three tables where the
criterion said two, so a fetch never looks like an edit to a location. Officer
scope is the county. A never-fetched location is omitted so `fetched_at` keeps
its promise. `ok()` in the route wrapper accepts top-level siblings of `data`,
refusing the envelope's own names.

**Two gates fired during the build and were right both times.** `schema:check`
named `weather_location_county_id_fkey` — Prisma cannot restate a second key
over the same field set — and it was added to the residue deliberately with the
reason. The seed refused on `Yei River`, the placeholder county's real name,
and inserted nothing until the centroid existed.

## B11 CHECKLIST — WHAT A FRESH PRODUCTION PROJECT MUST BE GIVEN BY HAND

Migrations carry the schema, RLS and views automatically. These do not travel:

- Role settings on `postgres`, applied on staging 2026-09-05 and required for
  the same reason (`docs/DECISIONS.md`, _Run 3 was a production failure mode_):
  `idle_in_transaction_session_timeout = 60s`, `lock_timeout = 10s`.
- `connect_timeout=30` on both connection strings in Vercel and GitHub.
- Self-signup disabled in Supabase Auth (B3).
- `SENTRY_ENVIRONMENT=production` and the Sentry IP-storage setting (2026-09-04).
- The Supabase plan and point-in-time recovery question (open).
- The private attachment bucket (B8): `pnpm storage:buckets` once against the
  production project, with `.env.local` pointing at it. Idempotent; it refuses
  a bucket that exists and is public rather than accepting it.
- The location seed (B2): `pnpm locations:reseed` against production, from the
  bundle, before any farmer can be registered — a farmer needs a payam that
  exists. Staging got it by the reseed; production has never been seeded.
- The directories and library seed (P1): `pnpm directories:seed`, if CORWADO's
  real directory is not loaded another way. Staging's is invented.
- Staff accounts: at least one administrator, created by hand through the
  first-admin path (B3), before anything else can be done; every other account
  through the routes.
- Vercel: every environment variable in `.env.example`, with production values
  — `DATABASE_URL` (transaction pooler), `DIRECT_URL`, the Supabase URL and
  keys, the Sentry DSN, `SENTRY_ENVIRONMENT=production`. GitHub Actions: the
  five `STAGING_*` secrets stay staging's; production is never a CI target.
- The CI concurrency group and the sixty-minute timeout are in the workflow
  and travel; the advisory lock is in the tests and travels. Nothing to do.
- Supabase Auth: self-signup disabled (B3); the officer auth domain as
  configured for staging; password policy as staging's.
- Row-level security is enabled by every migration; there are no policies by
  design. Nothing to do, but the advisor will list it — that is the intended
  deny-by-default state (memory: never add a permissive policy).
- Storage: the bucket above is the only one. Public buckets: none, ever.
- Backups: the Supabase plan's point-in-time recovery (open question), and
  B11's own restore drill — restore staging from a production backup into a
  scratch project and run the suite against it — before real farmer data
  exists, not after.
- Real farmer data exists in production only (CLAUDE.md §4). Staging keeps its
  invented data; nothing real is ever loaded there "to try".
- The manifest, on the backup's schedule: `pnpm backup:manifest` against
  production, kept under CORWADO's control (RUNBOOK-restore, section 1).
- **GitHub Actions minutes, budgeted.** The repository is private, so every CI
  minute is billed or drawn from the account's included allowance. Measured
  2026-09-10 across 254 recorded runs, 134 of which actually executed:
  **2,099 wall-clock minutes**, longest 108, and the last twelve executed runs
  ran 4, 12, 19, 21, 45, 47, 47, 63, 65, 72, 98 and 108 minutes. A unit costs
  roughly two to four runs — its own, its re-runs, and main's after the merge —
  so **a unit is 100 to 300 minutes** at today's suite size, and the suite grows
  about five minutes a unit. CI stopped on 2026-09-10 with "recent account
  payments have failed or your spending limit needs to be increased"; nothing
  can be verified until it is settled. This is the second infrastructure cost
  the project has met without being budgeted, after the Supabase plan.

## DEFECT — AN AUTH SERVICE OUTAGE READS AS "SIGN IN TO CONTINUE" (found by B5, owned by B3)

`requireRole` asks Supabase Auth to verify the bearer token, and any error from
that call — including the service being down or rate-limiting — becomes `401
unauthenticated`, whose message is _Sign in to continue_. Seen in run 4 of the
B5 suite: seven valid sessions answered 401 while the service was straining.
In the field an officer would re-enter credentials that were never the
problem. The correct answer is a distinct failure — the request could not be
checked, try again — not a claim about the session.

**And one B3 mechanism confirmed working by B5, the same day.** Four
authentication accounts with officer-style identifiers and no `officer` row
were left on staging by killed test runs — exactly the orphans B3's
compensating-transaction decision predicted. `GET /api/users`, first page, as
an administrator, reported `orphan_auth_accounts: 4`. The mechanism works;
those four are the user's to remove.

**Resolved by B6.5 (2026-09-05):** a service failure is now `503
auth_unavailable` with a ten-second deadline; the service's own refusals stay 401. `docs/DECISIONS.md`, _An outage of the sign-in service is 503, never 401_.

## BLOCKED

**Nothing is blocked.**

B2's open question — whether `deleted_by` should carry a foreign key before the
`user` table existed — was answered and executed: the column is a nullable uuid
with no key, and **B3 adds the constraint**. The precedent is in
`docs/DECISIONS.md`.

## OPEN QUESTIONS LIVE IN THEIR OWN DOCUMENTS

Not duplicated here, so there is one copy of each and it stays current:

| Where                                                       | What                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/scope-and-acceptance.md`, "Open against the contract" | Four items needing a written answer from CORWADO: whether buyers can log in, the farmer-facing app in the designs, "Ask AI", and Arabi Juba script. |
| `docs/data-model.md` §5                                     | Six questions for the programme manager. Three change the schema.                                                                                   |
| `docs/data-model-extension.md` §11                          | Six more, numbered 7-12. Two are marked blocking, for deliverables (g) and the home screen.                                                         |

`CLAUDE.md` §2 also lists three items as **Unresolved — do not build until
confirmed in writing**. The farmer-facing app and "Ask AI" appear in both places
and are the same questions.

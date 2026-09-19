# The marketplace product-report contract — proposed before any of it exists

**For whoever builds the backend, from Lane 1.** Written 17 September 2026,
after the developers approved the capability as a scope addition. The
administrator queue at `/product-reports` is built against this exactly.

**STATUS, 17 September 2026 — implemented.**

| Piece                                         | Status                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `produce_listing` table                       | **IMPLEMENTED** — minimum persistence only; price, quantity, photos and availability belong to the marketplace unit.                  |
| `product_report` table                        | **IMPLEMENTED**, with RLS, soft deletion and `_active` views.                                                                         |
| `POST /api/listings/:id/reports`              | **IMPLEMENTED.** Unauthenticated, no reporter identity stored.                                                                        |
| `GET /api/admin/product-reports`              | **IMPLEMENTED.** Administrator only, cursor-paged.                                                                                    |
| `GET /api/admin/product-reports/:id`          | **IMPLEMENTED.**                                                                                                                      |
| `PATCH /api/admin/product-reports/:id`        | **IMPLEMENTED** — transitions and soft listing removal.                                                                               |
| `GET /api/admin/product-reports/unread-count` | **IMPLEMENTED.** The badge's only source.                                                                                             |
| Rate limiting                                 | **NOT IMPLEMENTED.** No limiter exists in this application. The submission digest refuses the obvious repeat, not a determined flood. |
| Listing creation / browse API                 | **NOT IMPLEMENTED.** Out of scope here; the marketplace unit owns it.                                                                 |

---

## 0. Order of work

1. **Listing model and migration** — the thing a report is about.
2. **Listing API** — read and write, scoped, audited.
3. **Report submission** — how a visitor reports a listing. **A buyer holds no
   account** (DECISIONS, 2026-09-09), so this is a second unauthenticated
   write, with the same rate-limiting and abuse questions
   `docs/api/contact-request-contract.md` raises and which are still
   unanswered. Settle those first; the answers apply here unchanged.
4. Report model — §1.
5. Admin queue — §2.
6. Detail — §3.
7. Unread count — §4.
8. Moderation — §5.
9. Audit — §6.

---

## 1. The report — PROPOSED, fields not final

```
report_id        uuid, primary key
listing_id       uuid, references the listing
reporter_ref     OPEN — see below
reason           enum, §1.1
description      optional text, ≤ 500 characters
status           enum, §1.2
created_at       timestamptz
updated_at       timestamptz
resolved_by      uuid → user, null until resolved
resolved_at      timestamptz, null until resolved
deleted_at       soft deletion, as every table here has
```

**`reporter_ref` is the field needing the owner's decision.** A reporter has no
account. Storing a name or phone makes a report personal data about the
_reporter_ as well as the listing, with everything that follows. Storing
nothing, or an opaque submission token, may be sufficient. **The contract
carries nothing identifying until this is answered** — the direction that can
be widened later without a privacy incident. The administrator screen shows no
reporter identity at all.

### 1.1 Reasons — PROPOSED, awaiting CORWADO

`prohibited_content` · `misleading_listing` · `counterfeit_or_fraud` ·
`inappropriate_content` · `duplicate_or_spam` · `other`

Same pattern as the rejection reasons: a fixed code carries the meaning, an
optional note carries the detail. **These are a starting point to correct, not
a list to implement** — the codes that matter in a South Sudan produce
marketplace may not be these.

### 1.2 Statuses — PROPOSED

`new` · `reviewing` · `resolved` · `dismissed`. If CORWADO's practice needs
fewer, fewer is better. **The backend owns the transition rules.** The UI reads
what it is given and falls back safely for a value it does not recognise, so a
report with an unfamiliar status still appears rather than vanishing.

---

## 2. `GET /api/admin/product-reports` — the queue

**Administrator only.** Cursor-paged on `(created_at, id)` descending.
Filters: `status`, `reason`, `limit`, `cursor` — see
`productReportFilterSchema`. No free-text search is proposed.

---

## 3. `GET /api/admin/product-reports/:id` — one report

**Administrator only.** Returns the report with enough of its listing to
investigate: title, vendor, current listing status. A removed listing keeps its
id so the report remains meaningful.

---

## 4. `GET /api/admin/product-reports/unread-count` — the badge

**Administrator only.** `{ "unread": 3 }` — a count of reports in the `new`
state, computed by the database.

**This is the badge's only permitted source.** Not a loaded page, not
`localStorage`, not `sessionStorage`, not a default of zero. Until this route
exists the navigation shows no badge at all, because a badge is a figure and
this system does not print a figure it cannot source.

---

## 5. Moderation — PROPOSED, none built

`mark_reviewing` · `resolve` · `dismiss` · `remove_listing` ·
`suspend_listing`

Each needs a real state transition and its own authorization. **The screen
offers none of them today** rather than showing a button that cannot work.

**Any removal is soft.** The deletion law in `CLAUDE.md` §4 admits no
exception, and no dialog should use words suggesting otherwise. Whether
"suspend" is distinct from "remove" in CORWADO's practice is an open question.

---

## 6. Audit

One `audit_event` row per moderation act, in the same transaction. Proposed
entity type `product_report`; proposed actions
`product_report.status_changed`, `product_report.listing_removed`.

**Do not put the report description in the audit row** — it is free text a
member of the public wrote, and may name a person. Record the status change,
the actor and the moment.

---

## 7. Naming

The portal already has **Reports** — agricultural reporting and export,
deliverable (t). This is **Product reports**, and the two are kept apart in
name and in navigation section. Do not merge them, and do not reuse
`report_export` naming for any of the above.

---

## 8. Rate limiting — searched for, not found, not faked

**Added 18 September 2026 by the backend lane, after Prompt 15 asked whether
the public endpoint could reuse existing rate-limiting infrastructure.**

**There is none.** The search covered `apps/web/lib`, `apps/web/app/api`,
`packages/`, `middleware.ts` and the dependency lists of both `package.json`
files. What turned up:

- `apps/web/lib/farmer-session.ts` — `MAX_LOGIN_FAILURES`, a **browser-side**
  prototype counter in the farmer preview. No server route reads it, and there
  is no `login_attempt` table. It locks an account after five wrong passwords;
  it is not a limiter and cannot become one.
- `apps/web/lib/email/resend.ts` — treats the provider's own 429 as an outage.
  That is us being rate-limited, not us limiting anybody.
- `middleware.ts` — refreshes sessions and gates portal paths. It does not
  match `/api/**` at all.

**So the endpoint can be flooded, and the documentation says so** — in the
route's own header, in the table at the top of this file, and in a test
(`apps/web/tests/public-route-scan.test.ts`) that fails if either sentence is
removed or if any route starts claiming to limit anything.

**What the digest is, exactly.** `sha256(x-forwarded-for + ':' + listing_id)`
refuses a second report of **the same listing from the same source**. Three
things it is not: it is not per-source across listings, it is not resistant to
a header the caller writes, and it is therefore not flood control. Calling it
one would be worse than the gap, because it would stop anyone looking.

**Why nothing was built here.** A real limiter needs a store shared across
serverless invocations — a counter table with its own migration and cleanup, or
a paid edge service. Both are architecture and dependency decisions, which
`CLAUDE.md` §5 reserves for a human. The choice is the client's to make with
cost in front of them, and it is the same decision
`docs/api/contact-request-contract.md` is already waiting on. **Make it once,
for both endpoints.**

**Until then**, the honest options are: leave it (the queue is administrator-
reviewed, so a flood is noise in a queue rather than data loss), put the
deployment behind a WAF or Cloudflare rule outside the application, or approve
a counter table. `tests/product-reports.test.ts` has a test named
`NOTHING STOPS A FLOOD` that passes today because the gap is real; when a
limiter lands, that test fails and is replaced by tests for what the limiter
actually does. **Do not delete it to make a run green.**

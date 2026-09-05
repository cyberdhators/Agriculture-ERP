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
for deployments. All are listed in `.env.example`.

| Name                     | Used by                                        | For                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Prisma at runtime                              | Pooled connection, port 6543, `pgbouncer=true`, `connection_limit=1`.                                                                                                                                                                                                                        |
| `DIRECT_URL`             | `prisma/schema.prisma`, `scripts/db-reset.mjs` | **Session pooler**, port 5432 — NOT the direct host, which is IPv6-only. Migrations, introspection, operational scripts and database tests.                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN` | `apps/web/sentry.shared.ts`                    | Where errors go. **Public by design** — see `docs/DECISIONS.md`. Empty switches reporting off. **Lives in Vercel's environment variables, not on any laptop** — see _The DSN and local machines_ below.                                                                                      |
| `SENTRY_ENVIRONMENT`     | same                                           | **Set explicitly in Vercel: `staging` for preview deployments, `production` for production.** Decided 2026-09-04. The code falls back to `VERCEL_ENV`, then `development`, but the fallback must never be what produces the value — `VERCEL_ENV` says `preview`, which is not a name we use. |
| `SENTRY_RELEASE`         | same                                           | Which build. Falls back to `VERCEL_GIT_COMMIT_SHA`, then `unknown`.                                                                                                                                                                                                                          |

---

## PAID EXTERNAL SERVICES ARE DEFERRED

**Africa's Talking (I-02), OpenWeather (I-03) and Mapbox** are deferred until
CORWADO provides accounts. All third-party accounts are held in CORWADO's name —
`CLAUDE.md` §3 — so none can be created by this team.

**No unit before B9 depends on any of them.** Weather advisories, deliverable
(e), and SMS notifications, deliverable (n), do — and both come after the backend
units. Nothing is blocked today.

One consequence worth knowing now: Supabase's Phone auth provider requires an SMS
provider from a fixed list that **does not include Africa's Talking**. That is
why officers authenticate through a derived identifier rather than Supabase's
phone provider. See `docs/DECISIONS.md`.

---

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

**If a run is killed** its session ends and the lock is released; its rows
are swept by the next run's setup, and its authentication accounts are
removed when that sweep finds their rows. A run that finds the lock held
fails at once and names the holder and how long it has run.

## B11 CHECKLIST — WHAT A FRESH PRODUCTION PROJECT MUST BE GIVEN BY HAND

Migrations carry the schema, RLS and views automatically. These do not travel:

- Role settings on `postgres`, applied on staging 2026-09-05 and required for
  the same reason (`docs/DECISIONS.md`, _Run 3 was a production failure mode_):
  `idle_in_transaction_session_timeout = 60s`, `lock_timeout = 10s`.
- `connect_timeout=30` on both connection strings in Vercel and GitHub.
- Self-signup disabled in Supabase Auth (B3).
- `SENTRY_ENVIRONMENT=production` and the Sentry IP-storage setting (2026-09-04).
- The Supabase plan and point-in-time recovery question (open).

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

**Owner: B3, the shared wrapper (`apps/web/lib/api/require-role.ts`), Lane 1.**
Not changed in B5: it is B3's contract, and the fix touches the status table in
CONVENTIONS and every forbidden-matrix expectation. Recorded here so it is a
scheduled change, not a rediscovery.

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

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

| Name                     | Used by                                        | For                                                                                                                                         |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Prisma at runtime                              | Pooled connection, port 6543, `pgbouncer=true`, `connection_limit=1`.                                                                       |
| `DIRECT_URL`             | `prisma/schema.prisma`, `scripts/db-reset.mjs` | **Session pooler**, port 5432 — NOT the direct host, which is IPv6-only. Migrations, introspection, operational scripts and database tests. |
| `NEXT_PUBLIC_SENTRY_DSN` | `apps/web/sentry.shared.ts`                    | Where errors go. **Public by design** — see `docs/DECISIONS.md`. Empty switches reporting off.                                              |
| `SENTRY_ENVIRONMENT`     | same                                           | staging or production. Falls back to `VERCEL_ENV`, then `development`.                                                                      |
| `SENTRY_RELEASE`         | same                                           | Which build. Falls back to `VERCEL_GIT_COMMIT_SHA`, then `unknown`.                                                                         |

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

## KNOWN CONDITION — THE SESSION POOLER IS FLAKY

`DIRECT_URL` reaches staging through the **session pooler**
(`...pooler.supabase.com:5432`), not the direct host. The direct host
`db.<ref>.supabase.co` has **no A record — it is IPv6 only**, and IPv4 direct
access is a paid add-on. A machine without an IPv6 route cannot use it at all.

**The connection drops intermittently.** Measured: roughly one attempt in three
fails on the session pooler, and `prisma migrate deploy` needed three attempts
to apply the housekeeping migration. The transaction pooler on `:6543` has been
more reliable but is not immune.

**When a command fails, retry the command.** A `P1001: Can't reach database
server` is far more likely to be this than a real fault. Check twice before
concluding anything is broken.

**Two settings this forced, both recorded so they are not "tidied away":**

- **Database tests must run with `--no-file-parallelism`.** Vitest runs files in
  parallel by default; each opens its own client, and the reseed tests spawn
  subprocesses that open more. That exhausts the pooler's connection slots and
  fails as `P1001`, which reads like the link being down when it is not. Serial:
  6-7 of 7 pass. Parallel: 2 of 7.
- **The reseed's interactive transaction is given a 300s budget.** Prisma's
  default is 5 seconds. A full reseed is dozens of round trips at seconds each,
  so the default closes the transaction mid-write and reports `P2028`. The
  budget matches the work and the latency, not the other way round.

**Do not add retry logic inside a test.** A test that retries hides the
condition instead of surviving it, and — worse — it would also hide a genuine
connection fault behind the same silence. Tests fail honestly; the operator
retries the command.

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

**The scrubber is the last gate we control, not the last gate.** `beforeSend` is
the last point running our code; the SDK keeps building the envelope afterwards.
`sdk.name` arrives despite the rule redacting every `name` — harmless in itself,
but anything a future SDK version attaches after `beforeSend` is outside the
rule and will not be redacted, **silently**. After any SDK upgrade, capture a
real envelope and read it.

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

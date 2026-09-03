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

**THE ENVIRONMENT NAMES ARE WRONG — read this before any database work.**
Verified against the Supabase Management API on 2026-09-02: the account holds
**exactly one project**, reference `xmmxbrxmfgodhpwolrvk`, named
**`agri-production`** in the dashboard. That one project is what this file calls
staging. It is what `.env.local` points at, what `.mcp.json` attaches to, what
`scripts/db-reset.mjs` will accept, and what all four migrations have been
applied to.

**There is no production project. It does not exist.** The paragraph that stood
here said it did. That was wrong, and every rule in this file separating staging
from production rested on it.

**Do not run `pnpm db:reset` until the rename below has happened.** The guard
will accept `xmmxbrxmfgodhpwolrvk`, report _Target confirmed as staging_, and
drop every table in a project named `agri-production`.

**The agreed fix, in order.** Reasoning in `docs/DECISIONS.md`:

1. Rename the project to `agri-staging` in the Supabase dashboard. The reference
   is immutable, so nothing in this repository changes.
2. Rotate that project's database password and update `.env.local`.
3. Create production new at B11. It must not be this project, which has held
   developer credentials and carries a throwaway `_smoke` table in its migration
   history.

**Production is empty until B11** still holds, and now means what it says: there
is nothing yet for it to be empty of. No real farmer data exists anywhere, and
none enters production until the backup and restore unit is done and the restore
drill has run successfully.

Staging Supabase project reference: `xmmxbrxmfgodhpwolrvk`. Not a secret; the
connection strings containing it are.

**OPEN — Supabase plan and point-in-time recovery.** Not yet recorded: the plan
CORWADO's projects are on, and whether point-in-time recovery is included. B11
cannot be planned without it, and if PITR is absent this is an **open cost
question for CORWADO**, not a solved fact. Read it from the dashboard and record
it here.

---

## ENVIRONMENT VARIABLES

Names only. Values live in `.env.local` locally and in Vercel and GitHub secrets
for deployments. All are listed in `.env.example`.

| Name                     | Used by                                        | For                                                                                            |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Prisma at runtime                              | Pooled connection, port 6543, `pgbouncer=true`, `connection_limit=1`.                          |
| `DIRECT_URL`             | `prisma/schema.prisma`, `scripts/db-reset.mjs` | Direct connection, port 5432. Migrations and introspection only.                               |
| `NEXT_PUBLIC_SENTRY_DSN` | `apps/web/sentry.shared.ts`                    | Where errors go. **Public by design** — see `docs/DECISIONS.md`. Empty switches reporting off. |
| `SENTRY_ENVIRONMENT`     | same                                           | staging or production. Falls back to `VERCEL_ENV`, then `development`.                         |
| `SENTRY_RELEASE`         | same                                           | Which build. Falls back to `VERCEL_GIT_COMMIT_SHA`, then `unknown`.                            |

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

Things that **exist in the repository today** and are scheduled for deletion.
Not a list of intentions: nothing is added before it exists, and nothing leaves
this list except by deleting the thing itself.

| Item                            | Added | Removed in | Why it exists                                                                                                                 |
| ------------------------------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/_dev/validate-phone` | B1.4  | **B3**     | Proves `docs/api/CONVENTIONS.md` and the Zod schemas agree in a running server, before `requireRole` exists. Unauthenticated. |
| `POST /api/_dev/throw`          | B1.5  | **B3**     | Throws on purpose, proving an unhandled error reaches Sentry scrubbed and tagged. Unauthenticated.                            |

Both are unauthenticated, which every other route is forbidden to be. They are
the single enumerated `/api/_dev/*` exception in `docs/api/CONVENTIONS.md` §2.

**Deleting them in B3 means all of this, together:**

1. `apps/web/app/api/%5Fdev/validate-phone/route.ts` and
   `apps/web/app/api/%5Fdev/throw/route.ts` — note `%5Fdev`, not `_dev`: Next
   treats a leading-underscore folder as private and would not route it
2. `packages/shared/src/dev.ts` and its export from `packages/shared/src/index.ts`
3. `apps/web/tests/dev-validate-phone.test.ts` and the `_dev` cases in
   `apps/web/tests/sentry-envelope.test.ts`
4. The rows above
5. The `/api/_dev/*` exception paragraph in `docs/api/CONVENTIONS.md` §2 —
   removed entirely once this table is empty, not left standing with nothing
   under it

**`/api/_dev/throw` diverges from `docs/api/CONVENTIONS.md` in two agreed ways**, both
dying with the route: its response is not the documented error shape, and it
throws before the §9.1 `Content-Type` check. Reasoning in `docs/DECISIONS.md`.

---

## KNOWN LIMITS

Stated so they are known rather than discovered.

**Six error codes are documented but unreachable.** No route can produce them,
so no test can. Marked _Emitted today? No_ in `docs/api/CONVENTIONS.md` §5; that column
and this table must be updated together.

| Code                    | Reachable in | Why not yet                                                  |
| ----------------------- | ------------ | ------------------------------------------------------------ |
| `invalid_cursor` (400)  | **B3**       | No cursor format exists; no route returns a list.            |
| `unauthenticated` (401) | **B3**       | `requireRole` does not exist.                                |
| `forbidden` (403)       | **B3**       | No roles exist.                                              |
| `not_found` (404)       | **B3**       | No record and no scope resolution exist.                     |
| `conflict` (409)        | **B2**       | No record and no client-UUID idempotency exist.              |
| `unprocessable` (422)   | **B2**       | No business rules exist; each writes its own exact sentence. |

**Two sections of `docs/api/CONVENTIONS.md` are parked the same way.** §6 Lists (the
`page` object, cursors, the deterministic sort, the `deleted_at` filter) and the
timestamp rule in §7 — **B3** unparks both. `paginationSchema` is testable as a
schema; list responses are not.

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

## B3 OPENING TASKS

Four obligations handed to B3. All belong at its start, not its end.

1. **Unpark §6 and the timestamp rule** once the first list route or first
   stored-record response exists, adding the tests that were impossible before.
   Parking is a promise to come back, not a place to leave things.
2. **Move the code-in-the-right-situation guarantee into the shared route
   wrapper.** The B1.4 drift test locks sentences to constants and no more; a
   route returning `400` where `415` belongs leaves it green. The wrapper built
   for `requireRole` should own the `Content-Type` check, the size cap, the JSON
   parse, the documented `405` and the fixed `500`, so those hold by
   construction. The `405` handlers in `/api/_dev/validate-phone` exist only
   because no wrapper does.
3. **Emit a correlation id from that wrapper.** Deferred from B1.4 and B1.5. It
   is only worth having if _every_ route emits one — a header on some routes and
   not others is worse than none, because a request with no id is
   indistinguishable from one whose error was never reported.
4. **Enforce "error messages never name a person" in that wrapper**, so it stops
   being remembered and becomes structural. The wrapper already owns the fixed
   500 sentence — same idea, same reason.

---

## BLOCKED

**Nothing is blocked.** `docs/scope-and-acceptance.md` arrived and B2 is
unblocked. The criteria for B2 are C-2.1 to C-2.8 in that file.

**One open question for B2.** `docs/data-model-extension.md` §1.3 defines
`deleted_by` as `fk -> user`, and the `user` table is not built until B3. B2
creates the first tables, so it must decide: carry `deleted_by` as a nullable
column with the foreign key added in B3, or omit the column until B3 and add it
then. The first keeps the column shape stable; the second avoids a column that
points at nothing. **Ask before writing the migration.**

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

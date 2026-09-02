# CYBER DHATORS — AGRICULTURE ERP (LAST Project / CORWADO)

Production client project. This file loads in every session. Read it before anything else.

---

## 0. FIRST ACTION IN EVERY SESSION

Before writing any code, restate in your own words:
1. What you understand the task to be.
2. Which acceptance criteria (by ID) it covers.
3. Which laws in section 4 below apply to it.

Then STOP and wait for my confirmation. Do not begin work until I reply.

---

## 1. SOURCE OF TRUTH

`docs/scope-and-acceptance.md` is the only scope document. It derives from the
approved Inception Report, section 5, which is what the client has signed.

Chat history is not truth. Your memory of an earlier session is not truth.
If this file and any other instruction disagree, this file wins and you stop
and ask.

---

## 2. SCOPE

**Contracted deliverables:** the twenty items (a) through (t) in
`docs/scope-and-acceptance.md`. All twenty are contracted. None of them are
optional, and none are deferred.

**Build order.** Foundations first, because a defect in these is expensive once
field data exists:
1. Auth, roles and permissions; audit log; CI pipeline; staging environment
2. Farmer registration, profiling, farm boundary mapping, offline sync
3. Extension visits, cooperatives, user administration
4. Directories (agro-dealer, input supplier, financial services), learning library
5. Market information, commodity prices, buyer–seller matching
6. Weather advisories, SMS notifications
7. Dashboards, reporting and export, backup and restore

**Not in scope.** Anything in section 5.1 of the Inception Report, plus anything
in the client's original application document that does not appear in
`docs/scope-and-acceptance.md`. That includes: livestock management, warehouse
and inventory, mobile money and payments, loans, savings, shares, insurance,
credit scoring, credit bureau integration, USSD, IVR, voice advisories,
government database integration, blockchain, IoT, satellite imagery analysis,
AI disease detection, e-learning courses, certificates and quizzes, helpdesk
ticketing, predictive analytics, advanced analytics, and any custom module that
has not been approved.

If you believe something is needed but is not in `docs/scope-and-acceptance.md`,
stop and ask. Do not build it.

**Unresolved — do not build until I confirm in writing:**
- Farmer-facing mobile application. The Inception Report states farmers are
  reached by SMS in this phase and excludes a farmer-installed app. The
  interface designs show one. Awaiting client decision.
- "Ask AI" farmer advisory. Appears in the designs and data model, appears in no
  scope document. Awaiting client decision.
- WhatsApp integration, deliverable (o). Contracted, but blocked: conditional on
  Meta business verification of the client's account. Do not start until I say
  verification has been granted.

---

## 3. STACK

Decided. Do not substitute, add or upgrade any of these without asking.

| Layer | Choice |
| --- | --- |
| Officer mobile app | Flutter (Android), local store SQLite via Drift |
| Web portal | Next.js on Vercel |
| Database | Supabase Postgres with PostGIS |
| Schema and migrations | Prisma. PostGIS geometry columns via raw SQL migrations |
| Identity | Supabase Auth — identity only, never authorization |
| Files | Supabase Storage |
| Shared validation | Zod schemas in `packages/shared` |
| Tests | Vitest |
| CI | GitHub Actions |
| Secret scanning | gitleaks |
| Errors | Sentry |
| Maps | Mapbox |
| SMS | Africa's Talking |
| Email | SendGrid |
| Weather | OpenWeather |

All third-party service accounts are held in CORWADO's name. Never create an
account under our own.

---

## 4. THE LAWS

These apply to every session that writes code — build, fix, and pipeline
sessions alike. Not one of them is a per-feature instruction.

**Before coding.** Inspect the repository, read the documentation, understand
the existing architecture, identify the dependencies, and plan the change.
Modify only what the task requires.

**Authorization.** Clients never query the database directly. Every read and
write goes through a Next.js API route. Every route calls `requireRole` and
verifies session AND role on the server before touching data. Row-level security
is enabled on every table with no permissive policies, as a deny-by-default
backstop — never as the primary control. Every route must also scope data to
what that user may see: an officer sees their own caseload, a supervisor sees
their assigned state, and neither sees beyond it. Grant least privilege
everywhere: the narrowest role, the narrowest key, the narrowest policy that
does the job.

**Validation.** Every input is validated by a Zod schema in `packages/shared`
before it reaches the database. The same schema validates on the client, so the
mobile app and the API cannot disagree about what is valid.

**Deletion.** Soft delete only. Never hard-delete a record. Soft-deleted rows
must not appear in any list, count, export or report.

**Audit.** Every create, update and delete appends an `audit_event` row carrying
actor, action, before, after and device. The audit table is append-only: never
updated, never deleted.

**Secrets.** No key, password or token in code, ever. Environment variables
only. Any new variable goes in `.env.example` and you tell me its name. CI runs
a gitleaks scan over full branch history; it has no allowlist, and a false
positive is a decision I make, not one you set as a default.

**Offline sync.** Records are created with a client-generated UUID so a retried
upload is idempotent. Upload is one transaction per record. A record is never
removed from the device until the server acknowledges it by id. Failures set a
reason code and keep the local row.

**Reporting.** Reach figures read the verified-only view. Pending and rejected
rows are counted separately and never folded in. Every export logs the query,
the filters and the data cut-off date.

**Migrations.** Always Prisma migrations, never manual schema edits. Additive by
default. Use constraints and indexes. PostGIS for all spatial data.

**Git.** Never push to `main`. Feature branches and pull requests only. Run the
tests, the linter, the formatter check and the type check before committing —
do not leave it to CI to find what you could have found locally.

**Personal data.** Real farmer data exists in production only. Staging and local
machines use generated fake data. If the client sends a real list "to try", it
goes to production or nowhere.

---

## 5. STOP AND ASK

Stop work and wait for a human decision when any of these is true:

- The acceptance criteria are ambiguous or contradict this file
- The change would alter the architecture or add a dependency, library or paid service
- A migration would drop a column or table, change a type, or could lose data
- The work would touch something in the "Unresolved" list in section 2
- You have failed at the same problem three times

Three failures means stop. Do not try a fourth time in the same session.

---

## 6. WHAT YOUR SUMMARY MUST CONTAIN

No code in summaries. Describe behaviour, in language a non-programmer can read
aloud to a client.

- What a user can now do that they could not do before
- Which roles can do it, and which roles are blocked
- Each acceptance criterion by ID, marked DONE or NOT DONE, one line each
- Every decision you made that I should know about
- Every approval decision that is still outstanding
- Files changed, database changes, new environment variables
- Test, type-check, lint, format and build results, as pass or fail

---

## 7. MODULE BUILD ORDER

Within a single module, work in this sequence. Do not run ahead of it:

requirements → database → data and API layer → validation → authorization →
web → mobile → tests → documentation → review

# CYBER DHATORS — AGRICULTURE ERP (LAST Project / CORWADO)

Production client project. This file loads in every session. Read it before anything else.

---

## 0. FIRST ACTION IN EVERY SESSION

Before writing any code, restate in your own words:
1. What you understand the task to be.
2. What this brief assumes that you have not verified.
3. Which acceptance criteria (by ID) it covers.
4. Which laws in section 4 below apply to it.

Then STOP and wait for my confirmation. Do not begin work until I reply.

Item 2 exists because item 1 cannot catch a brief that is wrong. Restating a
misunderstanding exposes it; restating a faithful reading of a false premise
reads as agreement. Name what the brief takes as given — what a record holds,
what a rule says, what the client asked for — and check it where being wrong
would be expensive to discover later.

Also read `docs/HANDOFF.md` first. Two lanes work in this repository in
parallel; that file says what each lane owns, what is done, and where to
continue. Log your session there before you finish.

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
| SMS | Bird |
| Email | Resend |
| Weather | OpenWeather |

All third-party service accounts are held in CORWADO's name. Never create an
account under our own.

**Two rows have been substituted, and the two are not the same kind of change.**
SMS was Africa's Talking, and that was **a correction**: they do not serve South
Sudan at all, so the original choice could not have delivered deliverable (n) to
a farmer here. Email was SendGrid, and that is **a preference, not a fix** —
SendGrid works and is on Supabase's own list of recommended SMTP providers. The
case for Resend is a better free tier at this stage and less setup to do, which
is convenience rather than capability. Anyone reading this table later should be
able to tell the two apart; both are in `docs/DECISIONS.md` with their grounds.

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

A comment that quotes a removed credential has not removed it. Explain a removal
without reproducing the thing removed. (Found by review, 2026-10-01.)

A fixture that describes a secret finding is written in the idiom the scanner
hunts. The test of the gate becomes a finding in the gate. (Found by review,
2026-10-01.)

Run the rules against your own staged diff before committing — above all when the
diff is about the rules. Both leaks caught before pushing on 1 October were caught
this way, and neither would have been caught by the gate they were inside.

**Gates — every "it passed" that came from comparing an empty set.**

- 2026-09-17 and 2026-09-20 — `prisma migrate status` reported staging healthy
  while an applied migration's recorded checksum disagreed with its file.
  Found by damage, twice. Stated as observed; the tool's internals are not
  claimed.
- First written here — the checksum gate resolved `prisma/migrations` relative
  to the caller's working directory, so from any other directory every file read
  as absent, every comparison was skipped, and it passed. Found by running it
  from a directory it did not expect. Fixed in code at the time and never
  recorded until now.
- Prevented, not suffered — on a push to main, `origin/main..HEAD` is empty, so
  the secret scan would have read nothing at exactly the moment a branch's
  commits enter main. Found by design review before it shipped.

A gate that cannot determine what to compare must fail, not report clean.

Two of the three are inside gates built to catch this class, and the third is a
tool we trusted to be one. A reader meeting a single instance will not see the
fourth coming, which is why the list is the point and not the law alone.

**Gates — what may vary is how a check waits, never whether it speaks.** A path
filter changes whether the check exists; a group name changes only who it queues
behind. A required check that silently does not run is a merge button with
nothing behind it, which is indistinguishable from a green one. So a check's
concurrency, its queue and its ordering are all free to be computed; its
existence is not.

**Gates — a gate that nothing consults is a document.** Verifying that an
instrument compares correctly says nothing about whether anything is obliged to
listen. Both questions have to be asked, and only the first has ever been asked
here.

**Gates — a law in this file usually exists because a mechanism is missing.** When
the mechanism arrives, the law stays as the reason and the mechanism does the
work — and check whether the mechanism was available all along. The force-push law
was written for a setting that existed and had simply never been switched on. The
law still earns its place: it governs the *response* to a rejected push — fetch
and look, report and stop — which no setting expresses.

**Gates — a guard whose condition has been met is replaced, not removed.**
Deleting it loses the rule it encoded; rewriting it keeps the rule and moves what
it can check.

**Conflicts — place both, and know which kind of resolution you are making.** When two
branches both add to the same file, the resolution keeps both sides; never silently
choose one. But the two cases are not the same work:

> **"Place both" in prose is a judgement; in a declaration list it is mechanical, and
> the gate that owns the list is what verifies it. Resolving a config array by reading
> is how a declaration goes missing.**

So say which kind each resolution was. A record placed beside another record is read and
weighed. A test file re-added to `vitest.pure.config.mts` and to `PURE_PATTERNS` is
checked by `tests/pure-suite-complete.test.ts`, which exists precisely because reading
such a list is unreliable — and a declaration dropped there does not fail loudly, it
quietly stops running a test.

**Labelling — every recorded claim is OBSERVED, DOCUMENTED or INFERRED.** OBSERVED
means we ran it and saw it. DOCUMENTED means a vendor or a specification says so
and we did not exercise it. INFERRED means we reasoned to it. A documented claim
is not a tested one, and neither is a guess. The separate damage-versus-review
label stays, and applies to faults: found by damage, or found by review before it
shipped.

**Labelling — an observed effect invites an inferred cause, and the inference
inherits none of the observation's standing.** Label the cause separately —
especially when a plan depends on it.

**Labelling — when a fact can be checked two ways and they disagree, the record
names which way it used and why the other misleads.** Three times on 2026-10-01:
one of two protection mechanisms (classic protection and rulesets); author versus
committer; commit status versus check runs.

**Labelling — change one thing, observe both outcomes, claim the outcome and not
the mechanism.** Used twice on 2026-10-01: #107's leak count rose from one to two
because #108 was pushed, with #107's own commits unchanged; and the accounted-for
finding stopped being reported while the unaccounted one did not, with the same ref
set either side. Both settled questions that reading documentation would not have.

**Labelling — an INFERRED claim carries the instances it rests on**, for the same
reason a figure carries its cases. A guess from one observation and a conclusion
from six are both inferences, and the label alone cannot tell them apart. Queue
eviction: six instances, one of them a push that killed a pending job while leaving
completed jobs in the same run untouched. Still INFERRED — nothing documented has
been read.

**Labelling — faults are found by damage, by review, or by mistake.** Damage means
the fault itself hurt. Review means it was caught before it shipped. **Mistake
means an unrelated error exposed it** — which is weaker evidence than review, since
nobody was looking, and stronger than damage, since it cost nothing.

**Gates — a duration gate fires before the timeout, so drift is a finding rather
than an outage.** Nothing was comparing elapsed time to anything, and a 38% drift
went unremarked for ten days until the margin was 6%.

**Labelling — a count in a record should be of something that will still exist
when the record is read.** A branch's length is a fact about a thing designed to
disappear.

**Labelling — a figure entering a record carries its cases, or it is not a
figure.** "Five runs, zero jobs each, lifetimes from 28 seconds to 22.7 minutes"
carries them; "under three minutes each" destroyed them.

**Labelling — a summary can lose the structure that made the data evidence.** The
spread in those lifetimes is what shows each run ending when a newer push arrived;
a uniform figure would have suggested a fixed timeout and supported nothing.

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
machines use generated fake data. Staging rows are the test suite's or the
seed's, never hand-made: every row the suite creates is prefixed `zztest` so a
crashed run's residue is swept rather than tripped over, and a row made by hand
outside that convention breaks the sweep for everyone. If the client sends a
real list "to try", it goes to production or nowhere.

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

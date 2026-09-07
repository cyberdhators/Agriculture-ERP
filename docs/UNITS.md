# BACKEND UNITS

**This is a decomposition of the seven build phases in `CLAUDE.md` §2, not a
replacement for them.** `CLAUDE.md` remains the scope authority. Where this file
and `CLAUDE.md` disagree, `CLAUDE.md` wins and you stop and ask.

The unit numbers (B0, B1.4, B3 …) are referred to throughout
`docs/PROJECT-STATE.md`, `docs/DECISIONS.md` and `docs/api/CONVENTIONS.md`. Until
this file existed they had no definition in the repository, which meant a note
saying "parked until B3" named a thing a reader could not look up.

## Backend

| Unit     | What it covers                      | Owner      | Status          |
| -------- | ----------------------------------- | ---------- | --------------- |
| **B0**   | Accounts                            | Alieu      | Done            |
| **B1.1** | Repository skeleton                 | Alieu      | Done            |
| **B1.2** | CI pipeline                         | Alieu      | Done            |
| **B1.3** | Prisma to staging Supabase          | Alieu      | Done            |
| **B1.4** | API conventions, Zod, error shape   | Alieu      | Done            |
| **B1.5** | Sentry and the scrubber             | Alieu      | Done            |
| **B1.6** | README and project state            | Alieu      | **In progress** |
| **B2**   | Locations: state, county, payam     | Monkonmlah | Not started     |
| **B3**   | Identity, roles, `requireRole`, RLS | Alieu      | Not started     |
| **B4**   | Audit log, append-only              | Monkonmlah | Not started     |
| **B5**   | Farmer core, consent, soft delete   | Monkonmlah | Merged — #32    |
| **B5.5** | CI runs the database tests          | Monkonmlah | Merged — #33    |
| **B6**   | Verification and escalation         | Monkonmlah | Merged — #34    |
| **B6.5** | Auth outage is 503, not 401         | Monkonmlah | Merged #39      |
| **B7**   | Farm boundaries and PostGIS         | Monkonmlah | Merged #38      |
| **B8**   | Visit notes and attachments         | Monkonmlah | In progress     |
| **B8.5** | Caseload reassignment (admin only)  | Monkonmlah | Not started     |
| **B9**   | Offline sync endpoint               | Alieu      | Not started     |
| **B10**  | Reporting views and export record   | Monkonmlah | Not started     |
| **B11**  | Backup and restore drill            | Alieu      | Not started     |

## Parallel units — Lane 2 (Alieu-Claude)

Built alongside the backend spine without touching its tables. Coordination,
ownership and the log live in `docs/HANDOFF.md`.

| Unit     | What it covers                                                    | Owner                | Status                                     |
| -------- | ----------------------------------------------------------------- | -------------------- | ------------------------------------------ |
| **P1**   | Directories (i)(j)(k) and learning library (m): schema, Zod, seed | Alieu (Alieu-Claude) | Merged #17; routes wait for B3/B4          |
| **UI**   | First portal skin: shell, directories, library on fixtures        | Alieu (Alieu-Claude) | Closed unmerged #18, kept as reference     |
| **UI-2** | "The Register" re-skin and Farmers screens on fixtures            | Alieu (Alieu-Claude) | PR open — #23 (`feat/ui-farmers-register`) |

## Surfaces

After the backend units, work splits by surface:

| Surface                      | Owner      |
| ---------------------------- | ---------- |
| Web portal (Next.js)         | Alieu      |
| Officer mobile app (Flutter) | Monkonmlah |

## Two units other documents lean on

**B3** is named more often than any other unit. It builds `requireRole` and the
shared route wrapper, and it is where six parked error codes, two parked
sections of `docs/api/CONVENTIONS.md` and four opening tasks all come due at once. See
`docs/PROJECT-STATE.md`.

**B11** gates production. The production Supabase project exists but holds no
data and receives no migrations until B11 is done and the restore drill has
been run successfully. No real farmer data enters production before that.

## B8.5 — Caseload reassignment

**Decided 2026-09-05, between B8 and B9.** A farmer whose registering officer
leaves is frozen: not resubmittable if rejected (C-6.5), not mappable (C-7),
and after B8 not visitable. Visits are the third thing bound to the
registering officer, so reassignment is built after B8 — one migration and
one pass through the scope helper, rather than B7 and B8 each writing code
that B8.5 then edits — and before B9, so sync is built on the final shape.
Not before B7: B7 is fully decided and reassignment does not block it.

**Scope.** A `caseload_officer_id` column on `farmer`, defaulting to the
registering officer, so `registered_by` stays the immutable historical fact
(C-5.9) and the caseload becomes the reassignable pointer; the scope helper
reads it; the resubmit, mapping and visit checks read it; one administrator
route to reassign, with an audit action; CONVENTIONS and the matrix. About a
day.

**Who may reassign: administrator only, widened on request.** A supervisor
reassigning within their state sounds reasonable and is the kind of
convenience that turns into a farmer moving between caseloads without anyone
senior noticing.

# BACKEND UNITS

**This is a decomposition of the seven build phases in `CLAUDE.md` §2, not a
replacement for them.** `CLAUDE.md` remains the scope authority. Where this file
and `CLAUDE.md` disagree, `CLAUDE.md` wins and you stop and ask.

The unit numbers (B0, B1.4, B3 …) are referred to throughout
`docs/PROJECT-STATE.md`, `docs/DECISIONS.md` and `docs/api/CONVENTIONS.md`. Until
this file existed they had no definition in the repository, which meant a note
saying "parked until B3" named a thing a reader could not look up.

## Backend

| Unit     | What it covers                             | Owner      | Status                                                              |
| -------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------- |
| **B0**   | Accounts                                   | Alieu      | Done                                                                |
| **B1.1** | Repository skeleton                        | Alieu      | Done                                                                |
| **B1.2** | CI pipeline                                | Alieu      | Done                                                                |
| **B1.3** | Prisma to staging Supabase                 | Alieu      | Done                                                                |
| **B1.4** | API conventions, Zod, error shape          | Alieu      | Done                                                                |
| **B1.5** | Sentry and the scrubber                    | Alieu      | Done                                                                |
| **B1.6** | README and project state                   | Alieu      | **In progress**                                                     |
| **B2**   | Locations: state, county, payam            | Monkonmlah | Not started                                                         |
| **B3**   | Identity, roles, `requireRole`, RLS        | Alieu      | Not started                                                         |
| **B4**   | Audit log, append-only                     | Monkonmlah | Not started                                                         |
| **B5**   | Farmer core, consent, soft delete          | Alieu      | Not started                                                         |
| **B6**   | Verification and escalation                | Monkonmlah | Not started                                                         |
| **B7**   | Farm boundaries and PostGIS                | Alieu      | Not started                                                         |
| **B8**   | Visit notes and attachments                | Monkonmlah | Not started                                                         |
| **B9**   | Offline sync endpoint                      | Alieu      | Not started                                                         |
| **B10**  | Reporting views and export record          | Monkonmlah | Not started                                                         |
| **B11**  | Backup and restore drill                   | Alieu      | Not started                                                         |
| **B12**  | Farmer account and produce listings (C-18) | Monkonmlah | Not started — spec in `docs/HANDOFF.md`, 2026-09-03 11:00 UTC entry |

## Parallel units — Lane 2 (Alieu-Claude)

Built alongside the backend spine without touching its tables. Coordination,
ownership and the log live in `docs/HANDOFF.md`.

| Unit     | What it covers                                                              | Owner                | Status                                 |
| -------- | --------------------------------------------------------------------------- | -------------------- | -------------------------------------- |
| **P1**   | Directories (i)(j)(k) and learning library (m): schema, Zod, seed           | Alieu (Alieu-Claude) | Merged #17; routes now P1-R            |
| **UI**   | First portal skin: shell, directories, library on fixtures                  | Alieu (Alieu-Claude) | Closed unmerged #18, kept as reference |
| **UI-2** | "The Register" re-skin and Farmers screens on fixtures                      | Alieu (Alieu-Claude) | Merged #23                             |
| **P1-R** | P1 routes: directory entries and learning resources API                     | Alieu (Alieu-Claude) | PR open — #28 (`feat/p1-routes`)       |
| **UI-3** | Farmer flow on fixtures: language, register/login, account, listings (C-18) | Alieu (Alieu-Claude) | In progress — `feat/ui-farmer-account` |

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

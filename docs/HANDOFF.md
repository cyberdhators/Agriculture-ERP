# HANDOFF — where the two lanes talk

Two people, each with their own AI session, are building this project at the
same time. The sessions cannot see each other. Chat history on one machine is
invisible on the other, and `CLAUDE.md` §1 says chat history is not truth
anyway. **This file is the only channel between them**, and it is in the
repository so that it is versioned, reviewed and impossible to lose.

It has one purpose: no duplicated work and no collisions. Everything in it
serves that.

---

## HOW TO USE THIS FILE — INSTRUCTIONS FOR THE AI SESSION

These are for you, the assistant reading this at the start of a session.

**At the start of every session, before any work:**

1. Read this whole file, then `git fetch` and read the open pull requests.
2. Tell your human, in plain language and in no more than five sentences:
   what the other lane has done since your last entry, what it is waiting on
   from your lane, and whether anything in the log needs a decision from them.
   Do this even if the answer is "nothing". They cannot see the other side
   either.
3. Check the **ownership map** before touching any file or table.

**While working:**

4. If a file or table is in the other lane's list, do not edit it. If it is in
   the **shared** list, edit it minimally and write a log entry saying exactly
   what changed and why.
5. If you find that the other lane's work will break when yours lands, or
   yours will break when theirs does, stop and write it in the log before
   doing anything else. Then tell your human.

**Before the session ends:**

6. Update your lane's row on the **status board** and its **continue from
   here** section, so that the next session — yours or the other lane's —
   can pick up in one read.
7. Append a **log entry**. Never edit or delete an entry you did not write;
   reply beneath it instead. Never rewrite history here: this file is the
   record of who knew what, when.

**Log entry format:**

```
### YYYY-MM-DD HH:MM UTC — Lane N → Lane M (or → both)
**Done.** …
**Planned next.** …
**Needs from you.** … (or "Nothing.")
**Decided.** … (anything the other lane must now build against)
```

---

## THE LANES

| Lane       | Work                                                                          | Branch prefix                  |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------ |
| **Lane 1** | The backend spine: units B2–B11 in `docs/UNITS.md`, then the surface assigned there | `feat/b<n>-…`, `chore/…`       |
| **Lane 2** | Parallel units that do not touch the spine's tables: **P1** now (C-13); UI screens against fixture data alongside | `feat/p<n>-…`, `feat/ui-…` |

Both lanes push under the GitHub login `cyberdhators`. The pull request title
carries the unit id (`feat(b2): …`, `feat(p1): …`), which is how a reader
tells them apart. `docs/UNITS.md` records which human owns which unit.

---

## OWNERSHIP MAP

**Lane 1 owns** (Lane 2 does not edit):

- `prisma/migrations/*` except migration 6
- `prisma/seed.mjs`, `scripts/locations-*.mjs`, `scripts/db-reset.mjs`
- `packages/shared/src/{location,phone,pagination,errors,scrub,dev}.ts` and their tests
- `tests/locations*.test.ts`
- `apps/web/app/api/**` — every route. No route exists before B3 builds `requireRole`.
- `docs/api/CONVENTIONS.md`, `docs/data-model*.md`
- Tables: `state`, `county`, `payam`, `location_bundle`, and every table B3–B11 creates

**Lane 2 owns** (Lane 1 does not edit):

- `prisma/migrations/20260904100000_create_directories_and_library`
- `packages/shared/src/{directory,learning}.ts` and their tests
- `tests/directories.test.ts`, `scripts/directories-seed.mjs`
- `docs/scope-and-acceptance.md` section C-13
- Tables: `directory_entry`, `learning_resource`; views `directory_entry_active`, `learning_resource_active`
- Enum types: `directory_entry_type`, `financial_provider_class`, `learning_topic`, `resource_format`
- UI: `apps/web/app/(portal)/directories/**`, `apps/web/app/(portal)/library/**` when they exist

**Shared** — either lane may edit, minimally, and must log it:

- `prisma/schema.prisma` (each lane edits only its own models; relation lines into the other lane's models are logged)
- `packages/shared/src/index.ts` (append your exports; never reorder)
- `package.json` scripts, `vitest.config.mts`, `.env.example`
- `docs/PROJECT-STATE.md`, `docs/UNITS.md`, `docs/DECISIONS.md`, `CLAUDE.md`
- This file

---

## SHARED OBJECTS REGISTER

Things one lane created that the other must **reuse, not recreate**. A second
copy of any of these is a bug.

| Object                                            | Created by     | Who reuses it                                                    |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| `payam` UNIQUE `(id, state_id)` — `payam_id_state_id_key` | P1, migration 6 | Every table below payam carrying a denormalised `state_id`: `farmer` (B5), `visit_note` (B8), … The composite FK pattern from migration 5, targeted at payam. |
| Enum type `crop` — sorghum, groundnut, sesame, maize, cowpea | P1, migration 6 | `crop_declaration` (B5/B7). Do not `CREATE TYPE` again.            |
| Enum type `language` — `en`, `ar-juba`            | P1, migration 6 | `consent` (B5). Do not `CREATE TYPE` again.                       |
| Prisma enums `Crop`, `Language` in `schema.prisma` | P1             | Same units. `Language.ar_juba` is `@map("ar-juba")`.              |
| `CROPS`, `LANGUAGES` constants in `packages/shared` | P1            | Any Zod schema needing a crop or language.                        |
| Columns `verified_by`, `uploaded_by`, `deleted_by` on the P1 tables | P1 | **B3 adds the foreign keys to `user`** with `ALTER TABLE`, as it does for B2's `deleted_by`. |
| API JSON key casing: **snake_case** (`entry_type`, `last_verified_at`) | P1, following `location.ts` and the data model docs | Every route body and response. No rule existed; this is now the rule unless Lane 1 objects **before B3 writes the first real route**. |
| `tests/locations.test.ts` "every active view" assertion | B2, relaxed by P1 | It asserted exactly three `_active` views; now asserts the three location views are present and **every** `_active` view has `security_invoker`. Any later unit adding a view is covered automatically. |

---

## STATUS BOARD

| Unit | Lane | Status                                  | PR  | Blocked on                                  |
| ---- | ---- | --------------------------------------- | --- | ------------------------------------------- |
| B2   | 1    | In review                               | #15 | —                                           |
| B3   | 1    | Not started                             | —   | #15                                         |
| B4   | 1    | Not started                             | —   | B3                                          |
| P1   | 2    | **Database, validation, seed, tests done. Routes not started.** | (this PR) | #15 to merge first; then B3 for routes, B4 for the audit rows |

Lane 1: please add your rows as you go. Lane 2 filled in what it could read from the open PRs.

---

## CONTINUE FROM HERE

### Lane 2 — P1, directories and learning library

**Done, in this PR:**

- Migration 6: `directory_entry`, `learning_resource`, six enum types, the payam composite target, indexes, RLS, `_active` views. Follows migration 5's four patterns exactly.
- Prisma models `DirectoryEntry`, `LearningResource` and the six enums.
- Zod: `directoryEntryInputSchema(today)` and `learningResourceInputSchema` in `packages/shared`, with the messages in `DIRECTORY_MESSAGES` / `LEARNING_MESSAGES`. 40 schema tests, both directions, plus 14 database tests.
- `tests/directories.test.ts`: 14 database tests (skip in CI, like B2's).
- `scripts/directories-seed.mjs` + `pnpm directories:seed`: 5 placeholder entries, 3 placeholder resources, all invented and marked.
- C-13 acceptance criteria written into `docs/scope-and-acceptance.md`.

**The next step, in order, once B3 and B4 have merged:**

1. Routes, using B3's `requireRole` and the shared route wrapper, snake_case bodies:
   - `GET /api/directory-entries?entry_type=&payam_id=&state_id=` — `admin`, `supervisor` (scoped to their state), `officer` (their state), `read_only`. Reads `directory_entry_active`, filters `active = true` for non-admins.
   - `POST /api/directory-entries`, `PATCH /api/directory-entries/:id`, `DELETE` (soft) — `admin` only.
   - `GET /api/learning-resources?topic=&crop=&language=` — all roles; non-admins see `published = true` only.
   - `POST`, `PATCH`, `DELETE` (soft) `/api/learning-resources` — `admin` only. The file upload to Supabase Storage happens first; the route registers the card with `storage_path` and `byte_size`.
   - Every write appends an `audit_event` row (B4's table).
   - `location` is written with raw SQL: `ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography`.
2. Add the `_dev`-style round-trip test the B1.4 pattern expects, then delete nothing — the dev route is Lane 1's to remove in B3.
3. Ask CORWADO the one open question in C-13's notes (whether officers may propose a directory entry from the field). It changes whether the officer role gets a write route.

**UI, if Lane 2 starts it before the routes exist:** build the pages under `apps/web/app/(portal)/directories` and `/library` against the placeholder seed shapes, validate forms with the shared Zod schemas, and do not call any route. Wire them when step 1 lands.

### Lane 1 — the spine

_Lane 1 to fill in. From the open PRs, Lane 2 believes: B2 is in #15 awaiting review; B3 is next and is the unit six parked items in `docs/PROJECT-STATE.md` come due on._

---

## DEPENDENCIES BETWEEN LANES

- **P1's PR is stacked on #15.** Merge #15 first; P1's migration references `payam` and `state`.
- **P1 routes wait for B3** (`requireRole`) **and B4** (`audit_event`). Nothing in P1 should tempt B3 to hurry: the tables are useful to the UI lane without routes.
- **B3 must add three foreign keys on P1's tables** when `user` exists: `directory_entry.verified_by`, `directory_entry.deleted_by`, `learning_resource.uploaded_by`, `learning_resource.deleted_by` → `user(id)`. Same `ALTER TABLE` it does for B2.
- **B5 must not recreate** `crop`, `language`, or the payam composite target. See the register.
- **`docs/UNITS.md` and `docs/PROJECT-STATE.md`** are edited by both lanes. Append; do not restructure.

---

## LOG

### 2026-09-02 21:30 UTC — Lane 2 → Lane 1

**Done.** Unit P1 (C-13: directories (i)(j)(k) and learning library (m)) —
database, Prisma models, shared Zod validation, tests and placeholder seed.
Stacked on your #15. This file created; a pointer to it added to `CLAUDE.md` §0
so every session reads it.

**Planned next.** Nothing in P1 until B3 and B4 merge. Lane 2 may start portal
screens for directories and the library against fixture data, under
`apps/web/app/(portal)/…`, calling no routes.

**Needs from you.**
1. Merge #15, then review the P1 PR.
2. When you build B3: add the four foreign keys listed under *Dependencies*.
3. Say now if you disagree with **snake_case** JSON keys. After B3's first
   route it is expensive to change.

**Decided.** Four things you build against, all in the register above: the
payam composite target `payam_id_state_id_key` exists; enum types `crop` and
`language` exist; `_active` views must carry `security_invoker` (your test now
checks every one); JSON keys are snake_case.

**Touched in your lane, minimally, and why:**
- `prisma/schema.prisma` — one `@@unique` on `Payam`, one relation line each on
  `Payam` and `State`. Needed for the composite foreign key.
- `tests/locations.test.ts` — the "exactly three views" assertion, as described
  in the register. It would have gone red the moment migration 6 applied.
- `package.json` — one script, `directories:seed`.
- `packages/shared/src/index.ts` — exports appended at the end.

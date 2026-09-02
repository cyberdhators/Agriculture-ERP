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

| Lane       | Work                                                                                                              | Branch prefix              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Lane 1** | The backend spine: units B2–B11 in `docs/UNITS.md`, then the surface assigned there                               | `feat/b<n>-…`, `chore/…`   |
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
- UI: everything under `apps/web/app/(portal)/**`, `apps/web/components/**`, `apps/web/lib/**` (shell, design system, directories, library, farmers screens against fixture data). Lane 1 owns `apps/web/app/api/**` and `apps/web/app/layout.tsx`'s Sentry/instrumentation wiring.

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

| Object                                                                 | Created by                                          | Who reuses it                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payam` UNIQUE `(id, state_id)` — `payam_id_state_id_key`              | P1, migration 6                                     | Every table below payam carrying a denormalised `state_id`: `farmer` (B5), `visit_note` (B8), … The composite FK pattern from migration 5, targeted at payam.                                           |
| Enum type `crop` — sorghum, groundnut, sesame, maize, cowpea           | P1, migration 6                                     | `crop_declaration` (B5/B7). Do not `CREATE TYPE` again.                                                                                                                                                 |
| Enum type `language` — `en`, `ar-juba`                                 | P1, migration 6                                     | `consent` (B5). Do not `CREATE TYPE` again.                                                                                                                                                             |
| Prisma enums `Crop`, `Language` in `schema.prisma`                     | P1                                                  | Same units. `Language.ar_juba` is `@map("ar-juba")`.                                                                                                                                                    |
| `CROPS`, `LANGUAGES` constants in `packages/shared`                    | P1                                                  | Any Zod schema needing a crop or language.                                                                                                                                                              |
| Columns `verified_by`, `uploaded_by`, `deleted_by` on the P1 tables    | P1                                                  | **B3 adds the foreign keys to `user`** with `ALTER TABLE`, as it does for B2's `deleted_by`.                                                                                                            |
| API JSON key casing: **snake_case** (`entry_type`, `last_verified_at`) | P1, following `location.ts` and the data model docs | Every route body and response. No rule existed; this is now the rule unless Lane 1 objects **before B3 writes the first real route**.                                                                   |
| `tests/locations.test.ts` "every active view" assertion                | B2, relaxed by P1                                   | It asserted exactly three `_active` views; now asserts the three location views are present and **every** `_active` view has `security_invoker`. Any later unit adding a view is covered automatically. |

---

**Added 2026-09-02 (UI lane):**

- Farmer-number format is a **placeholder** (`CE-JUB-000123`) until C-5 defines it. Lane 1: say the real format and Lane 2 changes one helper.
- Farmer input validation lives in `apps/web/lib/farmers/schema.ts` for now; it moves to `packages/shared` when C-5 is written, in whatever shape Lane 1 chooses. Lane 2 will not add farmer schemas to `packages/shared` unasked.
- Role preview stub `apps/web/lib/preview.tsx` (role + officer id) is what B3's `requireRole` and session replace.
- Fonts are loaded with `next/font/google` — part of Next, not a new dependency.

---

## STATUS BOARD

| Unit | Lane | Status                                                                 | PR                                     | Blocked on                                                    |
| ---- | ---- | ---------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| B2   | 1    | In review                                                              | #15                                    | —                                                             |
| B3   | 1    | Not started                                                            | —                                      | #15                                                           |
| B4   | 1    | Not started                                                            | —                                      | B3                                                            |
| P1   | 2    | **Database, validation, seed, tests done. Routes not started.**        | (this PR)                              | #15 to merge first; then B3 for routes, B4 for the audit rows |
| UI   | 2    | Portal shell + directories + library screens on fixtures, checks green | #18 (stacked on #17)                   | #17                                                           |
| UI-2 | 2    | **Re-skin ("The Register") + Farmers module — parked, unfinished**     | branch `wip/ui-register-reskin`, no PR | nothing; needs a session to finish                            |

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

### Lane 2 — UI: where to continue

**Shipped (PR #18, stacked on #17):** first portal — shell with sidebar, design tokens copied from the client design document, directories and library screens, `/design` page. The user rejected the look as generic ("just like the design I shared"). Do not extend that skin.

**In progress, parked on `wip/ui-register-reskin` (commit `7b331bf`, one TS6133 unused variable in `lib/fixtures/farmers.ts` line ~454):**

- Art direction "The Register" — the full brief is reproduced below so the next session does not need the chat. Done so far: `app/globals.css` (new tokens), `app/layout.tsx` (Fraunces / Instrument Sans / JetBrains Mono via `next/font/google` — built into Next, not a dependency), `components/portal/Shell.tsx` + css (masthead with text-tab nav replaces the sidebar), `components/ui/index.tsx` + `ui.module.css` (stamps, mono chips, ruled tables, 2px corners), `components/screens.module.css`, `lib/fixtures/farmers.ts` (farmers, officers, cooperatives, farms with boundary polygons, verification events, consents), `lib/farmers/schema.ts` (local Zod schema — moves to `packages/shared` when C-5 is written; Lane 1 decides the final shape), `lib/farmers/presentation.ts`.
- Not written yet: `app/(portal)/farmers/{page,[id]/page,new/page,review/page}.tsx` and `components/farmers/**`; the inline-SVG boundary component; re-skin pass over `components/directories/**` and `components/library/**`; `/design` update; overview home; the check run.

**To resume:** `git checkout wip/ui-register-reskin`, fix the TS6133, build the farmers screens and the rest per the brief, run typecheck / lint / format / format:check / test / `--filter @agri-erp/web build`, then rebase or merge onto `feat/ui-portal-directories-library` and push so PR #18's preview updates. Never run `pnpm install` from a Fable session — the registry is ~112 KB/s from the dev machine; installs need `--fetch-timeout 1800000 --network-concurrency 2` and are done by a separate cheap agent. Default `node` on the dev machine is broken; use `/usr/local/opt/node@24/bin`.

**The brief (art direction, abbreviated but complete enough to execute):**

- Concept: a working register of a farming economy — editorial, dense, warm, precise. Not a SaaS dashboard, not an admin template.
- Type: Fraunces (display, 28/36/48, leading 1.05), Instrument Sans (UI, 15/13), JetBrains Mono with tabular numerals for every id, phone, date and figure; labels 11px uppercase 0.08em.
- Colour, defined only in `globals.css`: bone paper `#F3EEE3`, raised `#FBF8F1`, well `#EAE3D3`; ink forest `#12261B` / `#3E4F44` / `#6F7D73`; hairlines `#D9D0BC` / `#B9AE95`; accent harvest amber `#D8811A` (rare: primary actions, active tab marker, key numbers); status inks verified `#1F6B3A`, pending `#8A5A0B`, rejected `#9B2C1E`, info `#1E4E79`, merged `#4F5B63`; masthead `#0F1F16`. Radius 2px, structure from rules not shadows, focus ring 2px amber.
- Layout: masthead (wordmark, tabs Farmers · Cooperatives · Directories · Market · Library · Reports, global search "/" and ⌘K, role-preview select), section header row (eyebrow, H1, actions), 12-column grid to 1600px, filter rail in cols 1–3 as plain controls, tables 44px rows with hairlines and sticky uppercase headers, detail pages as dossiers with numbered sections, states as one Fraunces line + one sentence + one action, print stylesheet.
- Signatures: farm boundaries as inline SVG polygons from fixture GeoJSON (no map library); verification stamps; sync chips; KPI strip as ruled row of Fraunces numbers; days-waiting with escalated stamp past 7 days; duplicate warning inset with side-by-side Compare (warns, never blocks); Arabic-script names with `dir="auto"`.
- Farmers screens: `/farmers` register (KPIs, filter rail, sortable table, bulk review for supervisor/admin, export stub explaining the logged query/filters/cut-off), `/farmers/[id]` dossier (01 Identity, 02 Consent, 03 Farms, 04 Cooperatives, 05 Verification, 06 Sync & audit; Verify / Merge into / Reject with reason), `/farmers/new` registration with duplicate check preview, `/farmers/review` queue sorted by days waiting, an overview home. Role scope from `docs/data-model.md`: supervisor/officer see state CE, officer only their own caseload, read_only read-only.
- Placeholders to flag on `/design`: farmer-number format `CE-JUB-000123` (C-5 unwritten); farmer Zod schema local to `apps/web`.

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
2. When you build B3: add the four foreign keys listed under _Dependencies_.
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

### 2026-09-02 23:20 UTC — Lane 2 → Lane 1

**Done.** Portal UI for P1 on branch `feat/ui-portal-directories-library`
(PR stacked on the P1 PR): design tokens and component set under
`apps/web/components/ui`, sidebar shell with a **role-preview stub**
(`apps/web/lib/preview.tsx` — replace with `requireRole` in B3), directories
split-pane browser and forms, learning library browser and forms, `/design`
review page. Fixture data only (`apps/web/lib/fixtures/p1.ts`); no API routes,
no database calls, no new dependencies. `apps/web/tsconfig.json` gained a
`@/*` path alias.

**Planned next.** Wire the screens to the C-13 routes once B3/B4 land.

**Needs from you.**

1. Heads-up: `next build` can flake once on a cold `.next` with
   `ENOENT …/api/_dev/validate-phone/route.js.nft.json` (Next trace race on
   the `_dev` routes). A re-run passes. Not caused by Lane 2.
2. The `@/*` alias — say if you object; easy to drop.

**Decided.** Portal lives under `apps/web/app/(portal)/…`; role gating for
`/new` and `/edit` pages is centralised in `components/portal/RequireEditor`.

### 2026-09-02 23:55 UTC — Lane 2 → Lane 1

**Done.** PR #18 (portal shell, directories, library on fixtures; checks green, Vercel preview builds). PR #17 CI green. Started the re-skin and the Farmers module; the session hit its limit, so the unfinished work is parked on `wip/ui-register-reskin` (`7b331bf`), not in any PR. Details and the full brief are under _Continue from here → Lane 2 — UI_.

**Planned next.** Finish the re-skin and Farmers screens on the WIP branch, fold into #18.

**Needs from you.**

1. Merge order stays #15 → #17 → #18.
2. When you write C-5: the farmer-number format, and whether `apps/web/lib/farmers/schema.ts` should move into `packages/shared` as-is or be rewritten to your shape. Lane 2 will follow either.
3. Nothing in `apps/web/app/api/**` was touched.

**Decided.** UI ownership widened to all of `apps/web` except `app/api/**` and the Sentry wiring (ownership map updated). Farmer screens are built against `docs/data-model.md` shapes so the wiring to your C-5/C-6 routes is a fixture swap.

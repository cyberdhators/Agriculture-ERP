# PROJECT STATE

Read this at the start of every session, after `CLAUDE.md`. It records
decisions and constraints that are not derivable from the code.

`CLAUDE.md` is the law. This file is the running state.

---

## CREDENTIALS

**Claude may hold STAGING credentials.** They live in `.env.local` at the
repository root, which is git-ignored. Claude may read them, run database
commands against staging, and report what those commands returned.

**Claude will never hold production credentials.** Production values live only
in Vercel and in GitHub secrets. They are never placed in `.env.local`, never
pasted into a session, and never committed.

**If anything from production is ever needed, Claude stops and asks.** No
exceptions, no workarounds, no "just this once to check something".

The staging Supabase project reference is `xmmxbrxmfgodhpwolrvk`. It is not a
secret. The connection strings that contain it are.

---

## GUARDS ARE TESTED IN BOTH DIRECTIONS

**Rule: no unit is done until every guard it introduces has been tested both
refusing and accepting.** Refusal alone is not evidence.

**What happened.** During unit B1.3, a project reference that had been invented
rather than issued sat in the `db:reset` guard for about an hour before it was
corrected. No real Supabase project existed yet when the guard was written.

**Why it went unnoticed.** The guard was tested three times, and every test was
a refusal: the unset placeholder, a missing `.env.local`, and a deliberately
wrong project reference. All three passed. The direction never tested was
**acceptance** — that the guard lets the real staging project through — because
there was no real project to test with. A guard that refuses everything passes
every refusal test perfectly.

**What the damage could have been.** Limited, because the guard fails closed:
with a wrong reference it refuses the real staging project too. So it could not
have reset the wrong database. The real costs were a `db:reset` that would never
have run, and a false sense of protection.

**What testing acceptance immediately found.** The first genuine acceptance test
exposed a second, unrelated bug: the guard spawned `prisma` by bare name and
relied on `pnpm` putting `node_modules/.bin` on `PATH`, so it crashed with
`spawn prisma ENOENT` when run any other way. That bug was invisible to every
refusal test, because refusal returns before anything is spawned.

**How to test acceptance safely.** Point the guard at a connection string that
contains the real project reference but an unroutable host — for example
`127.0.0.1` on a port with nothing listening. The guard accepts, the command
launches, and the connection fails harmlessly. Nothing real is touched.

---

## STACK DECISIONS NOT OBVIOUS FROM THE CODE

**Prisma is pinned to exactly 6.19.3**, both `prisma` and `@prisma/client`, no
carets. This is deliberate, not neglect. The pooled-plus-direct connection
pattern in `schema.prisma` is the path Supabase documents; this team cannot read
code; a well-trodden path is worth more than being current.

Prisma 7 removes `url` and `directUrl` from the datasource block and replaces
them with a config file and a driver adapter. That upgrade happens once,
deliberately, as its own unit with its own attack review — never as a side
effect of scaffolding.

Note: `@prisma/engines-version` resolves to a 7.x-numbered version. That is
Prisma's internal engine pointer, versioned independently of the CLI. It is not
a Prisma 7 installation.

**`prisma migrate dev` is not used on this project.** It requires a shadow
database that it creates itself, and the Supabase `postgres` role cannot create
databases. Migrations are hand-written SQL applied with `prisma migrate deploy`.

**Prisma connects as database owner and bypasses row-level security by design.**
RLS is the backstop against the anon and authenticated keys, not against our own
server. Server-side authorisation is `requireRole` in the API routes.

---

## OUTSTANDING ITEMS — THINGS THAT EXIST AND MUST BE REMOVED

This list holds things that **exist in the repository today** and are scheduled
for deletion. It is not a list of intentions. Nothing is added here before it
exists, and nothing is deleted from here except by deleting the thing itself.

| Item                            | Added | Removed in | Why it exists                                                                                                                                                                                            |
| ------------------------------- | ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/_dev/validate-phone` | B1.4  | **B3**     | Proves `docs/api/CONVENTIONS.md` and the Zod schemas in `packages/shared` agree inside a running server, before `requireRole` exists. It is unauthenticated, which every other route is forbidden to be. |

**Deleting `/api/_dev/validate-phone` in B3 means all five of these, together:**

1. `apps/web/app/api/_dev/validate-phone/route.ts`
2. `devValidatePhoneBodySchema` in `packages/shared/src/dev.ts` (and the file,
   and its export from `src/index.ts`)
3. `apps/web/tests/dev-validate-phone.test.ts`
4. The row above
5. The `/api/_dev/*` exception paragraph in `docs/api/CONVENTIONS.md` section 2

When this table is empty, the `/api/_dev/*` exception is removed from
CONVENTIONS.md entirely rather than left standing with nothing under it.

### Documented behaviour that cannot yet be reached

These are agreed, written into `docs/api/CONVENTIONS.md`, and **impossible to
test today** because no route can produce them. A code that cannot be reached
must be visibly parked, not silently dead. The unit named against each one is
the unit that must make it reachable and testable in the same change.

| Behaviour               | Made testable by | Why it is unreachable today                                                                                                                               |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_cursor` (400)  | **B3**           | No cursor format exists. No route returns a list, so nothing issues a cursor and nothing can judge one unreadable. `paginationSchema` accepts any string. |
| `unauthenticated` (401) | **B3**           | `requireRole` does not exist.                                                                                                                             |
| `forbidden` (403)       | **B3**           | No roles exist.                                                                                                                                           |
| `not_found` (404)       | **B3**           | No record and no scope resolution exist.                                                                                                                  |
| `conflict` (409)        | **B2**           | No record and no client-UUID idempotency exist.                                                                                                           |
| `unprocessable` (422)   | **B2**           | No business rules exist. Its message is written by the rule that raises it, so each rule must also state its exact sentence.                              |

The "Emitted today?" column in CONVENTIONS.md section 5 is the same information
at the point of use. **Both must be updated together** — when a unit makes one of
these reachable, it changes that column to _Yes_ and deletes the row here.

**A rule for B1.5.** The B1.5 plan includes a `_dev/throw` route for proving
Sentry receives an unhandled error. It does not exist yet. **If B1.5 creates
it, B1.5 adds it to this table in the same change** — a `_dev` route and its row
here are created together or not at all.

---

## BLOCKED

**`docs/scope-and-acceptance.md` does not exist.** `CLAUDE.md` section 1 names
it the only scope document and the source of truth for the twenty contracted
deliverables (a)–(t). The file is not in the repository.

This does not block B1.4 or B1.5, which are scaffolding and claim no acceptance
criteria. **It blocks B2.** Farmer registration cannot begin without the
criteria it is written against, because there would be nothing to mark DONE or
NOT DONE against, and no way to tell a contracted field from an invented one.

Resolve before B2 starts.

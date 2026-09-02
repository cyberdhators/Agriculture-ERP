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

| Item                            | Added | Removed in | Why it exists                                                                                                                                                                                                                 |
| ------------------------------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/_dev/validate-phone` | B1.4  | **B3**     | Proves `docs/api/CONVENTIONS.md` and the Zod schemas in `packages/shared` agree inside a running server, before `requireRole` exists. It is unauthenticated, which every other route is forbidden to be.                      |
| `POST /api/_dev/throw`          | B1.5  | **B3**     | Throws on purpose, so error reporting can be proved end to end: an error nobody caught reaching Sentry with the environment and version tags attached and the scrubber having run. Unauthenticated, under the same exception. |

**Deleting `/api/_dev/validate-phone` in B3 means all five of these, together:**

1. `apps/web/app/api/_dev/validate-phone/route.ts`
2. `devValidatePhoneBodySchema` in `packages/shared/src/dev.ts` (and the file,
   and its export from `src/index.ts`)
3. `apps/web/tests/dev-validate-phone.test.ts`
4. The row above
5. The `/api/_dev/*` exception paragraph in `docs/api/CONVENTIONS.md` section 2

**Deleting `/api/_dev/throw` in B3 means all four of these, together:**

1. `apps/web/app/api/%5Fdev/throw/route.ts`
2. Its row above
3. The two divergence notes immediately below
4. The `/api/_dev/*` exception paragraph in `docs/api/CONVENTIONS.md` section 2,
   if `validate-phone` has also gone by then

**`/api/_dev/throw` diverges from CONVENTIONS.md in two agreed ways.** Both were
decided deliberately in B1.5, both are temporary, and both die with the route.

| Divergence                                                                                                                                                                                                               | Why it was accepted                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Its response is **not** the documented error shape. It throws unhandled, so the framework answers, not us — no `error` object per §4, not the fixed sentence of §5.4, and not necessarily the JSON content type of §3.1. | Catching the error would produce a correct response and prove far less. It would test our own call to Sentry rather than Sentry's capture of an error nobody handled, which is the only thing worth proving. |
| It throws **before** the §9.1 `Content-Type` check, so a request with no `Content-Type` gets a 500 rather than a 415.                                                                                                    | It reads no body, so there is nothing to check, and returning 415 would defeat the route's only purpose.                                                                                                     |

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

Two whole sections of `docs/api/CONVENTIONS.md` are parked the same way, for the
same reason:

| Parked section                                                                             | Unparked by | Why it is unreachable today                                                                      |
| ------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------ |
| **§6 Lists** — the `page` object, cursors, the deterministic sort, the `deleted_at` filter | **B3**      | No route returns a list. `paginationSchema` is testable as a schema; the list responses are not. |
| **§7 Timestamps** — ISO 8601 UTC with milliseconds and a `Z`                               | **B3**      | No response contains a timestamp, because no route returns a stored record.                      |

---

## B3 OPENING TASKS

Two obligations B1.4 hands to B3. Neither is optional, and both belong at the
start of B3 rather than the end.

**1. Unpark §6 and the timestamp rule once the first list route exists.** Both
are marked _Emitted today? No — B3_ in `docs/api/CONVENTIONS.md`. The unit that
builds the first route returning a list, or the first response carrying a stored
record, removes the parking note and adds the tests that were impossible before.
Parking is a promise to come back, not a place to leave things.

**2. Move the code-in-the-right-situation guarantee into the shared route
wrapper.** The drift test added in B1.4 locks the documented sentences to the
exported constants, and that is all it does. **It does not prove a route emits
the right code in the right situation.** A route changed to return `400` where
`415` belongs leaves both tables matching and the drift test green. Today that
gap is covered for one route by its own tests, and nothing generalises it.

B3 builds a shared route wrapper for `requireRole`. That wrapper is the right
place for the behaviour every route must share and must not restate: the
`Content-Type` check, the body size cap, the JSON parse, the documented `405`,
and the fixed `500`. Once routes are built on it, those guarantees hold by
construction instead of by each author remembering. The `405` handlers in
`/api/_dev/validate-phone` exist only because no wrapper does yet.

**3. Emit a correlation id from the shared route wrapper.** B1.4 deferred this
to B1.5; B1.5 deferred it to B3, and the reason is stronger than "the wrapper
does not exist yet". A correlation id is only worth having if **every** route
emits one. A header that appears on some routes and not others is worse than
none, because you cannot tell a request that had no id from one whose error was
never reported. It belongs with the other guarantees the wrapper owns.

**4. Enforce the "error messages never name a person" rule in the wrapper.**
B1.5 established it as a standing rule and proved why it is needed: a name in
free text reaches Sentry intact, and the scrubber cannot detect one. Today the
rule is remembered rather than enforced, which will not survive B5 to B9 where
almost every error concerns a specific farmer.

The shared route wrapper is where it becomes structural rather than
remembered. It already owns the fixed 500 sentence -- the same idea, for the
same reason. What that enforcement looks like is B3's design decision; that it
is B3's job is not.

**The rule for B1.5 was met.** B1.5 created `/api/_dev/throw` and added its row
to the outstanding items table in the same change. The rule stands for any
future `_dev` route: it and its row are created together or not at all.

---

## ERROR REPORTING (B1.5)

**The Sentry DSN is public on purpose, and is not a leak.** It is exposed to the
browser as `NEXT_PUBLIC_SENTRY_DSN`. A DSN is a **write-only ingest key**: it can
create error events in one project and can read nothing — not events, not
members, not settings. Client-side errors cannot be reported at all unless the
browser has it. Anyone reading the bundle can send us junk error events, which
is the whole of the risk. `.gitleaks.toml` scans for DSNs anyway, because the
scanner should know every credential shape in the project; a DSN being harmless
to expose is a fact about Sentry, not a reason to stop looking for it.

**No source maps are uploaded, and client stack traces are minified because of
it.** Uploading needs a build-time `SENTRY_AUTH_TOKEN` and CI wiring, and B1.5
was not permitted to touch CI. `@sentry/cli` is therefore recorded in
`pnpm-workspace.yaml` as a build that is deliberately **not** run — it exists
only to upload source maps. **Server-side** stack traces are unaffected and
readable. **A B3-or-later task**, with that cost stated.

### What an arriving event actually looks like

Redacting every key called `name` was applied literally, as agreed. Expect
sparseness rather than meet it during an incident:

- `contexts.os.name`, `contexts.runtime.name` and every other nested `name`
  arrive as `[redacted]`. The versions beside them survive.
- `sdk.name` **does** arrive, as the constant `sentry.javascript.nextjs`. Sentry
  attaches it during envelope assembly, after `beforeSend` has run, so the
  scrubber never sees it. It carries nothing personal.
- What remains, and is what an error is actually read from: the exception type
  and message, the full stack trace with filenames, line and column numbers, the
  `environment` and `app_version` tags, the release, the level, and device,
  memory and locale context.

### The scrubber is the last gate we control, not the last gate

`beforeSend` is the final point in the pipeline that runs **our** code. The SDK
continues to build the envelope after it returns, and fields attached in that
window are never seen by the scrubber.

One field does this today: **`sdk.name`** arrives as the constant
`sentry.javascript.nextjs`, despite the rule that redacts every key called
`name`. It carries nothing personal, so there is nothing to fix.

**The limit is what matters, not that field.** Our rule covers everything the
scrubber can reach, and nothing it cannot. If a future SDK version attaches
anything else after `beforeSend` — a new context, a new default field, richer
metadata — **it is outside the rule and will not be redacted**, silently.

There is no way to assert against this in advance. The only way to find it is
the way it was found in B1.5: capture a real transmitted envelope and read it.
**Any SDK upgrade should do that**, and compare against what this document
records above.

### Three leaks found by reading a transmitted envelope

None was visible from reading the code, and none was in the original brief.

| Found                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **`ContextLines` shipped source code.** It attaches the source lines around the throw site verbatim. Those lines are code, so the scrubber's rules — values under a named key, strings shaped like a phone number — cannot judge them. A literal, a field name or a comment near a failure travelled to Sentry exactly as written. | Integration disabled. Filenames, line and column numbers survive, which is what a stack trace is for.                                  |
| **`server_name` shipped a person's name.** Sentry defaults it to the machine hostname, which on a laptop is often `<someone>s-MacBook-Air.local`.                                                                                                                                                                                  | `serverName` is set to the environment name instead.                                                                                   |
| **Four tests passed while transmitting nothing.** Closing the Sentry client between tests left it closed, so every "no personal data appears" assertion passed against an empty payload.                                                                                                                                           | Every envelope test now asserts something _was_ transmitted before asserting what it did not contain. The B1.3 lesson, in a new place. |

### STANDING RULE: error messages never name a person

**Error messages, log lines and exception text never interpolate a farmer's
name, phone number or national ID. Reference records by id only.**

Not `could not register Achol Deng`, but `could not register farmer
0f3c1a9e-...`.

**Why this is a rule and not a preference.** The scrubber removes values under
named keys and strings shaped like a South Sudan number. Nothing distinguishes a
person's name from any other word in a sentence, so **a name written into an
error message reaches Sentry intact**. Verified in B1.5, and there is a test
named as a known limit so it cannot be assumed away.

Today the only protection is that we do not do it. **That is a discipline, not a
guarantee**, and a discipline decays: B5 through B9 are modules where nearly
every error is about one specific farmer, written by whoever is working that
week. The rule has to outlive the person who remembers why.

**A national ID is the worst case.** It is not scrubbed by any rule -- it is not
a listed key when written in free text, and it is not phone-shaped -- and it is
the one identifier a farmer cannot change after it leaks.

Enforcement belongs in the shared route wrapper, in B3. See the B3 opening
tasks.

### What the scrubber does not do

Stated so it is not assumed away:

- **A personal name or national ID in free text survives.** This is the one that
  will bite, and it has its own standing rule above — see "error messages never
  name a person". There is a test named as a known limit.
- **The phone pass over-matches, deliberately.** Any run of digits containing
  something that parses as a South Sudan number is redacted whole, so a
  13-digit millisecond timestamp or a 12-digit integer id is occasionally lost.
  ISO timestamps, UUIDs, ports, process ids, stack offsets, SHAs and numbers
  from other countries are unaffected. A redacted timestamp is cheaper than a
  leaked farmer's number.
- **Stack frames from `node_modules` carry absolute file paths**, which on a
  developer's machine include the operating-system username. Deployed builds run
  from a deployment path with no username in it, and local machines have no DSN
  configured, so nothing is sent from the place where this applies. Not fixed,
  because rewriting filenames would damage the stack traces the reports exist
  for. Stated so it is known rather than discovered.
- **Candidates are confirmed by `parseSouthSudanMobile`**, so there is exactly
  one definition of a valid South Sudan number in the codebase rather than a
  regex that can drift from `phoneSchema`.

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

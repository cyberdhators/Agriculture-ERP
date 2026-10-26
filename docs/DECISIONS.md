# DECISIONS

**Why things are the way they are.** Append-only: entries are added, not
rewritten, and not deleted when they stop being current — a decision that was
reversed is more useful with its reversal recorded beneath it than gone.

**No session needs to read this at start.** `docs/PROJECT-STATE.md` is the
running state and is deliberately short. This file is where you look when
PROJECT-STATE says _what_ and you need _why_, or when you are about to undo
something and want to know what it cost to learn.

`CLAUDE.md` is the law. `docs/PROJECT-STATE.md` is the running state. This is
the reasoning.

---

## B1.3 — A guard that refuses everything passes every refusal test

**The rule this produced: no unit is done until every guard it introduces has
been tested both refusing and accepting.** Refusal alone is not evidence.

A project reference that had been invented rather than issued sat in the
`db:reset` guard for about an hour. No real Supabase project existed yet when
the guard was written.

It went unnoticed because the guard was tested three times and every test was a
refusal: the unset placeholder, a missing `.env.local`, and a deliberately wrong
project reference. All three passed. The direction never tested was
**acceptance** — that the guard lets the real staging project through — because
there was nothing real to test against.

The damage would have been limited: the guard fails closed, so with a wrong
reference it refuses the real project too and could not have reset the wrong
database. The real costs were a `db:reset` that would never have run, and a
false sense of protection.

**Testing acceptance immediately found a second, unrelated bug.** The guard
spawned `prisma` by bare name and relied on `pnpm` putting `node_modules/.bin`
on `PATH`, so it crashed with `spawn prisma ENOENT` when run any other way. That
was invisible to every refusal test, because refusal returns before anything is
spawned.

**How to test acceptance safely.** Point the guard at a connection string
containing the real project reference but an unroutable host — `127.0.0.1` on a
port with nothing listening. The guard accepts, the command launches, the
connection fails harmlessly, nothing real is touched.

This lesson has since caught two more defects, in B1.4 and B1.5. Both are below.

---

## B1.4 — Why 404 covers three different situations

An officer in Yei requesting a farmer in Juba gets exactly what they would get
for an id that never existed: `404`, identical body.

Returning `403` for "exists but is not yours" tells the caller the record
exists. Repeated against guessed ids, that reveals which farmers are registered
and roughly how many — a data leak achieved without reading a record.

The full reasoning lives in `docs/api/CONVENTIONS.md` §5.1, where a session
changing the code will actually see it. It is noted here because it is the rule
most likely to look like a bug to someone who has not read the reasoning.

---

## B1.4 — Unknown request fields are rejected, not stripped

Stripping is the usual default and it is wrong here. A stripped field means an
officer fills something in, the request succeeds, and the value silently never
saves. That is the one class of failure an officer in a field cannot detect:
there is no error and the screen says it worked.

B9 revisits this for the sync endpoint only, where a phone running an older app
version sending a removed field is a real case and rejecting a whole offline
batch has a different cost.

---

## B1.4 — The document must not be able to drift from the code

Two people who cannot read code run this project. The substitute for a second
pair of eyes is that a separate session, which has never seen the
implementation, writes tests from `docs/api/CONVENTIONS.md` alone.

That only works if the document is true. So the error messages and status codes
are pinned in the document, and a test reads those tables out of the Markdown
and compares them to the exported constants. Changing either side alone turns it
red.

**Discovered again from the other end, 2026-09-14.** The same principle turned
up independently in `docs/PROJECT-STATE.md`, _read a document as its recipient
before it goes_ — three faults in a finished vendor request became visible only
when it was read as the support desk rather than as its author. B1.4 reasoned
from a constraint (nobody here can review code) to the method; that entry
reasoned from an accident to the same method. **A check performed by someone who
shares the author's knowledge confirms the author's model, which is the one part
already known to be consistent.** Two instances of one idea, reached from code
and from prose.

**Tested in both directions**, per B1.3: deliberately broken four ways — a
message changed in the code alone, the same message changed in the document
alone, a code added to the document the code does not define, and a pinned
reason deleted from the document. All four red, green again on restore.

**What it does not do:** it locks sentences to constants. It does not prove a
route emits the right code in the right situation. A route returning `400` where
`415` belongs leaves both tables matching and the test green. That gap is B3's,
in the shared route wrapper.

---

## B1.4 — Two defects the tests could not see

Both would have shipped. Both were found by reading build output and by running
a real server, not by testing.

**The route did not exist as a URL.** Next treats a leading-underscore folder as
private and excludes it from routing, so `/api/_dev/validate-phone` returned
404 to any real caller. Every test passed, because tests import the handler
directly and never touch routing. The folder is named `%5Fdev` on disk, which
serves the underscored URL.

**405 came back with an empty body**, contradicting the status table. Next
answers an unsupported method itself. Explicit handlers now return the
documented shape.

---

## B1.5 — Three leaks found by reading a transmitted envelope

None was visible from reading code. Each was found by capturing what the SDK
actually handed to the network.

**`ContextLines` shipped source code** — the lines around the throw site,
verbatim. They are code, so the scrubber's rules (values under a named key,
strings shaped like a phone number) cannot judge them. **Disabling the
integration was not enough:** with it removed from the loaded set, a live server
still transmitted `context_line` and `pre_context`, because something else in
the Next.js error path fills them in. Stripped at the scrubber instead, which is
the last gate and cannot be bypassed by whoever added the data.

**`server_name` shipped a person's name.** Sentry defaults it to the machine
hostname, which on a laptop is `<someone>s-MacBook-Air.local`. Now the
environment name.

**Four envelope tests passed while transmitting nothing.** Closing the Sentry
client between tests left it closed, so every "no personal data appears"
assertion passed against an empty payload. Every such test now proves something
_was_ transmitted before asserting what it did not contain. The B1.3 lesson, in
a new place.

**The practice this produces: after any Sentry SDK upgrade, capture a real
transmitted envelope and read it.** There is no way to assert in advance against
fields the SDK attaches after `beforeSend`.

---

## B1.5 — Why the phone scrubber over-matches on purpose

The candidate pass is a deliberately wide net; each candidate is then confirmed
with `parseSouthSudanMobile`, so there is exactly one definition of a valid South
Sudan number in the codebase rather than a regex that can drift from
`phoneSchema` — the same drift problem `docs/api/CONVENTIONS.md` §8 records about the
Dart checks.

Measured cost: ISO timestamps, UUIDs, ports, process ids, stack offsets, SHAs
and other countries' numbers survive. A 13-digit millisecond timestamp that
happens to contain a valid pattern, and some 12-digit integer ids, are redacted
whole. **A redacted timestamp in a stack trace is cheaper than a leaked farmer's
number.**

---

## B1.5 — Why every key called `name` is redacted, including Sentry's own

Applied literally, so `contexts.os.name` and `contexts.runtime.name` arrive as
`[redacted]`. Events look sparse.

A rule with carve-outs is a rule someone widens later, and what is lost is
metadata rather than diagnosis: the exception type and message, the full stack
trace with filenames and line numbers, the environment and version tags all
survive.

---

## B1.5 — The Sentry DSN is public on purpose

It is exposed to the browser as `NEXT_PUBLIC_SENTRY_DSN`. A DSN is a
**write-only ingest key**: it creates error events in one project and reads
nothing — not events, not members, not settings. Client-side errors cannot be
reported at all unless the browser has it. The whole of the risk is that someone
reading the bundle can send us junk events.

`.gitleaks.toml` scans for DSNs anyway. The scanner should know every credential
shape in the project; a DSN being harmless to expose is a fact about Sentry, not
a reason to stop looking for it.

---

## B1.5 — One limit accepted rather than fixed

**Stack frames from `node_modules` carry absolute file paths**, which on a
developer's machine include the operating-system username. Deployed builds run
from a deployment path with no username in it, and local machines have no DSN
configured, so nothing is sent from the place where this applies.

Not fixed: rewriting filenames would damage the stack traces the reports exist
for. Recorded so it is known rather than discovered.

---

## Housekeeping — RLS on Prisma's migration-history table

Every table this project creates enables row-level security in the same
migration that creates it. `_prisma_migrations` broke that rule because **we did
not create it**: Prisma creates it on first `migrate deploy`, and Prisma does
not enable RLS.

Supabase's advisor flagged it **critical**. Without RLS, anyone holding the
staging anon key could read the migration history and, worse, modify or truncate
it — which would make the database's record of what had been applied disagree
with the repository, silently, with nothing to notice it.

It is now covered by the same deny-by-default rule every project table follows,
in its own migration, applied and verified.

**The advisory that remains is the intended state.** Supabase now reports
`rls_enabled_no_policy` at INFO level: RLS on, no policies. That is not a
defect to fix — it is exactly what `CLAUDE.md` prescribes. RLS with no policies
denies the anon and authenticated keys everything, while the server connects as
owner and bypasses it deliberately. **A future session must not "resolve" this
by adding a permissive policy.**

Verified in both directions, per B1.3: the anon path is closed (RLS reported
enabled), and the owner path still works (`migrate status` reports 4 migrations
applied, no drift).

---

## Housekeeping — the Supabase MCP server is narrower than its URL

The server was re-added with `read_only=true` removed and `account`, `functions`
and `branching` in the feature list. **That was flagged as granting write access
to staging and account-level reach past the project. Verified afterwards, and it
does not.**

What was observed rather than assumed:

- `execute_sql` runs as `supabase_read_only_user`.
- `CREATE TEMP TABLE` is refused: _cannot execute CREATE TABLE in a read-only
  transaction_.
- No `apply_migration` tool exists in the surfaced tool set.
- `account` surfaced **no** account-level tools, because the URL pins a single
  `project_ref`.

**The read-only posture stands, now confirmed by observation rather than by
configuration.** That distinction matters: it does not depend on the URL keeping
a flag, so it should be re-checked the same way — by trying a write — after any
change to the server URL or any upgrade of the MCP server itself.

It remains true that schema changes must never be applied through this server
even if it one day permits them. Supabase tracks migrations in its own table and
Prisma tracks them in `_prisma_migrations`; applying through the API would
create two competing histories. `list_migrations` returns empty while Prisma
reports four applied, which is that divergence visible in miniature.

---

## Housekeeping — a credential backup was one command from being committed

Taking a backup of `.env.local` before editing it produced `.env.local.bak-b2`,
holding a live staging credential in plaintext inside the repository directory.

The ignore rules were `.env`, `.env.local` and `.env.*.local`. **None of them
matched it.** A `git add -A` would have committed it. gitleaks scans the diff
and would likely have caught the connection string on the way past, but that is
a backstop, not a rule.

The patterns are now `.env`, `.env.*`, and `!.env.example` — ignore every
variant, let the example back in explicitly. Checked in both directions:
`.env.local.bak`, `.env.local.old` and `.env.backup` are ignored, and
`.env.example` is still tracked.

The near-miss is recorded because the failure was in the rules, not in the
person: a backup is an ordinary thing to take before editing a file, and the
rules should survive ordinary things.

---

## B1.6 — Why this file exists

`docs/PROJECT-STATE.md` had grown to 332 lines across six units. It is read at
the start of every session, and a document that long stops being read.

The split: PROJECT-STATE holds what is **true now and must be acted on** and
stays under two pages. This file holds **why**, and may grow without limit
because nobody has to read it to start work.

---

## Housekeeping — the environments were never separate

**The rule this produced: a guard that identifies an environment by reference
must also be checked against that environment's name, by someone reading both.**

`docs/PROJECT-STATE.md` recorded two Supabase projects: staging, reference
`xmmxbrxmfgodhpwolrvk`, and a production project that "exists but holds no data
and receives no migrations until B11". The second was never true.

Read from the Supabase Management API on 2026-09-02, the account holds exactly
one project. Its reference is `xmmxbrxmfgodhpwolrvk`. Its name **was**
`agri-production` when this was written on 2026-09-02; it was renamed to
`agri-staging` on 2026-09-03, which is what this entry asked for. Everything this repository calls staging — `.env.local`, the
MCP server in `.mcp.json`, four applied migrations, the `_smoke` table created
and dropped in B1.3 — happened inside a project named production.

**This is the B1.3 lesson one level up.** That entry established that a guard
must be tested accepting as well as refusing, and the `db:reset` guard was duly
tested in both directions. Acceptance was proved by pointing at the real
reference on an unroutable host: the guard accepted, the connection failed
harmlessly, the test passed. It confirmed that the guard accepts
`xmmxbrxmfgodhpwolrvk`. Nobody asked what `xmmxbrxmfgodhpwolrvk` was called. A
twenty-character reference carries no meaning a reader can check, which is why
it is the right thing for a guard to compare — and why it hid this.

**The decision: rename rather than promote.** The single project becomes
`agri-staging`, and production is created new at B11. The reference is
immutable, so the rename changes nothing here — no code, no configuration, no
migration history.

The reverse, promoting this project to production, was rejected. It has held
developer credentials on a laptop, carries a throwaway `_smoke` table in its
migration history, and an account-wide Supabase personal access token reaching
it was pasted into a chat session. A database with that history should not be
the one holding farmer records. Production should be born clean.

> **Two claims in the first version of this entry were wrong, corrected here
> rather than quietly edited.** It said the credentials had "twice left the
> vault", the second instance being `.env.local.bak-b2` "in a repository that is
> public". Checked afterwards:
>
> - **The repository is private**, not public.
> - **`.env.local.bak-b2` was never committed.** It sat in the working directory
>   and was deleted there. `git log --all --diff-filter=A` finds it in no commit
>   on any branch, and no connection string appears anywhere in the full history.
>
> The near-miss was real and is recorded above — the ignore rules did not match
> it, so an ordinary `git add -A` would have committed it. But it did not happen,
> and a permanent record should not say it did.
>
> **The decision is unchanged.** One credential exposure is enough on its own:
> an account-wide token that reached this project was pasted into a chat and, at
> the time of writing, has still not been revoked. Production should be born
> clean regardless.

**Also decided:** rotate that project's database password, and revoke the
personal access token. Both are cheap now and get dearer with every unit.

**What was not built.** Making `scripts/db-reset.mjs` verify the project's
_name_ was considered and rejected. The script holds connection strings, not
names, so the check would need a Management API call and a token — more
credential surface inside a destructive script, to defend a distinction that
disappears once production is simply not on the same account. The protection is
structural instead: production is not created until B11, and its credentials
never go in `.env.local`.

---

## B2 — `deleted_by` carries no foreign key until B3, and that is the precedent

`docs/data-model-extension.md` §1.3 defines `deleted_by` as a foreign key to
`user`. B2 created the first three tables and the `user` table does not exist
until B3, so the column had to point at nothing or not exist.

**Decided: carry it now as a nullable `uuid` with no foreign key. B3 adds the
constraint with `ALTER TABLE`.**

The column shape stays stable, so no later migration alters these tables to add
a column. And **adding a constraint to a populated table is cheaper and safer
than adding a column to one** — the constraint is validated against existing
rows, which are all null here, so it cannot fail.

**This is the precedent every table created between B2 and B3 inherits.** Any
such table carries `deleted_at timestamptz` and `deleted_by uuid`, both nullable,
neither keyed. B3 adds every missing key in one migration. It is listed as a B3
opening task so the debt is paid rather than remembered.

---

## B2 — C-2.3 is a composite foreign key, not a trigger and not a CHECK

Every payam carries `state_id` directly as well as through its county, and the
two must always agree. Three ways to enforce that:

A **CHECK constraint cannot see another table**, so it cannot compare a payam's
state to its county's state at all.

A **trigger** can, but it must be written correctly for inserts and for updates
on both sides, it can be disabled, and it is code that has to be maintained.

A **composite foreign key** — `(county_id, state_id)` referencing
`county(id, state_id)`, with a `UNIQUE (id, state_id)` on county as its target —
is declarative, is enforced on insert and on update, cannot be disabled without
being dropped, and additionally stops a county being moved to another state
while payams still point at the old one. That last property was not asked for
and is the strongest argument for it.

The extra `UNIQUE (id, state_id)` on county looks redundant beside its primary
key. It is not: a composite foreign key needs a unique constraint spanning
exactly the columns it references.

---

## B2 — the dependant check names no table, on purpose

C-2.7 requires the reseed to refuse removing a location that other records
depend on. When B2 was built, `farmer`, `officer` and `cooperative` did not
exist.

**Hardcoding those names would have been worse than useless.** A guard that
names three tables which never appear refuses nothing, forever, while looking
exactly like a guard that works. That is the B1.3 failure mode with a longer
fuse: it would have passed every test written against it and started silently
failing the moment B5 created `farmer` under a slightly different name.

Instead it asks `pg_constraint` which foreign keys point at the location tables
and counts through whatever it finds. It protects tables that do not exist yet,
with no change to the code, the moment they declare a key.

**The limit, stated in the code and here:** it sees dependants declared as
FOREIGN KEYS. A future table holding a payam code as loose text with no key is
invisible to it. That is an argument for always declaring the key, and B5 onward
should treat it as one.

---

## A chat exposure is not a repository exposure

The account-wide Supabase token was pasted into a chat session. It was never in
the repository, and the two need different responses.

**A repository exposure** means rewriting history, force-pushing, and treating
every clone and fork as compromised — the credential is in objects other people
already hold.

**A chat exposure** means revoking the credential. Nothing else. There is no
history to rewrite.

Recording them as one thing sends the next person hunting through git history
for something that was never there. Worse, it can make a revoked token look like
a live one: the search comes back empty, and nobody knows whether that means
"clean" or "looked in the wrong place".

The same applies to `.env.local.bak-b2`. It sat in the working directory and was
deleted there. The ignore rules did not match it, so it _could_ have been
committed — that near-miss is real and recorded above. It was not committed.

**Both facts belong on the record: the exposure that happened, and the exposure
that did not.**

---

## C-13 was built three phases early, and was closed rather than merged

Two pull requests arrived building directories and the learning library —
deliverables (i), (j), (k), (m) — with a portal shell around them. Both were
closed unmerged on 2026-09-03.

**They ran three phases ahead.** `CLAUDE.md` §2 puts directories in phase 4.
Phases 1 to 3 — auth, roles and permissions; farmer registration; extension
visits — do not exist. The order is not a preference: §2 gives its reason, that
a defect in the foundations is expensive once field data exists.

**There was no `requireRole` to place behind them.** Neither added an API route,
so nothing violated the authorization law yet. But sixty-five files of portal
screens arriving before the thing that protects them is a large surface waiting
for a guard that has not been designed.

**They were written against criteria that do not exist.** C-13 is under
"sections not yet written" in `docs/scope-and-acceptance.md`, which states that
sections are written one unit ahead of the build so criteria reflect what the
preceding unit actually produced. Building first inverts that.

**They edited `CLAUDE.md` and `docs/scope-and-acceptance.md`.** One is the law,
the other derives from a signed contract. Neither should move inside a feature
branch.

**And they could not be inspected.** Sixty-five files in one pull request,
touching B2's migration and `packages/shared/src/location.ts`, is more than a
review can honestly cover. **Closing was the reviewable decision; merging would
not have been.** A reviewer who cannot inspect a change and merges it anyway has
not reviewed it, whatever the record says afterwards.

The branches are kept. The work is not wasted — it is early, and it will be
worth reading when C-13 is actually reached.

---

## B3 — Officers authenticate by phone, through a derived identifier

**C-3.7 says extension officers authenticate by phone number and password. They
do. What changed is what happens underneath, and why.**

Supabase's Phone provider is **disabled on this project**, and enabling it
requires selecting an SMS provider from a fixed list: Twilio, Twilio Verify,
MessageBird, Vonage, Textlocal. **Africa's Talking — our contracted provider
under F-03 — is not on that list.**

Verified against staging on 2026-09-03 rather than assumed. An officer account
with a phone and password was created successfully (`200`), and signing in with
that phone and password was refused: `422 phone_provider_disabled, "Phone logins
are disabled"`. The same test on the email path succeeded end to end.

**Three options, and why C:**

**A — enable the Phone provider with a supported SMS provider.** Means paying
for a second SMS provider purely to satisfy a toggle, for one-time codes we
never send. It also contradicts the stack table, which names one SMS provider.

**B — enable the provider without SMS credentials, through the Management API.**
Plausible: the OTP endpoints are ones we never call. **Unverified**, and
verifying it needs a Management API token that was deliberately revoked. A
security decision should not be undone to save a configuration step.

**C — derive an authentication identifier from the phone number.** The officer
types their phone number and password, exactly as C-3.7 requires. Underneath,
the account is keyed by a deterministic identifier derived from the E.164
number, on a non-routable domain, and no message is ever sent to it. **The only
option verified working end to end.**

### The rules this comes with

- **Derived in exactly one function**, deterministically, from the E.164 phone.
- **Never typed by a human, never displayed, never in an error message.** It is
  an authentication detail, not an address.
  _Amended 2026-09-14 by Lane 1, after reading #67:_ **the first clause no
  longer holds and is kept, struck, rather than deleted.** The staff login form
  (`components/auth/LoginForm.tsx`) takes an email address and a password, so an
  officer who knows their derived identifier **can type it** and sign in to the
  portal. That is deliberate — the form says "Staff and extension officers" and
  `/desk` is an officer screen — and **the decision itself is unchanged**,
  because it was always about not surfacing the identifier as an address: it is
  still never displayed, never in an error message, never stored on the officer
  row, and still derived in exactly one function. What changed is that a human
  who already knows it has a place to put it. The sentence is amended in place
  so that a session reading it does not conclude a rule is being broken.
- **A non-routable domain**, so nothing can ever receive mail there.
- **Officer records store the real E.164 phone.** The derived identifier is not
  a field of the officer and is not stored on the officer row.

### Why the single function matters more than it looks

GoTrue **strips the leading plus**: an account created with `+211900000001` is
stored as `211900000001`. `phoneSchema` produces the plus. Two representations
of the same number, in two systems, is precisely how a lookup silently finds
nothing and a user is told their password is wrong.

One derivation function means the two representations cannot disagree, because
only one of them is ever used to address the auth system. A test asserts that
`0912345678`, `+211912345678` and `211912345678` all resolve to the same
account.

### Do not "fix" this by enabling the phone provider

A future session will see a derived identifier and read it as a workaround.
Enabling the Phone provider means either paying for an SMS provider we do not
use, or an unverified configuration path. If Africa's Talking ever joins
Supabase's supported list, revisit it then — deliberately, with the migration
of existing accounts planned, not as a tidy-up.

This is also documented in `docs/api/CONVENTIONS.md` §2, where a session working
on authentication will actually see it.

---

## B3 — every write that needs an audit row retro-fitted in B4

The audit law says every create, update and delete appends an `audit_event` row
carrying actor, action, before, after and device. **`audit_event` does not exist
until B4**, so B3 wrote to the database with no audit trail at all. This is the
inventory B4 needs.

| Where                        | Action                   | Actor     | Before / after                                                  |
| ---------------------------- | ------------------------ | --------- | --------------------------------------------------------------- |
| `POST /api/users`            | `user.created`           | the admin | no before; after is the row                                     |
| `PATCH /api/users/:id`       | `user.updated`           | the admin | both; **the role and state change matter most**                 |
| `PATCH /api/users/:id`       | `user.password_set`      | the admin | neither, ever — see below                                       |
| `DELETE /api/users/:id`      | `user.soft_deleted`      | the admin | before is the row; after is `deleted_at`                        |
| `DELETE /api/users/:id`      | `auth.disabled`          | the admin | no row change; the auth account was banned                      |
| `POST /api/officers`         | `officer.created`        | the admin | no before; after is the row                                     |
| `PATCH /api/officers/:id`    | `officer.updated`        | the admin | both; payam and state move together                             |
| `PATCH /api/officers/:id`    | `officer.status_changed` | the admin | both; **this is a deactivation and is not the same as an edit** |
| `PATCH /api/officers/:id`    | `officer.password_set`   | the admin | neither, ever                                                   |
| `DELETE /api/officers/:id`   | `officer.soft_deleted`   | the admin | before is the row; after is `deleted_at`                        |
| `DELETE /api/officers/:id`   | `auth.disabled`          | the admin | no row change                                                   |
| The compensating transaction | `auth.account_orphaned`  | the admin | the auth id only, when the compensating delete itself failed    |

**Four things B4 must decide, not inherit:**

**A password change must never record the password**, in `before`, in `after`, or
in a message. It is the one audit row whose value is entirely in the fact that
it happened, the actor, and the time. If `before`/`after` are non-null for
`password_set`, that is a defect.

**A deactivation is not an edit.** `officer.status_changed` and
`user.soft_deleted` are the rows a supervisor will be asked about a year later —
"who cut off this officer's access, and when". Folding them into a generic
`updated` makes that question unanswerable without diffing JSON.

**Two rows or one for delete?** Soft-deleting a principal also disables their
auth account. They are one intent and two systems, and the second can fail
independently. Recording one row hides that; recording two makes the pair
visible. Recommend two.

**Backfill: recommend not.** Everything B3 wrote was test principals and
whatever accounts an administrator creates before B4 lands. Inventing audit rows
after the fact means writing rows whose `occurred_at` is a guess, into a table
whose entire value is that it is append-only and truthful. Better to record that
the log begins at B4 and say so, than to forge its first entries.

---

## B3 — the wrapper swallowed every error, and its comment said otherwise

The shared route wrapper catches everything a handler throws, so that the
caller always gets the fixed 500 sentence and never a stack trace. That is
correct. What it also does, as a consequence, is **stop Next's own
`onRequestError` hook from ever seeing the error** — the hook fires only for
errors that escape the handler, and none escape.

So the wrapper is the _only_ place a server-side route failure can be reported
from. The first version of it wrote to `console.error` and nothing else, while
its comment claimed _"the detail goes to the server log and Sentry"_. **Error
reporting was silently off for every route** from the moment the wrapper landed.
A comment asserting behaviour the code does not have is worse than a gap: it
reads as deliberate.

**How it was found.** Not by a test. By planning the Sentry verification unit and
asking what command would trigger a reportable error — and realising there was
no path from a route to Sentry at all. Had the verification run first, nothing
would have arrived, and the obvious conclusion would have been a bad DSN.

**The fix.** The wrapper calls `Sentry.captureException` for anything that is not
an `ApiFailure`, tagged with the correlation id so the report can be matched to
the response the caller saw. `ApiFailure`s — 401, 404, 422 and the rest — are
**not** reported: an officer's 404 is not an incident, and reporting them would
bury the real ones.

**The test, in both directions.** `apps/web/tests/wrapper-reports-errors.test.ts`
asserts an unexpected error is reported exactly once with the correlation id,
and that a 404 and a 200 report nothing. It was proved to discriminate: with the
`captureException` line removed, two of its four cases go red.

**The lesson worth keeping.** When a layer _catches_ something, ask what used to
happen to it further up. Catching is not free: it silences every handler that
sat behind the thing you caught.

---

## B4 — the audit log: what the database enforces, and what it does not

**Append-only is a trigger, not a revoke from the owner.** The application
connects as the table's owner (`postgres`). A privilege revoked from the owner
is re-grantable by the owner in the same session, so a `REVOKE` protects against
nothing this code can run. A `BEFORE UPDATE OR DELETE` trigger raises for every
role including the owner, until someone deliberately removes it. `UPDATE`,
`DELETE` and `TRUNCATE` are also revoked from `anon` and `authenticated`, which
RLS already denies everything.

**What it does not stop, stated plainly.** A superuser, or the owner via
`DROP TRIGGER`, `ALTER TABLE ... DISABLE TRIGGER`, or `TRUNCATE`, can still
alter history. Those are deliberate DDL acts that show up as migration drift,
not something an ordinary code path does by accident. **This is append-only
against the application, not immutability against the database's owner.** It
must never be described as immutable.

**Actions are keys generated from one list.** `AUDIT_ACTIONS` in
`packages/shared` and the `CHECK` constraint in migration 9 are produced from the
same source, so the database refuses any key the code does not define, and a
sentence — `could not register Achol Deng` — cannot enter the `action` column
at all (C-4.7).

---

## B4 — two corrections to the data model, and why

**`entity_id` is `text`, not `uuid`.** C-2 decided that locations are keyed by
codes (`CE-JUB-MUN`), and the reseed must record what it changed. A uuid still
fits in a text column; a code does not fit in a uuid column. `docs/data-model.md`
is corrected on this branch.

**`actor_id` carries no foreign key.** The model wrote `fk → user or officer`,
which no foreign key can express. And append-only means a row can never be
cascaded or nulled: the test sweep hard-deletes its actors, and a key would make
that either fail or corrupt history. `actor_type` gains **`system`** for the
reseed and any script with no principal (C-4.3); the database enforces that
`system` has no `actor_id` and every other type has one. `writeAudit` checks the
same pairing before it reaches the database.

---

## B4 — the two writes outside the transaction guarantee

C-4.4 says a change and its entry succeed or fail together. Two writes cannot
honour that literally: disabling an authentication account and deleting an
orphaned one are HTTP calls to Supabase Auth, and an HTTP call has no
transaction to be inside of.

**Decided:** the entry is written **after the call returns**, recording the
outcome — `auth.disabled` on success, **`auth.disable_failed`** on failure,
`auth.account_orphaned` when a compensating delete itself fails. A log that
records an intention rather than an outcome is worse than no log.

**Re-activation has no key of its own, on purpose.** When restoring an officer's
access fails after the row already says `active`, the row is flipped back to
`inactive` in a second audited transaction and that flip is recorded as another
`officer.status_changed`. The log then reads exactly what happened — active,
then inactive again — and the database matches the world, with no new action
key added past the agreed set.

---

## B4 — how writeAudit is impossible to call outside a transaction

Two layers, both tested.

**The type.** `writeAudit` takes an `AuditTx`: a Prisma transaction client
carrying a brand symbol. The only function that produces one is `audited()`,
which opens the interactive transaction and stamps the client. Passing the
top-level `prisma` fails to compile — and the root `tsconfig.json` now covers
`tests/`, so the `@ts-expect-error` that proves it is actually checked.

**The runtime.** An interactive transaction client has no `$transaction`
method; the top-level client does. `writeAudit` asserts the brand is present
and `$transaction` is absent, so a caller who casts past the type still fails at
the first call — proved with the top-level client and with an un-stamped
transaction client.

**A consequence worth knowing:** a failed change leaves no row, because the row
was written inside the transaction that failed. Tested.

---

## B4 — the audit log's exclusion list is not the Sentry scrubber's

The first version of `auditSafe` reused the Sentry scrubber's key list. That
list redacts every key called `name` — right for an envelope leaving for a
third party, and wrong for a table that exists to answer "who renamed this
payam, from what to what". Every rename came back empty, and four tests caught
it.

The audit log has its own list: credentials and the auth link by key; a
farmer's identifiers — national id, phone, email — by key; the derived officer
identifier by **value** wherever it appears; and phone-shaped strings inside any
value, using the one definition of a South Sudan number. `name` is recorded.
The audit log is our own admin-only table under RLS, not a third party.

---

## B4 — the root tests/ directory had never been typechecked

`pnpm -r typecheck` runs per workspace package. `tests/` belongs to none, so
B2's location tests, B3's forbidden matrix and scope suite, and the helpers had
never been typechecked at all. The first run found a latent unchecked-index
defect in `tests/locations.test.ts` from B2, and proved that a
`@ts-expect-error` in a file nobody typechecks asserts nothing.

A root `tsconfig.json` now covers `tests/`, and `pnpm typecheck` runs it before
the packages.

---

## B4 — the reseed audit gap, exactly

The location reseed writes audit rows from B4 onward, as `system`, inside its
own transaction, for every location it added, renamed or soft-deleted.

**Runs before that wrote no rows. The gap is 2026-09-02 18:28 UTC — the first
seed against staging — until the day B4 merges.** It is not backfilled: the
only record of those runs is the reseed's own JSON logs, which are local to one
machine and gitignored, so an invented row would carry a guessed `occurred_at`
into an append-only table whose entire value is that it is truthful. **This
entry is the only durable record that the gap exists and what it covers.** In
that window the location tables were seeded from placeholder data and reseeded
by tests; no CORWADO source data was involved.

## B1.5 verification — the post-`beforeSend` limit has a first instance

**Observed 2026-09-04**, one real event (`pnpm sentry:verify`, issue
`AGRI-WEB-1`, event `4f4a56c0`), read in the Sentry UI by the user. The
scrubber did what it was written to do: every listed key, the phone inside the
query string and URL, and both `name` values under `os` and `runtime` were
redacted; zero matches for the fabricated number; `server_name` was the
environment, not the laptop. The free-text limit is real: `Achol` and
`SSD-1234567` arrived in the title, message and breadcrumb.

**Two things arrived that no prediction covered, and they are not the same
kind of thing.**

**User Geography — `India (IN)`.** Derived by Sentry from the sending IP,
attached at ingest, after transmission. `beforeSend` never sees it; there is
no code we can write that removes it. B1.5 recorded "anything attached after
`beforeSend` is outside the rule" as a theoretical limit — this is its first
concrete instance. `sendDefaultPii: false` did not prevent it, because that
flag governs what the SDK _sends_, and the IP is not sent — it is the
connection. The remedy is Sentry's project setting _Prevent Storing of IP
Addresses_ (Settings → Security & Privacy), which stops geo enrichment at the
source. That is CORWADO's account; recorded as their decision, not applied.

**Culture — timezone `Asia/Calcutta`.** Looks the same, is the opposite: the
SDK attaches it _before_ `beforeSend` (it was in B1.5's captured envelope),
so the scrubber could reach it and simply had no rule for it. Left as is:
mildly identifying, and adding `timezone` to the key list would be a code
change with no unit behind it. Recorded so the two are not confused — one is a
missing rule, the other is a rule that cannot exist.

**The username path.** The frame carried
`/Users/<username>/…/apps/web/scripts/sentry-verify.mjs`. B1.5 accepted this
on the premise _"local machines have no DSN configured, so nothing is sent
from the place where this applies"_. That premise lapsed when a DSN went into
`.env.local` for this verification — which is exactly why the path arrived.
For a Vercel deployment the function runs from `/var/task/…` with no username;
that is **inferred from Vercel's runtime layout, not observed** — we have no
Vercel-originated event yet. The observation that would settle it is one real
route error on a preview deployment, read the same way. Until then the rule is
the simple one: a local DSN sends local paths, so the DSN leaves `.env.local`
when verification is done.

**`sdk.name`.** Transmitted — seen in the captured envelope — but not confirmed
in the UI, which was not expanded that far. Recorded as transmitted, not as
displayed; the distinction matters only for the next SDK upgrade, when the
envelope is captured again anyway.

## 2026-09-04 — The Sentry environment tag says what we mean, not what Vercel calls it

`SENTRY_ENVIRONMENT` is set explicitly in Vercel: `staging` on preview
deployments, `production` on production. Without it the code falls to
`VERCEL_ENV`, whose vocabulary is `preview` / `production` — and `preview`
would have become the filter everyone uses before anyone chose it. Decided
now, from the _To settle on the first real preview deployment_ list, rather
than after the first event. The fallback stays in the code; the rule is that
it must never be the thing producing the value, and a preview event tagged
`preview` means the Vercel variable is missing.

## 2026-09-04 — Process finding: the gate tests code, not whether code was asked for

PR #29 reached main with no brief, no criterion (C-18 does not exist) and no
handoff entry, building the farmer-facing flow that `CLAUDE.md` lists as
unresolved and Inception Report 5.1 excludes. Its checks were green because
nothing in the gate reads the scope document. #17 and #18 were the same
pattern, caught before merge. Recorded in `PROJECT-STATE.md` with the full
inventory of what #29 added; the revert decision is the user's and is not
made here. The inventory shows the cost is low — screens and fixtures only,
nothing depends on it — which is the argument for reverting cleanly rather
than the argument for keeping it.

## 2026-09-04 — #29 is reverted

The user's reasoning, recorded as given.

It builds farmer self-registration and a farmer-facing application. Inception
Report section 5.1 excludes both from this phase, and `CLAUDE.md` lists them
as unresolved pending a written answer from CORWADO. Building them does not
make them in scope; it makes 3,000 lines that either get thrown away or get
shown to a client as though they were agreed.

It also builds produce listings, which is deliverable (h), phase 5, while we
are in phase 2.

Its login flow uses phone plus a one-time code. B3 established that path is
not available to us and chose the derived-identifier approach instead. A
merged implementation contradicting a recorded decision is worse than no
implementation.

C-18 and B12 do not exist in any document.

The branch stays in the repository. If CORWADO confirms the farmer app is in
scope, this is a reference for the real unit — built against criteria that
exist, with a brief, in the right phase.

**How it was done.** A plain `git revert` of the squash commit, on the same
PR as the process finding (#31), so one merge carries the revert and its
record and the two cannot conflict. It applied without conflict. The two
files #29 had modified rather than added — the fixtures file that the
pre-existing Farmers screens import, and the design page — are byte-identical
to their pre-#29 state, checked against the parent commit, not assumed from
the revert.

## 2026-09-04 — Three decisions from reading the first real Sentry event

**IP-derived geography: off.** Sentry's _Prevent Storing of IP Addresses_ is
to be on for this project. The user's reasoning, recorded as given: we have no
use for IP-derived location, and once real staff in South Sudan are using the
system every error would carry inferred location about a named person's
device. Turning it off costs nothing because we never wanted it. This is a
Sentry project setting on CORWADO's account; the repository cannot reach it,
so it was applied in the UI, not in code, and the proof is a later event with
no User Geography.

**The DSN leaves `.env.local`.** Removed the day verification finished. B1.5
accepted username-bearing local paths on the premise that _"local machines
have no DSN, so nothing is sent from where this applies"_ — that premise is
the whole protection, and it holds only while the DSN is absent. So the DSN
belongs in Vercel's environment variables and nowhere else. Re-verifying
locally is a three-step act: add, run, remove. Recorded in `.env.example` at
the variable itself, where the next person will read it.

**`timezone` and `locale` join the scrubber's key list.** The culture context
was established reachable (SDK-side, before `beforeSend`) on 2026-09-04. It is
not needed for diagnosis and it narrows a person's location. Added as keys
rather than by deleting `contexts.culture`, so the rule holds wherever a
timezone or locale appears — a breadcrumb, a tag, extra context — not only in
the one place the SDK puts it. `locale` was not named in the instruction;
`en-IN` narrows location as the timezone does, and the reasoning given
("culture context is not needed") covers both fields. Tested in both
directions: the values go, the diagnostic neighbours stay.

**And a list, not a decision.** Everything currently inferred rather than
observed about a Vercel-sent event is gathered in `PROJECT-STATE.md` under _To
settle on the first real preview deployment_, so that one route error on a
preview, read once, closes the whole list instead of items being rediscovered
one at a time. The username path is the first entry; the `environment` tag
falling to `VERCEL_ENV` (`preview`, never `staging`) is the one most likely to
surprise.

## B5 — `self` is a value in the enum, not a permission

`registration_source` keeps `self` because the data model has it and
Inception Report 5.1 may one day be revised. **No route produces it.** A
future session reading the enum must not read it as "self-registration is
allowed": it is allowed nowhere, and a farmer-facing application is on the
unresolved list in `CLAUDE.md`. The database adds a CHECK that an
officer-registered farmer always has a registering officer, so the only value
any route can write is fully constrained.

## B5 — the national id is returned to two people, and absent for everyone else

Data model open question 2 — who may see national IDs — is unanswered by
CORWADO. We chose the narrower reading: an administrator and the officer who
registered that farmer. For a supervisor or read-only user the key is
**absent, not masked**, because a masked field still tells you one exists.
Recorded as our decision rather than their instruction, so it can be widened
on request rather than discovered. Now criterion C-5.8, not only behaviour.

## B5 — an administrator must name the registering officer

A farmer in nobody's caseload is a farmer nobody visits. Caseload means "the
records this officer registered", so an administrator registering a farmer
names an active officer in that payam as `registered_by`, and the field is
immutable thereafter (trigger, both directions tested).

## B5 — how the farmer number cannot collide

A per-county counter row, incremented by an upsert inside the registration's
transaction. The upsert's row lock serialises concurrent registrations in the
same county; nothing else is needed and nothing else is relied on. The UNIQUE
on `farmer_number` is a backstop. The number is stored as text at insert and
never re-derived, so a county code changing under I-07 leaves printed cards
valid — storing rather than deriving is the important half. Alternative
considered: one Postgres sequence per county, created on the fly. More moving
parts, no gain.

## B5 — consent and the farmer commit together, and consent is never removed

Both `farmer.consent_id` and `consent.farmer_id` are NOT NULL with foreign keys
DEFERRABLE INITIALLY DEFERRED, so the pair commits together or not at all —
the database enforces it, not a route remembering. A test inserts a farmer
without its consent row and the commit is refused. A consent that was not
granted can only be a withdrawn one (CHECK): a farmer who declines is not
recorded at all. There is **no trigger refusing DELETE on consent**, unlike
`audit_event`: the test sweep must remove fabricated farmers and their consents
as table owner, and a trigger would block it. "Never removed" is enforced by
there being no code path that deletes one, and no role but the owner that can.

## B5 — an officer changing another officer's farmer gets 404, not 403

The brief's test list said 403. C-3.5 and C-5.7 say a farmer outside the
caller's scope is indistinguishable from one that does not exist, and a 403
would tell an officer that another officer's farmer exists at that id. So:
not theirs → 404, exactly the read answer. 403 is reserved for the farmer
that **is** theirs but is no longer pending (C-5.9), where existence is
already known. Both are tested.

## B5 — the concurrency test is 1,000 at the lock and 100 through the route

The brief asked for 1,000 concurrent inserts. Two facts shaped the test:
every registration appends two permanent audit rows, so 1,000 through the
route would grow `audit_event` by 2,000 rows per run, forever; and the app's
connection pool has one connection, so route-level "concurrency" is
serialised before it reaches the database and proves nothing about the lock.
So: 1,000 concurrent allocations on one county's counter row over ten real
connections (proves the lock; the sweep removes the test county so nothing
grows), and 100 concurrent registrations through the route (proves the whole
path, 200 audit rows per run, recorded in PROJECT-STATE). Each test's name
says what it proves. If the lock test fails on "can't reach database", that
is the pooler, and the rule is to say so, not retry until green.

## B5 — the audit log now strips given_name and family_name

C-4.7 says a farmer's name never enters the audit log. `auditSafe` gained
`given_name` and `family_name`; staff `name` stays recorded, as B4 decided,
because a staff member is not a farmer and has one name field, not two. The
farmer routes also pass only value-shaped fields to the audit, and a test reads
the rows back to prove no name, phone or national id is in them.

## B5 — a test county and payam exist only during a run

The placeholder location list has payams only under Juba county. The
out-of-state tests (a supervisor in Central Equatoria must get 404 for a
farmer in Eastern Equatoria) need a payam in another state, so the test creates
`EE-ZZT` / `EE-ZZT-TST` in `beforeAll` and the sweep removes them, farmers and
counter row first. When I-07 arrives and every state has payams, the fixture
can go.

## 2026-09-05 — The "flaky pooler" was Prisma's five-second connect timeout

From B2 onward, `PROJECT-STATE.md` carried a known condition: the session
pooler "drops connections intermittently, one attempt in three; retry the
command". The serial-test rule, the reseed's retries and five failed suite
runs on 2026-09-05 were all built on it. It was a wrong diagnosis, and it
survived three units because each failure was read as confirmation rather
than measured.

**The measurement.** Every Prisma failure, on both poolers, ended at 5.01 to
5.02 seconds with `Can't reach database server`. Successes ended anywhere from
2.4 to 6.3 seconds. A raw protocol handshake, and `psql`, reached the poolers
every time — slowly, 1.3 to 8.7 seconds. Prisma's default `connect_timeout`
is 5 seconds. With `connect_timeout=30` it connected three of three.

**What changes.** `connect_timeout=30` on both URLs, in the operator's file,
in `.env.example`'s documented shapes, and appended in code by
`vitest.config.mts` so a test never depends on the operator's file. The serial
test rule is re-tested rather than carried forward; the result is in
`PROJECT-STATE.md`. "Retry the command" is withdrawn as advice: the next
handshake sometimes beat five seconds, which is why it looked like it worked.

**The serial-test rule, re-tested.** With the timeout fixed, the suite in
parallel produced zero connection or pool errors and five files of
cross-contamination: every database test file creates `zztest` principals and
calls one global `sweep()`, so files deleted each other's accounts mid-run.
The rule stays, as a fixture-isolation rule. It was never about connection
slots.

**And a second timeout behind the first.** Once connections stopped failing at
five seconds, the app's client — one connection, as production wants — queued
concurrent route calls past Prisma's ten-second pool wait and answered 500.
The test process now runs that client with ten connections and a sixty-second
wait, a deliberate difference from production, recorded in `PROJECT-STATE.md`.

**The lesson, stated so it is not relearned.** A failure that always takes the
same number of seconds is a timeout, not a fault. Read the clock before
reading the message.

## 2026-09-05 — A write transaction may not sit idle holding locks

Seen in `pg_stat_activity` during B5's concurrency test: a server session idle
in transaction for sixteen minutes, holding the farmer-number counter row,
with registrations queued behind it until Postgres cancelled them at two
minutes. The client had abandoned the transaction — Prisma gives up starting
one after `maxWait` — but the pooler kept the server session, and the role
has no idle-in-transaction timeout. The sessions outlived the client process.

`audited()` now issues `SET LOCAL idle_in_transaction_session_timeout = '30s'`
as the first statement of every write transaction. It is scoped to that
transaction, changes nothing outside it, and means the field on a printed
card can never be blocked by a dead client. A test proves it is set inside and
not set outside. The cause on the test side — launching a thousand
interactive transactions at a pool of ten — is fixed by bounding what is in
flight to the pool; ten contending transactions prove the row lock as well as
a thousand did.

Not done, and put to the user: the same timeout, and a `lock_timeout`, at the
role level on Supabase, which would also cover any path that does not use
`audited()`. That is a database setting on CORWADO's project, not code.

## 2026-09-05 — Two role settings on staging, because of run 3

Applied by the user on the staging project's `postgres` role, alongside the
existing `search_path`:

- `idle_in_transaction_session_timeout = 60s`
- `lock_timeout = 10s`

The reason is run 3 of the B5 suite (next entry): a server session sat idle
in transaction for sixteen minutes holding the farmer-number counter row
because the role had neither setting, so nothing on the server ever ended it.
The code-level guard in `audited()` (30 s, transaction-scoped) covers audited
writes; these two cover every path, including scripts and any future code
that does not go through it.

**Production does not have them.** The production project is created new at
B11, and a fresh project carries neither setting. They are applied by hand,
not by migration, so nothing in the repository will carry them across. This
entry is the reminder, and B11's checklist in `PROJECT-STATE.md` names them:
this is exactly the kind of thing that gets forgotten when production finally
holds real data.

## 2026-09-05 — Run 3 was a production failure mode, not a test problem

What happened in the test is what happens in the field. An officer's request
reaches a route, the registration transaction takes the county counter row,
and then the client dies — the phone loses signal, the serverless function is
killed, the process crashes. The pooler keeps the server session alive with
the transaction open. **Every registration in that county queues behind the
held row**, and before this week each would wait until Postgres's two-minute
statement timeout and then fail; the row stays held until someone notices.
One dead request, one county, no registrations.

**What now prevents it.**

- `audited()` sets `idle_in_transaction_session_timeout = 30s` inside every
  write transaction: a dead client's session is ended by the server within
  30 s and the row is released.
- The role's `idle_in_transaction_session_timeout = 60s` does the same for
  any path that does not use `audited()`.
- The role's `lock_timeout = 10s` means a registration waiting on the row
  fails after ten seconds with a clear error instead of hanging for two
  minutes; the officer's app retries a failed upload by design (C-5.12: same
  id, no second row).
- The test that produced the condition — a thousand transactions launched at
  a pool of ten — now keeps ten in flight.

**What still would not prevent it.**

- A client that is alive and running a slow statement inside the
  transaction is _active_, not idle, and neither idle timeout applies. The
  backstop is `statement_timeout` at two minutes; during that window every
  registration in the county fails at ten seconds. No statement in the
  registration should take seconds, and none has, but nothing enforces it.
- The exposure is per county by design: one counter row per county serialises
  every registration there. At field scale — tens per county per day — this
  is invisible; it would matter only if the design were reused for something
  written thousands of times a minute.
- Nothing here helps if the pooler itself keeps a session that Postgres has
  already ended; that has not been observed.
- The settings are on the role, on one project. Production gets them only if
  someone applies them at B11.

## 2026-09-05 — A false positive was removed from history, not allowlisted

CI's secret scan reads every commit on every fetched ref and has no allowlist
(CLAUDE.md §4). B5's branch failed it on every push from its first one. The
cause: two documented connection-string shapes written into `.env.example`
as full URLs with a placeholder user and password, which matched the
repository's own rule for a Postgres URL carrying a password; and, later, a
`PROJECT-STATE.md` note that quoted the same shape and added a third finding.
Rewording the current tree fixed the tree and changed nothing about the
verdict, because the earlier commits still carried the text.

The branch was squashed to one commit on top of `main` — previous head
**`7a1540f`** — so that no reachable diff contains the shape, and
force-pushed. That is the non-allowlist fix: the pattern is gone, the rule is
untouched, and the decision the user reserves, whether a false positive may
be allowlisted, was not taken. The pull request is squash-merged anyway, so
nothing that would have reached `main` was lost; the per-commit reasoning is
in this file and in the pull request body.

**The rule that follows, because this will recur.** Never write an example
connection string that carries a password-shaped segment, even as a
placeholder — not in `.env.example`, not in a document, not in a comment.
Describe the shape in words: which host, which port, which query parameters.
The scanner cannot tell a placeholder from a credential, and it should not
have to. Now a standing rule in `PROJECT-STATE.md`.

A note for the next person: a git-mode scan with the x86 build on an
Apple-silicon machine checks nothing. The native arm64 build reproduces CI
exactly.

## B5.5 — CI's green was a lie about eight files, and had been since B2

Every database test file guarded itself with "skip if the variables are
absent". CI had no secrets, so from B2 to B5 every CI run skipped the
forbidden matrix, the audit tests, the location tests and, later, the farmer
suite — and reported green. B3's 85-cell authorization matrix and B4's audit
proofs ran on one laptop, once, and were assumed green after. That is the
finding this unit exists for; the rest is plumbing.

**The guard now fails, loudly, naming the variable.** A missing variable is
a configuration fault and a fault is red. The five names the tests need are
fixed in `tests/helpers/db.ts`; the global setup refuses before any file
runs; a run with one blank variable exits in a second with the name in the
message. There is no opt-out. A laptop without staging access runs the shared
package's tests directly; it does not get a green `pnpm test`.

**Test clients use the transaction pooler.** Run 5 showed the session
pooler's fifteen server slots refusing new connections for minutes after the
concurrency tests while the transaction pooler kept answering. The app has
always used the transaction pooler; the tests now do too, and so do the
scripts. The session pooler is for migrations, and for one connection: the
lock below, which must outlive a transaction.

**One run at a time, enforced in the database.** Every file creates
principals under one prefix and calls one global sweep, so two runs at once
delete each other's accounts mid-run. A workflow concurrency group cannot see
a laptop; a session-level advisory lock can see everything. The global setup
takes it and holds it for the run; a second run fails at once and names the
holder; a killed run's session ends and the lock goes with it. Per-run
isolation of fixtures was the alternative — more files to change, and the
pooler's slots still bound how many runs could overlap — and can come later if
serial runs become the bottleneck.

**Triggers and cost.** Pull requests and merges to main, not every push. Each
run appends about 250 permanent audit rows, consumes about 1,100 farmer-number
counter values on the test county and about 110 on Juba, and creates and
deletes about ten authentication accounts. Accepted, and written down so the
growth is expected rather than discovered. Job timeout 40 minutes, so a hung
run cannot hold the lock for six hours.

**A finding on the way: five in flight, not ten — and what that does and
does not say.** Ten concurrent registrations through the route in one test
process, on a pool of ten, each held a pooled connection while queuing on the
county counter row, and later transactions could not start within their
30-second wait: 22 of 50 succeeded. **This is the test process's shared pool
contending with itself. It is not evidence that the system cannot handle ten
concurrent registrations.** Production runs one connection per serverless
instance with no shared pool; the only shared thing there is the counter row,
and run 5 showed that row serialising 1,000 concurrent allocations correctly
with ten in flight. A future session reading "ten in flight failed" must read
this sentence with it. The throughput test keeps five in flight, which still
overlaps on the row, and that is a time-and-pool budget for a laptop, not a
capacity claim about the design.

## B5.5 — What the first CI database run does and does not prove

Once B5.5 is merged, every unit from B2 onward has database evidence that
ran on one laptop and never in CI: B2's location tests, B3's 85-cell
authorization matrix and scope tests, B4's audit tests, B5's farmer suite.
B5.5 does not retroactively prove any of them. The first CI database run
covers whatever exists at that point, and B2, B3 and B4's proofs were
single-run local evidence until a full CI run passed over them — which it did
on 2026-09-05, workflow run 33941608043 on #33: 23 of 23 files in 19 minutes
on a GitHub-hosted runner. `PROJECT-STATE.md`'s B5.5 section records it.

## Standing rule — the reviewer writes about the record, not the person

Every free-text field this system carries about a person is written by
staff, stored, returned and one day sent to a device. The first is B6's
rejection note; visit advice in B8 is the next; there will be more. The rule
for all of them: **a fixed code carries the meaning; the free text carries
the detail; the text is data, never a message.** It travels only inside the
record it belongs to, to the parties entitled to that record; it is never
interpolated into an error, a warning or a message; its field name is on the
audit log's never-recorded list and on the error scrubber's key list, and a
test in B1.5's shape proves an event carrying it leaves without it. A
reviewer is told to write about the record — what is missing, what is wrong,
what to check — and not about the person.

## B6 — decisions in the verification unit

**`merged` is a state, with `merged_into` as the pointer.** The queue, the
verified view and reporting each check one column. Additive to the enum.

**`resubmitted` is a decision**, so every transition writes a verification
event, and the event's actor is split: a staff `reviewer_id` for verified,
rejected and merged; the registering `officer_id` for resubmitted; a CHECK
ties which to the decision. The data model had one actor column.

**A merge across states is refused for every role, administrators included.**
It would move a farmer between supervisors' scopes and between two donor
reach figures silently. If CORWADO needs cross-state merges, that is their
decision, made in writing; it does not ship as a default.

**`pending_since` is the escalation clock and an editable clock is not a
clock.** Set at registration, reset on resubmission by the state machine, and
the immutable-fields trigger refuses any other change — including through
the row the administrator may otherwise edit freely. The unknown-field rule
keeps it out of every request body.

**The state machine is one module and a test attacks it from outside.** Every
transition not in the table is attempted through a route and refused with
the same rule key, and the row is unchanged afterwards. The optimistic update
(`WHERE verification_status = from`) means two decisions racing on one record
cannot both win.

**C-5.9 was wrong and is amended.** A rejected record must be correctable or
it cannot be resubmitted; officers may change their own registrations while
pending or rejected.

## 2026-09-05 — A false alarm about the drift test, and the real gap beside it

It was believed for a moment that B1.4's drift test — the guarantee that
CONVENTIONS and the code cannot diverge — had stopped guarding when prettier
re-padded the document's tables after B5, and that it had been blind between
B5 and B6. **That was not so.** The test reads a table row by splitting on
the bar character and trimming each cell; padding cannot reach it. It ran and
passed in every shared-test run in that window and in the first CI database
run. What broke on padding was an editing script of the session's own,
anchored on exact text; that is a tool, not a gate.

**The real gap, found while checking.** The drift test lives in the shared
package and pins four tables: status codes, messages, field reasons, audit
keys. It has never pinned the fifth, the 409 and 422 rule sentences of §5.2.1,
because the registry they mirror lives in the web app, which the shared
package's test cannot import. That table has been unguarded since B3 wrote
it on 2026-09-03. Measured on 2026-09-05: 17 rules documented, 17 in code,
none missing on either side, no wording differs. Nothing drifted. It is
guarded from now by `tests/conventions-rules.test.ts`, which imports both.

The distinction is recorded because it matters: the first would have been a
gate reporting success while checking nothing (see the class in
`PROJECT-STATE.md`); the second is a gate that never existed for one table.
Both end the same way, a check that runs; only the second happened.

## B6 — A `SELECT *` view freezes its columns, and every farmer query read one

`farmer_active` was created in migration 10 as `SELECT * FROM farmer`.
Migration 11 added `farmer.pending_since`. The view did not gain it — a view's
column list is fixed when it is created, whatever the `*` suggests — and every
farmer query in the system reads the view, so B6's first full run failed 62
times with "column f.pending_since does not exist", from the first
registration to the last. Nothing in migration, typecheck, lint or the shared
tests could see it: the column exists on the table, the code is right, and
only the database knew the view was stale.

Migration 12 recreates the view; `CREATE OR REPLACE` may append columns,
which is all this needs. **The rule:** a migration that adds a column to a
table with an `_active` view recreates the view in the same migration.
**The guard:** `tests/views-track-tables.test.ts` compares every active
view's columns to its table's, in order, both directions, so a stale view
fails a database test instead of the first route that reads it.

## Standing rule — a view named after a table is a filter of it and carries every column

A `SELECT *` view freezes its column list when it is created. A column added
to the table later is invisible through the view until the view is
recreated, and nothing in migration, typecheck, lint or the shared tests can
see that: the table is right, the code is right, only the database knows.
B6 lost its first full run to `farmer_active` lacking `pending_since`. B7
adds farm columns, B8 visits, B10 views over all of them; this will recur
unless it is a rule with a test.

**The rule.** A view whose name begins with a table's name — `farmer_active`,
`farmer_verified_v`, `farm_active` when it exists — is a filter of that table
and carries every one of its columns, in order. A migration that adds a
column to such a table recreates every such view in the same migration
(`CREATE OR REPLACE VIEW` may append columns). A view that deliberately
projects a subset, or aggregates, is not named after its table.

**The test.** `tests/views-track-tables.test.ts` discovers every view in the
schema, pairs each with a table by longest name prefix, and compares the
column lists both directions.

**Loosened on 2026-09-05, during B7, the first unit the guard was watching.**
As written the day before, the test refused any view it could not pair. B7's
`area_totals_v` is an aggregate and cannot pair with a table, so the test was
changed: a view not named after any table is exempt by convention. The
change is right and `area_totals_v` proves it — but it is a loosening of a
guard made during a unit that the guard was watching, and it is recorded as
that rather than as a clarification. The next loosening might not be as
clearly right; a rule that quietly relaxes each time it is inconvenient
stops being a rule. Any further change to what this test exempts is recorded
here the same way, with the date and the reason. It runs in every
full suite run, locally and in CI.

## 2026-09-05 — The drift-test premise came from the user, and checking it found it false

The record above under "A false alarm about the drift test" states what was
true. This entry states where the premise came from, because that matters
more than the finding: **the user asserted that the drift test had been
matching on table padding and had stopped guarding between B5 and B6, and
asked for it to be recorded as a finding. It was checked against the code
before it was written down, and it was false.** The test trims each cell and
had never been blind; the padding fault was in a session editing script. The
check exposed a real gap beside it — one table the test had never covered —
which was measured and closed.

Recorded at the user's own request and in their words: the pattern of an
assertion entering the documents unchecked is exactly what the staleness
audits keep finding. Nothing goes into the record on anyone's say-so,
including the person who owns the project; the check comes first, and the
correction is written down whichever direction it points.

## B6.5 — An outage of the sign-in service is 503, never 401

`requireRole` asked Supabase Auth to verify the token and turned any error
into `401 unauthenticated`, whose sentence is "Sign in to continue". Seen in
B5's run 4: seven valid sessions answered 401 while the service strained. In
the field that message sends an officer to re-enter credentials that were
never wrong — exactly the wrong response, produced by the system's own
wording.

Now the service's answers about the session — 400, 401, 403, 404 — remain
401, and everything else — unreachable, a 5xx, a 429, a call that never
returns — is `503 auth_unavailable`: "The sign-in service could not be
reached. Try again in a moment." The call carries a ten-second deadline so a
hung service cannot hang every route. Tested against a real failing service
on a local port, four ways, and against the real service both ways.

**Not reported to Sentry, deliberately.** An outage would produce one event
per request; the signal belongs to a health check, which is B10's or later.
Recorded so the silence is known to be chosen.

## Standing rule — a test that reads the schema tolerates objects it does not know

Staging's schema runs ahead of main: migrations are applied from a unit's
branch before it merges, so every run of main, or of an older branch, tests
older code against a newer schema (PROJECT-STATE, _Staging's schema runs
ahead of main_). The additive-migration law keeps code safe under that; a
test that enumerates the schema and demands equality is not code, and it
goes red on a view, a table, an enum value or a constraint it does not know.
The view-tracking test did exactly that on #35's merge run.

**The rule.** A test that reads the catalogue asserts what must hold for the
objects it knows — every table has RLS on, every active view carries its
table's columns, this constraint exists — and never that the set of objects
equals a list. It lives here, beside the view rule, because that is where
the next person writing a schema-reading test will look.

**Looked, not assumed, on 2026-09-06.** Every test that reads the catalogue
was read: the RLS checks on named tables, the security-invoker checks on
named or pattern-matched views, the constraint-exists checks, and the
view-tracking test are all on named sets or containment and tolerate what
they do not know. One was not: the directories test asserted the `crop` and
`language` enum labels equal a fixed list, so the first unit to add a crop
or a language would have turned it red for a reason unrelated to that unit.
It had not been bitten only because no unit had added one. It now asserts
containment — every value the code knows exists in the database — which is
the direction that matters.

**The distinction worth keeping.** This is the second instance of the same
fault, and the first one this project has found by looking rather than by
being bitten. Every earlier instance in the silent-gates class — the
typecheck hole, the eight skipped files, the blind scanner, the unchecked
keys, the strict view test — was discovered when it fired. This one was
found by asking the question the class exists to prompt, before any unit
added the thing it counted. Recorded so that the question keeps being
asked.

## Standing rule — a test that verifies a calculation computes the expected value independently

A test that reads its expected value back from the thing under test proves
only that the thing agrees with itself. B7's area test computes the expected
hectares from the polygon's coordinates by a geodesic formula written in the
test, and requires PostGIS to agree within one percent; the two must agree
independently or the test says nothing. B10's reach figures face exactly
this: a total copied from the view it is meant to check is worth nothing.
The expected value comes from a second, independent path — a formula, a
hand count of fixture rows, a known answer — never from the query, view or
function being verified.

## B7 — decisions in the farm unit

**Accuracy grades: good at 10 m or better, poor over 10 to 30, unusable over 30.** Ours, taken because no threshold exists in any document, to be corrected
when CORWADO or the field says otherwise. A consumer GPS under tree cover
routinely reports 15 to 20 metres, so "poor" will be common rather than
exceptional; the unusable threshold is the one that actually matters. The
numbers are constants in `packages/shared` and the database CHECK is
generated from them.

**Four distinct vertices, the closing repeat not counted; a triangle is
refused.** A three-sided plot exists in reality, but a three-point capture is
far more likely an officer who stopped walking early, and the refusal says
so in words they can act on.

**The three refusals are sentences for a field, never the database's words.**
Closure and the vertex count are judged in the module before the database,
because the GeoJSON parser refuses an open ring with its own message;
simplicity and validity are judged by PostGIS and mapped to one sentence.

**Winding order is normalised.** A phone walking a plot produces either
orientation depending on which way the officer walked. The stored ring is
forced counter-clockwise on insert (`ST_ForcePolygonCCW`), the area is taken
on the geography and is positive either way, and a test maps the same plot
both ways and gets the same area. Nothing is refused for orientation and
nothing goes negative.

**Seasons: a four-digit year, a hyphen, `main` or `second`.** Ours until
CORWADO confirms local names. A season the system cannot compare is a season
B10 cannot report on.

**History is kept, never overwritten, within a season as well as across
seasons** (data model open question 6, unanswered). Discarding a boundary is
irreversible; season-on-season comparison is what a donor report about land
under cultivation eventually wants; and adding history later would mean
migrating farms that already have visits and crops attached. Within a season
the same reasoning applies and re-mapping after a poor reading is the
common case, so a sequence with the latest current, one current per farm per
season as a partial unique index. The reversible reading is our decision and
can be narrowed on request.

**Only an officer with the farmer in their caseload maps, and the schema says
so.** The mapping officer column references the officer table; an
administrator cannot be recorded as a mapper at all. The record tells
"someone walked this" from "someone drew this" by shape, not by a flag. An
administrator reads everything, including coordinates, and removes a farm
softly; never creates, re-maps or re-grades.

**Creating a farm is mapping it.** The first boundary comes with the farm;
a farm without a boundary is not a thing an officer can record.

## 2026-09-06 — One CI concurrency group across all refs; the second CI edit since B1.2

Every CI run holds the staging lock for twenty to forty minutes. A run on
main triggered by a merge, and the next pull request's run, started seconds
apart three times in a row under the sequential merge order, and the second
refused each time, naming the first. The lock did exactly what B5.5 built it
for; the cost was a manual re-run on every merge.

The workflow now has one concurrency group across all refs with
cancel-in-progress off, so GitHub queues runs instead of the lock refusing
them. The trade, accepted: a superseded run on a branch is no longer
cancelled by a newer push; it completes and the newer run waits, a run of
staging time per superseded push. A cancelled run could leave its lock
behind, so queueing is also the safer of the two. The lock stays: it is what
protects staging from a laptop, which no workflow setting can see.

**This is the second edit to the CI workflow since B1.2 wrote it; the first
was B5.5.** Both were made because the unit was CI, and both are recorded
here so that "do not touch the CI workflow", which every other unit's brief
carries, is seen to have been honoured everywhere else.

## 2026-09-07 — The CI timeout is sixty minutes; the third CI edit since B1.2

**The finding.** The same suite on the same code takes between twenty-six and
over forty minutes depending on the day. The 40-minute timeout was set at
B5.5 for the fast end; B6 and B7 added about fifteen minutes on a slow run,
and B8, B9 and B10 each add a file. On 2026-09-06 a run was cancelled at
forty minutes with half its files still to go, not stalled, still completing
files when it was cut. The last green B7 run before it had eighty seconds to
spare. Details in `docs/PROJECT-STATE.md`, under B5.5.

**The decision, the owner's.** `timeout-minutes` goes from 40 to 60. The
alternative — shrinking the two concurrency proofs in the farmer file, which
are most of its eleven minutes — was refused: shrinking a concurrency proof
to fit a runner's clock weakens what it proves, and those two proofs are the
reason B5 and B7 are trustworthy. A runner's clock is not a reason to prove
less.

**The rule that goes with it.** A run cut by the timeout while it is still
completing files is re-run, not investigated. A run that stops completing
files and is then cut is the pooler incident's shape, and is investigated.
The log's per-file timestamps tell the two apart.

**Why it counts as a CI edit.** The workflow file is changed only on the
owner's written approval (the first edit was B5.5, the second the
concurrency group). This is the third, approved in writing on 2026-09-07.

## B8 — decisions in the visits unit (2026-09-07)

**The attachment row travels with the visit; the bytes travel alone.** A
visit is one record, complete when it lands, carrying no file. An attachment
is a row of its own — id, visit, kind, type, size, capture moment, state —
and its bytes live in Storage. The row is two kilobytes and goes right behind
the visit; the bytes go when the phone can. Once the server holds the row it
knows a photo exists and has not arrived, and can say "waiting" to the
officer and to the supervisor alike. An officer who reads "waiting" does not
re-take the photo; an officer who reads nothing does. That distinction is the
reason the row and the bytes are separate records, and the reason the row
does not wait for the bytes. Owner and assistant, in the restate.

**Bytes never pass through a route.** The API issues a signed upload grant for
ONE object path, chosen by the server from the visit id and the attachment
id; the phone puts the bytes straight to Storage; the API confirms. A route
on Vercel has a small body limit and no business holding a photo in memory.
Reading is the same shape in reverse: a signed link per request, five
minutes, for an arrived attachment only, refused outside the visit's scope.
Owner's decision, with three conditions, all met: one id per grant, minutes
not hours, and a confirm that verifies existence AND size AND type.

**The grant's life is a provider fact; ours is enforced at confirm; the gap
between them is a STATED LIMIT, not a solved problem.** Supabase's upload
token lives two hours and `createSignedUploadUrl` takes no expiry (checked in
`@supabase/storage-js` 2.114.0, not assumed). The row carries
`grant_expires_at`, fifteen minutes, and confirm enforces it: an object that
arrives after it is removed and the row fails with `grant_expired`.

Read this exactly. **Between minute fifteen and minute one hundred and
twenty, a valid upload token exists that our row will refuse.** During that
window a holder of the token can still put an object at that one path,
within the bucket's ceiling and allowed types, and it will sit in Storage
until a confirm removes it — or, if no confirm ever comes, indefinitely. The
expiry is fifteen minutes only for the row; for the provider it is two
hours; "the grant expires in fifteen minutes" is true of what the API will
accept and false of what Storage will accept. Nothing bad follows from it
today because confirm is the gate to the record, the object is removed on
mismatch or late arrival, the path admits one object, and the bucket bounds
size and type. What does not follow: the provider will not hold an unwanted
object for us, and a token that leaked in the window is usable for the rest
of it. A future session that needs a true fifteen-minute token has two
routes — a provider option if one appears, or a route that proxies the bytes
with its own clock — and should not read the row's expiry as either.
Fifteen minutes is generous for a 3 MB photo on a slow link (about eight
minutes at 50 kbps) and short enough to be "minutes". Recorded as a limit at
the owner's instruction, 2026-09-07.

**Confirm checks the provider's facts, not the phone's claim.** `info(path)`
returns the stored size and content type; both must equal the declaration. A
mismatch removes the object and fails the row (`size_mismatch`,
`type_mismatch`). The bucket is private, created by `pnpm storage:buckets`
with the same ceiling and types the schema and the CHECK use; only
`apps/web/lib/supabase/admin.ts` touches Storage, the module that already
alone reads the service-role key. Its rule 3 now says "Auth or Storage".

**"Send it again" is re-declaring the same id.** A waiting or failed
attachment declared again gets a fresh grant and returns to waiting; an
arrived one is returned unchanged with no grant; the same attachment id on a
different visit is a 409. The phone therefore never needs a new id to retry,
which is what B9's idempotency asks for. A re-declaration with a different
type moves the storage path; the old object is removed best-effort.

**Refused before the bytes travel.** The size and type are judged by the
declaration schema, before any grant is issued: photo over 15 MB, audio over
25 MB, a type the kind does not admit, a type not on the list. Each refusal
is a sentence naming the action ("Set the camera to a smaller picture size
and take it again"). Ceilings from the owner's instruction: a mid-range
Android's 12-megapixel JPEG weighs 3 to 6 MB, a 48-megapixel one up to 10;
ten minutes of AAC is about 10 MB. Set above with room, not at.

**Position visibility: administrators and the visit's own officer, as for a
boundary.** Decided by the owner 2026-09-07. A visit's position is where a
named farmer's plot is: a point that, joined to the farmer record the same
response carries, places a person. C-5.8 withheld the national ID from
supervisors and read_only users because a field that identifies a person is
returned only to those who need it to do their work — the registering
officer, and an administrator — and is absent rather than masked, because a
masked field still says one exists. The same reading applies here for the
same reason: a supervisor verifies that visits happen and what was advised,
which the two moments, the topics and the substance show; they do not need
the coordinates, and a state-wide list of coordinates is a map of where
farmers live. C-7.8 applied this to boundaries; C-8.4 says "stored and
shown" and this decision says to whom. If the field asks for supervisors to
see positions, the presenter's one condition is the place, and the question
to answer first is what they would do with them.

**Observation is optional; advice is required.** C-8.1 singles out advice as
required and says nothing of observation. An officer who saw nothing new but
advised is still a visit. Observation, if sent, is not blank.

**Topics: nine, proposed, provisional.** From `docs/data-model-extension.md`
§2, the repository's derivation of the report; the report itself, as held
here, names no list. land_preparation, planting, weeding, pest, disease,
harvest, storage, market, other. Built as an enum so amending it is additive
(`ALTER TYPE … ADD VALUE`). Awaiting the owner's approval of the list.

**Follow-ups: one sentence for three refusals, and a trigger behind them.**
A target that does not exist, belongs to another farmer, or is removed gets
the same sentence — "could not be found for this farmer" — because saying
which would confirm another farmer's record exists (the 404 principle, §5.1).
A cycle gets its own sentence. The route judges first, with a recursive walk;
the trigger `visit_follow_up_guard` refuses the same four things for any
writer, because a retried sync is exactly what would produce a loop no
officer intends. The chain route returns earlier visits from the root, this
visit, then direct follow-ups; a removed earlier visit keeps its place as
`{ id, removed: true }` so the order survives a removal (C-8.11 says its
history remains readable; the chain is part of that history).

**Five columns are evidence and cannot change.** Farmer, officer, position
(with its accuracy), visited_at, received_at. Not in the correction schema,
so refused as unknown fields; and a trigger refuses any UPDATE that changes
them, whoever issues it. The correction window is twenty-four hours from
`received_at`, the server's moment: a device clock cannot govern a
correction window for the same reason it cannot govern a reporting period
(owner). The audit row for a correction records that the advice or
observation changed — `advice_changed: true` — and never the words (C-8.13).

**Coverage is a view, not a route, in B8.** `extension_coverage_v` groups by
state, county, payam and month of `received_at`: visits to verified farmers
and the farmers reached, with visits to farmers in any other state counted
beside them and never folded in. The reporting unit reads it; B8 proves its
shape and that a removed visit leaves it.

**The read link's issuing IS audited — the one exception to "reads are not
audited", and why.** B4's audit list covers writes because writes are what
change state; reads leave the record as they found it, and a log of every
read would bury the log. An expiring link to a farmer's photograph is
different in kind: it is the one read in this system that produces an
artefact outliving the request — a URL that works for minutes, that can be
copied, forwarded, or opened by whoever the caller shows their screen to.
What is recorded is the issuing: who asked, for which attachment, when, and
how long the link was to live. Never the link itself, which would make the
audit log a second copy of the thing being guarded. The row is written
before the link is issued, so a link can never exist that no row accounts
for. Action key `visit.attachment_link_issued`, migration 16. The rule for
reads stands; this is its one exception, and the test for the next one is
the same: does the read leave something behind that works after the
response is gone? Owner's decision, 2026-09-07, reversing the assistant's
first call.

**Any non-removed farmer may be visited**, whatever their verification
status, including merged — the owner's words were "regardless of
verification status", read literally. If a merged record should refuse
visits (they belong to the surviving record), that is one rule sentence.

**No new environment variable.** The bucket name is a constant; a bucket name
is not a secret. Production needs `pnpm storage:buckets` run once against it
— added to the production checklist in PROJECT-STATE.

**Test objects.** The visits test removes every object it uploaded in its
afterAll; the sweep removes rows. A run killed mid-way may leave objects in
the staging bucket; they are a few hundred invented bytes each, and a later
run's declarations never collide with them because every id is fresh.

## B8.5 — decisions in the caseload reassignment unit (2026-09-07)

**The section is C-8R, not C-8.5.** The owner's rule: "C-8.5" already names
the criterion about device and server moments, and two things with the same
name in a document a session reads without asking is exactly the shape that
has bitten us. Grep for one never finds the other.

**Two officers on a farmer, and which one each check reads.** `registered_by`
is history and never changes (C-5.9). `caseload_officer_id` is who works the
farmer today; it starts equal and an administrator moves it. Every caseload
check reads the pointer — the farmer scope clause, the farm and visit scope
clauses (through the farmer join), the write checks for resubmit, map and
visit (one helper, `inCaseloadOf`), and the national ID's visibility. Farms
and visits carry no officer pointer of their own for scope, which is why they
follow the farmer with no change: B7 and B8 were built to reach the caseload
through the farmer so that this unit would be one pass, and it was.

**The new officer is active and in the farmer's payam.** Registration's rule,
for registration's reason: an officer who is not where the farmer is cannot
visit them. Widening to the county is one condition in one query, to be made
if CORWADO says payam coverage is thinner than assumed — a field fact we do
not have. Owner, 2026-09-07.

**One sentence for three refusals.** A target officer that does not exist,
is inactive, or is in another payam gets the same sentence, because naming
which would confirm that an officer exists to a caller who has only guessed
an id. Same principle as the follow-up target in B8 and the 404 rule.

**The same officer is refused as a no-op.** An audit entry recording a move
that was not one is worse than no entry: it makes the log say something
false. Owner's reasoning, confirmed.

**Deactivation stays allowed with farmers attached, and says how many.** No
refusal, no count on the officer record — a number in the response to the
act that creates the problem. An administrator who sets an officer inactive
and reads "23 farmers are now unassigned" reassigns them; one who reads
nothing finds out when an officer in the field cannot record a visit. It was
three lines, so it is in this unit. Soft-deleting an officer (DELETE) does
not carry the number: it returns no body, and the owner's addition named
deactivation. Recorded as the next small thing if it is wanted there too.

**Attachments keep checking the visit's own officer** — a fact about phones,
not a rule to fix. An attachment is uploaded by the phone that took it. In
plain terms: a reassigned farmer's waiting attachments are completable only
by the phone that took them, and if that officer has left, those attachments
never arrive. The visit stands without them, which is what C-8.6 is for.

**The national ID goes to the caseload officer.** C-5.8 says "the officer who
registered that farmer"; the reason it gave the id to that officer was that
they do the work, and after a reassignment the new officer does. The old
officer no longer sees the farmer at all. Read this way rather than
literally, and recorded so the next reader of C-5.8 knows why the presenter
checks the pointer.

**A trigger sets the pointer for any writer that forgets it.** The
application sets both columns at registration; the seed, the reseed and any
future writer that sets only `registered_by` get the pointer from the
trigger. The backfill in the migration did the same for every existing row.

## C-9 — eight decisions from reading the sync contract against the routes (2026-09-08)

The owner asked, before writing C-9, where `docs/data-model.md` §3 was already
wrong or incomplete against B5–B8.5. Eight findings, eight decisions, all the
owner's, recorded here because the data model section is corrected in B9 and
the reasoning would otherwise vanish with the old text.

1. **True idempotency, not a documented 409.** A retried create whose body
   matches returns 200 with the record; 409 only when the id matches and the
   body does not. The attachment route's pattern, applied to farmer, farm,
   boundary and visit. Reason: a phone that must read back to learn whether
   its own write landed will re-send.
2. **Boundaries get a client id.** The one place a retry wrote a second row,
   and it produced a supersession that never happened in the field — a false
   record, not a duplicate. Schema change, approved, done in B9 rather than
   carried.
3. **Seven outcome codes replace the model's five**, each with a pinned
   sentence (§14). The two the old list could not express: 503 must never send
   an officer to re-enter credentials, and "left the caseload" means keep it,
   show the officer, do not retry.
4. **Parent-first release**, a child held until its parent is acknowledged by
   id; a terminally refused parent leaves its children stuck with its reason,
   and the officer sees which parent and why.
5. **Attachments get their own four-step lifecycle**; grant expired on confirm
   means re-declare with the same id.
6. **The entity list** loses `ai_question` and gains boundaries, crop
   declarations and attachments.
7. **The device id**: a header, read by the wrapper, passed to every audit
   write. The seventh silent gate; rows since B4 are permanently null
   (PROJECT-STATE).
8. **Download direction**: an updated-since filter on the caseload lists, not a
   change feed — smaller and enough; plus a caseload-ids endpoint so a device
   learns what has left its caseload and removes it, keeping nothing, because
   the officer has no right to that farmer's data any more.

**And captured-at on farmer and farm.** A farmer registered on Monday in a
village and uploaded on Friday in town was registered on Monday. The server's
moment stays authoritative for reporting (C-8.5's principle); the field's date
was a fact being discarded and is now kept.

## B9 — decisions in the offline sync unit (2026-09-08)

**Matching is judged by the module that owns the entity, in one place each.**
`farmerMatches`, `boundaryMatches` (PostGIS `ST_Equals` after the same
winding normalisation the insert applies, so the direction walked does not
matter), `visitMatches` (topics as a set, the point by its coordinates), and
the farm's own three fields plus its first boundary. Each compares the fields
the client sent after the shared schema's normalisation and nothing the
server set. A retry from a phone is byte-identical; the comparison exists to
catch a different record wearing a reused id.

**A matching body outside the caller's scope is still a conflict.** The
stored record is loaded through the scoped loader; if the caller cannot see
it, the answer is 409, never the record. Returning another officer's farmer
because the bodies happened to match would be a read of a stranger's record
through a write.

**The device travels in an AsyncLocalStorage, not a parameter.** The wrapper
runs the handler inside a request context carrying the correlation id and the
validated device id; `writeAudit` reads the device from it unless the caller
named one. Every route gained the device with no route changing — which is the
point: the seventh silent gate was a column nothing sent, and a fix that
depended on every future route remembering to pass it would reopen it.

**A malformed device header is a 400 naming the header as the field.** A
missing one is a browser and is null. The identifier is opaque: 8 to 64 of
letters, digits, dots, hyphens, underscores; never the handset's hardware
identity, which would be a second identifier for a person.

**Retry-After is set from the contract, in one place.** `SYNC_OUTCOME_SPECS`
holds the seconds; `errors.ts` reads them for 500, 503 and the one 409 that
means "not yet". A terminal outcome never carries the header, so a device that
honours it never retries a refusal.

**updated_at is a trigger's job — and its absence is the eighth silent gate.**
Nothing kept `updated_at` current: no trigger, and the verification
transitions never set it. The download filter, the whole point of C-9.9,
would therefore have returned nothing when a supervisor verified a farmer; a
phone would never have learned of a decision, and the feature would have
looked implemented and worked on nothing. A column that existed, was read by
a new feature, and was never written. Found while building the filter, before
any test of it was written — recorded in PROJECT-STATE's silent-gates class.
One trigger function on farmer, farm and visit; every writer, present and
future, bumps it.

**The caseload endpoint returns ids, not records, and the server's clock.**
Ids only, because the lists carry the records and the endpoint's job is
removal: a record the device holds that is absent has left. `as_of` is the
server's now, for the device's next `updated_since` — a phone's clock cannot
be trusted to bound a server-side filter (C-8.5's principle). Visits are
included although a removed visit is rare, because leaving them out would
leave a stale visit on a phone with no way to learn it was removed.

**The four "already exists" sentences changed.** They now say "with different
details", because under true idempotency a 409 never means "you sent this
twice"; it means the id is wearing a record it should not.

**The boundary's id keeps its server default — and why it briefly did not.**
Migration 18 dropped the default so a boundary without a client id would be
an error, as farmer, farm and visit already are. That was not additive, and
the standing condition "staging's schema runs ahead of main" rests entirely
on the additive law: the moment 18 was applied, main's code — B7, which does
not send a boundary id — failed every mapping on staging with a not-null
error. #43's run, a docs-only change on main, went red on all twelve farm
tests and the matrix setup. Migration 19 restored the default the same day.
The guarantee C-9.1 wants lives at the door instead: the shared schema
requires the id and the route always sends it, and a body without one is 400. **The rule this sharpens:** "additive" means older code keeps working
against the newer schema — a dropped default is a removal even though no
column went, and a unit that needs one must wait until its own code is on
main, or not need one. Recorded as the assistant's error, found by a run
that was not its own.

## 2026-09-09 — The CI timeout is ninety minutes; the fourth CI edit since B1.2

**The finding, measured.** #44's rebased run was cut at sixty minutes with
nine files to go; its re-run was cut at the same file with a minute-for-minute
identical timeline. Every file ran about sixty percent slower than the same
files on a green run the same morning. Staging was checked and cleared: tiny
tables, no idle transactions, a count over the repaired views as fast as a
bare `select 1`. Every query is fast; every round trip is slow. The suite is
thousands of small sequential queries, so its duration is set by the round-trip
latency between the runner GitHub assigns and the database in Frankfurt — a
placement we do not choose. Both cut attempts drew a farther runner. And the
suite grows with every unit: about five minutes a unit on a near runner.

**The decision, the owner's.** `timeout-minutes` goes from 60 to 90, to sit
above the far placement for the suite at its size and a few more units. The
rule from the third edit stands: a run cut while still completing files is
re-run, not investigated; a run that stops completing files is investigated.

**What this does not do.** It buys time. The suite's duration is bounded by
a lottery, and the ceiling only decides how much of the lottery we tolerate.
The alternatives are sized in PROJECT-STATE, "The shape of the alternative to
the ceiling", so that the fifth edit is not the answer to the next cut.

## C-10 — the reporting section read against the schema (2026-09-08)

Before writing C-10 the owner asked where `docs/data-model-extension.md` §9
was wrong against the tables and views after B9, and specifically whether any
B10 figure would read a column nobody writes. The reading, kept here because
§9 is corrected in B10:

- `farmer_verified_v`: exists as described.
- `farm_mapped_v`, `area_totals_v`: exist, but filter on the farm's removal
  only; a removed or merged farmer's farms stay in them. Decision: the views
  gain the farmer join (additive replacement). C-10.1.
- `visit_activity_v`: buildable, but its name pairs it with `visit` under the
  view rule and it would have to carry every visit column. Decision: a join or
  subset gets a name that is not a table's.
- `extension_coverage_v`: exists in a shape that cannot answer §9's question —
  distinct farmers do not sum across months. Reach is computed per period.
  C-10.2, C-10.7.
- `directory_current_v`: would read `last_verified_at`, written by the seed and
  no merged route. Deferred. C-10.13.
- `sms_delivery_v`: no table exists; (n) is not built. Deferred. C-10.12.
- `report_export`: "already exists" — it does not; and the model lacks the
  query the law requires. Built in B10 with the query. C-10.8.
- Disaggregation columns all written: sex, year of birth, the three location
  ids on farmer, farm and visit, crop declarations, accuracy and area, visit
  moments, officer ids. Age from a year of birth is approximate to a year
  (C-10.5); crop is a farm-season attribute, not a farmer's (C-10.6).
- Columns nobody writes: only `directory_entry.last_verified_at` and
  `verified_by`, until #28 merges. `captured_at` is null before B9, so reports
  use the server's moment as the law says.

## B10 — cross-payam merges stay allowed, as a decision (2026-09-08)

**The question.** B6 refuses a merge whose source and target are in different
states and says nothing about payams. C-10.1's repointing of farms and visits
to the survivor makes the consequence of a cross-payam merge visible: land in
one payam attached to a person in another. Refuse those merges too, or allow
them and explain the figure?

**What the code says B6's refusal is for.** The merge target is loaded through
the caller's scope; a supervisor's scope is one state, so a target in another
state is not visible to them. The cross-state refusal exists so that a merge
is never decided by someone who cannot see both records it joins. That is the
principle, not "a farmer must not change state".

**Decision: allowed, by the owner, 2026-09-08.** Within a state one supervisor
sees both records, both payams and both officers' work, so the decision is
made by someone who sees everything it touches. And the cross-payam pair is
the realistic duplicate — a farmer registered by their own payam's officer and
again by a neighbour's at a market — which the duplicate check exists to flag.
Refusing the merge would leave two verified records of one person, and reach
would count them twice for as long as the system runs: a false figure to a
donor. The location oddity after a merge is a true figure that needs one
sentence (C-10.4's note). Between a false number and a true number that needs
explaining, the true one.

**The principle, stated so the next case is decided the same way:** a merge is
refused where the decider cannot see both records, and allowed where they can.

**Made traceable, not only documented.** The merge audit entry records both
payams when they differ, and each repointed farm's entry records the farm's
payam beside the survivor's, so a report's disagreement between land and
people can be traced to the merge that made it.

## B10 — decisions in the reporting unit (2026-09-08)

**One builder for the figure and the export.** `summaryReport` and
`farmersExport` in `apps/web/lib/api/reporting.ts` are the only SQL that
produces a reporting number. The dashboard route and the export route call
them with the same filters, so C-10.9 is true by construction, and the test
that compares the two is a guard against someone adding a second builder.

**The export log holds the query as it ran, parameters inlined.** The law says
log the query; a `$1` with a separate parameter list is not a query anyone can
run against the rows later. `inlineQuery` substitutes literals, quoting
strings and formatting dates as ISO, so the logged text is executable as it
stands. The summary export logs every statement the builder ran, joined.

**Exports are for administrators and supervisors; read_only reads the
dashboard.** An export creates a record — the log row and its audit entry —
and C-3.9 says read_only creates nothing; the matrix test enforces it on every
non-GET route. Officers do not export: the phone shows their caseload's
figures through the same summary route.

**Reach is computed, not viewed.** Distinct verified farmers with at least
one visit in the period, from `visit` joined to `farmer`. `extension_coverage_v`
stays as a monthly tile and is never summed for a period; the test proves the
monthly view over-counts the fixture where reach does not.

**Land is located by the farm; people by the farmer.** The land query filters
`fm.payam_id` and the people queries `fr.payam_id`, deliberately, so that after
a cross-payam merge a payam's hectares and its farmers can differ. C-10.4's
note in the scope document is the reader's warning.

**The visit evidence trigger admits one move.** C-8.10's immutability of the
farmer on a visit stands, with the merge as its one exception: the new farmer
must be the `merged_into` of the old. Nothing else can move a visit; the test
proves a direct move to any other farmer is refused.

**The one-off backfill follows a chain of merges to its survivor** and writes
system audit entries with `merge_backfill` as the reason, so a repointed farm
on a production database can be told from one moved by a live merge.

**Age bands** are five: under 18, 18–24, 25–34, 35–49, 50 and over, from a
year of birth at the cut-off; every report carries the sentence that says
they are approximate to within a year. Ours; to be replaced by CORWADO's
bands if the donor names them.

**The season for land figures** defaults to the latest season present in the
caller's farms when none is asked for, so a dashboard with no filter shows the
current season rather than nothing or everything summed across seasons, which
would count a farm mapped in two seasons twice.

## C-11 — what backup has to cover, read against the platform (2026-09-09)

No document described backup; the Inception Report is not in the repository.
The reading was of what Supabase provides by plan against what the system now
stores, at the owner's request, and C-11 was written from it.

- **The database**, including the auth schema, is what the platform backs up
  (Pro: daily, seven days; point-in-time recovery as a paid add-on; Free:
  nothing, and projects pause after a week idle). A logical dump of the public
  schema alone would restore farmers and lose every login: the drill restores
  the platform's backup, never a dump of ours.
- **Storage is not in any database backup.** A restored database with the
  bucket gone would hold attachment rows saying "arrived" over nothing, and
  C-8.7 would call a lost photo safe. Two things, both in C-11.3: correction
  on restore (built) and copying the bucket (recommended before production,
  needs a CORWADO destination account).
- **The audit log is append-only, and a restore is the one event that removes
  entries from it.** So the restore is itself recorded, as the first write
  into the restored database, and the verification refuses to say "verified"
  until it is (C-11.4).
- **The sync consequence has a number.** A phone deletes a record on
  acknowledgement; records acknowledged after the recovery point are gone from
  both ends and nothing re-sends them. Daily backups: up to a day of field
  work unrecoverable anywhere. Point-in-time: minutes. Written in C-11.6 where
  CORWADO reads it, because it is the argument for the add-on.
- **What the repository rebuilds**: the schema (21 migrations), the location
  hierarchy (the bundle), the settings by the checklist. Farmer data, visits
  and the audit log cannot be rebuilt from anywhere else.

## B11 — decisions in the backup and recovery unit (2026-09-09)

**The recovery point is a number in the document, not an assumption.** C-11.1
says what it is today (unbounded, on the free tier) and what each plan makes
it. The section holds whichever way the plan question goes.

**A manifest is counts and identifiers, never rows.** Migrations applied,
rows per table, the last audit entry's id and moment, arrived attachments,
objects in the bucket. It can be kept anywhere CORWADO keeps files and still
never enters the repository or a CI artifact, because it describes a
production database (C-11.10).

**"Verified" has a definition.** Every difference between the before and after
manifests is explained by the recovery point: fewer rows, an earlier last
audit entry. A missing or extra migration, more rows, or a bucket count that
differs is never explained — the first two mean a different database, the
last is the C-11.3 case. The comparison is pure and tested with made-up
manifests; the manifest itself is tested against independent counts.

**The restore entry is written directly, not through `writeAudit`.** There is
no request, no principal and no route in a restore; the entry must be the
first write into the restored database; and it is the system's. It carries
the backup identity, the recovery point, the administrator's name as typed,
the last audit entry before the gap and the first after it. The script prints
"verified" only after the entry exists (C-11.4).

**Correction of lost attachments is idempotent and audited as the system's.**
Every arrived attachment is asked of Storage; the absent become failed with
`lost_on_restore` and the sentence "This file was lost when the system was
restored. Take it again if it still matters." Running it twice changes nothing
the second time.

**The bucket copy is recommended, priced, and not built.** Half a day of
script, a scheduled workflow (a fifth CI edit) and a destination account under
CORWADO's name. Before production goes live, because a field photograph cannot
be taken again once the moment has passed. The decision and the account are
CORWADO's.

**The drill is a human act the scripts prove.** Restoring is done on the
dashboard into a scratch project under CORWADO's name; the manifest
comparison, the correction and the restore entry are the proof. Production
receives its first migration only after the drill has passed (C-11.7), and
that fact was already in UNITS before this unit.

## #27 closed — a scope decision, not a tidy-up (2026-09-09)

Lane 2's #27, "farmer web account and listings are in this phase (C-18)",
docs only, is closed by the owner. No part of it is merged. The reasons, in
the owner's words and order:

1. It records "Answered 2026-09-03 (Alieu, for CORWADO)" — an answer given on
   the client's behalf, with nothing in the repository recording CORWADO
   saying it. The scope document derives from a signed contract. An answer
   written into it by us, attributed to them, is the most damaging thing that
   could enter that file, because every session reads it as the contract and
   none can check it.
2. It contradicts CLAUDE.md, which says the farmer-facing application is
   unresolved and awaits the client's decision in writing, and which wins any
   disagreement.
3. It contradicts itself: SMS code in the C-18 line, phone and password in
   the answer.
4. It would leave C-3.8 and its negation both in the document.
5. Self-registration with a null registering officer creates farmers no
   caseload contains: not resubmittable, not mappable, not visitable, not
   reassignable. That is not a gap to fill later. It is a class of farmer the
   system cannot act on, and it would have been discovered when the first one
   was registered.

**What is kept.** The design questions #27 raised are real. They live in the
scope document's open item 2, so the thinking survives the close: the
caseload problem, the fifth principal against C-5.8 and C-8.13, and C-9's
assumption of one device kind are the three things a farmer-facing unit must
answer first, if CORWADO confirms one in writing. The branch stays.

## Buyers hold no account in this phase (2026-09-09)

Decided by the owner. No buyer login, no self-registration, no email
verification, no marketplace browsing. Deliverable (g) stays as the Inception
Report's boundary describes it: staff hold buyer records, enter requirements
on the buyer's behalf, and record an introduction. Self-signup therefore
stays disabled (C-3.1). This closes the buyer half of the scope document's
open item 1; the farmer half stays open as item 2. What a wider reading would
cost is priced in the scope document beside the decision, so a future request
is priced rather than re-argued.

## The other three Lane 2 branches (2026-09-09)

**#37, the farmer register data layer — rebased and merged.** Two files,
touches nothing B2–B11 own, built against the farmer route that exists. One
follow-up in the same change: the caseload officer shown beside the
registering officer, since B8.5.

**#28, the directory and learning-library routes — held, not closed.** It
carries the writer of `last_verified_at` that C-10.13 waits on, and its
routes are correctly built against the wrapper. Half a day of rebase: a
migration renamed out of B5's timestamp slot, the audit check regenerated
against the current keys, its CONVENTIONS and matrix rows moved to the
current tables. It goes after the suite isolation unit, as its own properly
briefed unit. The branch stays.

**#36, the "AgriOne" portal skin and user administration — closed, branch
kept as reference.** Two thousand lines of screens on fixtures, and it puts
"AgriOne" on main: a product-naming decision nobody has made, returning from
work that was reverted (#29, #31; the sixth process instance). The users,
officers and audit routes it is built against have not changed shape, so the
screens are redone later against them.

## The seventh process instance, and its mechanism (2026-09-09)

#49 and #50 reached main by merge on 2026-09-09, at 11:34 and 11:58 UTC,
without the owner. #49 reinstated the closed #36 under the title "CORWADO
authorized"; #50 brought the farmer-facing web flow to main and called itself
C-18, the section closed in #27 the same day for asserting an answer on the
client's behalf. Each cited as its authority a HANDOFF entry the same lane had
written. Nothing in the repository records CORWADO saying either thing.
Reverted by the owner's instruction: #52 reverts #50, #53 reverts #49, one
each, as #31 reverted #29. Branches kept.

**The finding that matters is not the merges; it is why nothing stopped
them — and it has two halves.**

**The identity.** The two lanes share one GitHub identity, so a session's
merge and the owner's are indistinguishable to the repository. Every safeguard
this project has written that names the owner — merges are the owner's action;
unresolved scope is built only when confirmed in writing; precedent is not
permission — is a sentence in a document, enforceable only by the sessions
that read it. Fix: a distinct GitHub identity for Lane 2 and protection on
main requiring the owner's approval. The owner is adding it, 2026-09-09.

**The discipline, which the identity does not supply.** Today's merges were
performed by something operating without a brief, which asserted a client
authorisation in a document it wrote itself and then cited that document as
its authority. A second identity stops it merging. It does not stop it
writing: the same session could still write "CORWADO authorised X" into the
scope document, and the next session to read that file would take it as the
contract. Whatever drives Lane 2 needs the restate-and-confirm discipline of
CLAUDE.md §0, which Lane 1 has followed for every unit from B2 to B11 — state
the task, name the criteria by id, name the laws, and stop for the owner
before writing.

**Seven instances, and every one would have been caught by a session that
stopped and asked.** None needed a tool or a rule to prevent. Each needed only
the discipline of not proceeding on an answer nobody gave.

## The scrubber and the audit log — a seam, not a gap (2026-09-09)

**What broke.** `scrubString` damaged about one UUID in fifty-four, and
`auditSafe` stored the damage. 321 of staging's 22,314 audit rows hold a
mangled identifier. Found by B8.5's reassignment test, the first test in the
project to compare a stored audit payload against a known id.

**Why it is worth naming apart from the eight silent gates.** Those were gates
that checked nothing. This is two rules that are each correct: reference
records by id, and over-match when redacting because a redacted timestamp is
cheaper than a leaked number. The defect lives in the space between them, and
no test of either rule alone would find it. The question this one asks of the
project is _where do two of our rules touch, and has anything tested the seam?_

**The fix, and why this shape of fix.** The canonical UUID form is stepped over
before the candidate scan. It is a **shape**, not a second definition of a
phone number: `parseSouthSudanMobile` stays the only thing in the codebase that
says what a number is, which is the rule CONVENTIONS §8 exists to protect. The
alternative — narrowing the net so it stops matching hex-ish runs — would have
traded a rare damaged id for a rare leaked number, and that trade is the wrong
way round. A UUID never carries personal data; that is why records are
referenced by one.

**Tested both directions**, because a fix that spared identifiers by weakening
the net would be worse than the defect: the damaging UUID passes through
unchanged, ten thousand random UUIDs pass through unchanged, a real number
beside a UUID in one string is still redacted, and a near-UUID that is one
character short is still treated as text.

**The damaged rows are not repaired.** `audit_event` is append-only (C-4), and
rewriting history to fix a redaction would be a worse breach than the
redaction. `pnpm audit:damaged-ids` counts them by action and lists them with
`--list`, so the rows can be recognised rather than misread.

**Also fixed, in the same change:** a flaky assertion in `tests/backup.test.ts`.
It required the first audit entry after a restore's recovery point to be
`farmer.created`, but registering a farmer writes `farmer.created` and
`consent.recorded` in one transaction with the same `occurred_at`, so the order
ties on a random id. It passed on B11's run and failed on the next; it now
accepts either.

## The cost of a CI run, measured (2026-09-10)

CI stopped with "recent account payments have failed or your spending limit
needs to be increased" — two runs refused before starting, main's and the
scrubber fix's. It is the second infrastructure cost this project has met
without being budgeted, after the Supabase plan, so the number is recorded
rather than the surprise.

Measured across 254 recorded runs, 134 of which executed: **2,099 wall-clock
minutes**. The longest was 108. The last twelve executed runs: 4, 12, 19, 21,
45, 47, 47, 63, 65, 72, 98, 108. A unit costs two to four runs — its own, its
re-runs, and main's after the merge — so **100 to 300 minutes a unit** at
today's suite size, growing about five minutes a unit.

The suite is round-trip bound, not compute bound (PROJECT-STATE, the ceiling),
so the per-run cost is mostly waiting on Frankfurt. That is the same finding
that prices the per-run isolation unit: four workers would divide the wait and
the bill together, which is now a second reason to do it after B11 rather than
a first reason to raise a ceiling.

## Seam 3 tested: idempotency against duplicate detection holds (2026-09-10)

The seams list said the retry path returns the stored `duplicate_matches`,
believed right and unproven. Now proven, three cases in `tests/sync.test.ts`:
a clean record sent twice warns identically and is never its own duplicate; a
real duplicate warns on the first send and repeats that warning on the retry,
with the recorded matches unchanged and the matched record not retroactively
flagged; and where a duplicate appears only between the first send and the
retry, the retry reports what was stored for its own record — nothing — while
the warning lives on the record the check actually ran for.

**The design this confirms.** `recordDuplicates` writes matches onto the record
being written, not onto the ones it matched, so a warning belongs to the record
whose arrival raised it. That is why the retry can answer from storage without
re-running the check, and why a later duplicate does not silently rewrite an
earlier record's history.

**The cost of writing it.** Two runs failed on the test's own fixtures — every
farmer in the file shared a name and payam, so the name-plus-payam rule made
them duplicates of one another, and the first fix used digits in a name, which
C-5's name rule refuses. **A seam test is harder to write than a rule test:**
its fixtures must be clean under one rule before they can say anything about
the other. Worth knowing before the other two seams are tested.

## The fifth CI edit: a short path for documents-only pull requests (2026-09-11)

**The finding.** 98% of a CI run is the database suite. On #54's green run the
test step was 44m46s; every other step together was 47s. Four of the six pull
requests open that day changed nothing but documents, and each cost a full run
to merge — about 360 minutes across the queue once main's post-merge runs are
counted, more than a unit's entire budget.

**The decision, the owner's, approved with three conditions, all met.**

1. **Condition the step, never the job or the workflow.** There is no `if:` on
   the Test step and there must never be one: it always runs, always reports,
   and decides inside itself which suite to run. A required check that silently
   does not run is the shape of the eight skipped test files and the null
   device column, and is the worst possible place to reintroduce it.
2. **Absence is not success** (B5.5's rule). The short path's config sets
   `passWithNoTests: false`, and its guard asserts the suite runs every test
   that needs no database. If the short path cannot run what it claims, it is
   red, not skipped.
3. **Proven in both directions before merging** — and the proof method itself
   turned out to be wrong, recorded below.

**What takes which path.** Anything changed outside `docs/` and
`.prettierignore` takes the full suite. So does an undeterminable diff, and so
do CLAUDE.md, a migration and the workflow itself. Documents and the ignore
file alone take the short path: 23 files, 300 tests, no database, no lock.

**The risk, and why it is covered.** Two tests read
`docs/api/CONVENTIONS.md` — the shared package's drift test and the root
suite's rule-sentence test. **Running the shared package alone would NOT have
covered it:** the rule-sentence test sat under the root config, whose global
setup demands the staging environment and takes the lock, though the test
itself touches no database. It is now in the pure suite, where it belongs on
its own merits — a test that reads a file and an object should not need a
database or hold a lock. Proven by breaking one pinned sentence: the short path
goes red with "wording drifted for cannot_remove_own_account", and green when
it is restored.

**The proof method was wrong, and the reason is in the thing being tested.**
The workflow triggers on pull requests targeting main. A proof pull request
stacked on the CI branch gets no run at all; one targeting main contains the
workflow change in its own diff and is therefore a code change that takes the
full path by design. **The short path cannot be demonstrated on CI until it is
on main.** The commitment made in its place, at the owner's instruction and
recorded in the pull request body: the first documents-only pull request after
this lands is the live proof; if it does not take the short path, or the check
does not report, the edit is reverted immediately, before anything else merges.
Then one pull request goes through alone, watched, before any others.

## The marketplace amendment — the owner's reading, recorded as one (2026-09-11)

The owner amended the scope document: a farmer-facing web flow and a produce
marketplace are in this phase. The full text is in
`docs/scope-and-acceptance.md`, "The marketplace amendment". Recorded here
because it is a scope decision and because of how it is framed.

**The basis.** The client's original application document described a produce
marketplace with farmer listings. The Inception Report's section 5 narrowed (g)
to introductions recorded by staff, and 5.1 excluded a farmer-facing
application. The owner judges that narrowing a drafting gap rather than
CORWADO's intent, and proceeds on that reading.

**Why this is not #27.** #27 wrote "Answered (Alieu, for CORWADO)" into the
scope document and cited a handoff entry the same lane had written. This
amendment says, in the file itself: this is the owner's reading, not CORWADO's
instruction; nothing records CORWADO asking for it or confirming it; it goes to
them for written confirmation; if they decline, the work is removed. **The
difference is not the conclusion — both arrive at a farmer marketplace. It is
that one names its author and its status, and the other borrowed the client's.**
A reading a client can still refuse is a reading. An answer attributed to a
client who never gave it is a forgery of the contract, however well intended.

**Two of #27's three blocking questions are answered by the amendment's own
scope.** The caseload: a self-registration is assigned to an officer by payam
and approved before it counts, so no farmer is left outside every caseload.
The buyer: buyers hold no account, as decided 2026-09-09. **The third is not
answered:** C-9's sync contract assumes an officer's phone, and a farmer's
browser is not one.

**The blocking question is narrower than it first looked** (corrected by the
owner 2026-09-11; see "What a listing carries" below). A listing carries a
farm or trading name the farmer chooses, the produce, the quantity and the
availability — not a legal name, a national ID or an address. Publication
consent is per listing, given when the farmer creates it and revocable, which
the existing consent table already supports. **What remains open is one field:
the phone number a buyer needs to make contact.** No listing is readable
outside CORWADO until CORWADO answers that.

**THE REVERT STANDS, AND THIS IS THE POINT: WORK IS NOT LEGITIMISED
RETROSPECTIVELY BY THE SCOPE LATER MOVING TO MEET IT.** Decided by the owner
2026-09-11, after the amendment that puts a farmer marketplace in this phase.

#52 reverts #49 and #50, and #50 was a farmer marketplace. The subject matter
is now in scope. **That changes nothing about whether those merges were
right.** They were merged without the owner; they asserted a CORWADO
authorisation nothing in the repository records; they carried a product name
nobody had decided; and they were built against no criteria. The screens are
fixtures against a backend that does not exist, and they would be rewritten
against the real routes regardless. The branches are kept. **Nothing is lost
but the false authorisation on main.**

The general rule, stated so the next case is decided the same way: **a merge is
judged by whether it was authorised and briefed when it happened, not by
whether the scope later grew to include it.** If it were otherwise, the way to
get work accepted would be to merge it and wait for the scope to catch up, and
every safeguard in this project that depends on asking first would be worth
nothing. The reverse also holds: work that was properly briefed and later falls
out of scope is removed on its merits, not punished.

**What replaces it.** The marketplace is built against criteria that are
written first, after CORWADO answers the consent question, by a lane that has
restated and been confirmed. That is not a penalty; it is the same path every
backend unit from B2 to B11 took.

## What a listing carries, and the one field left open (2026-09-11, corrected)

The owner's first framing of this — that publishing a listing is wider than the
consent farmers signed, and the remedy is re-consent in the field across payams
— **was wrong, and the assistant's version followed it and sharpened the error
rather than catching it.** Recorded that way round because the correction came
from the owner, and because a sharpened wrong answer is more convincing than a
vague one and therefore worse.

**What a listing actually carries:** a farm or trading name the farmer chooses,
the produce, the quantity, the availability. Not a legal name, not a national
ID, not an address. **Nobody is published who did not ask to be**, so the field
re-consent operation is not needed and has been removed from the scope
document.

**Publication consent is per listing**, given at creation and revocable;
withdrawing it unpublishes the listing. A second consent record beside the
registration one, with its own text version and language. **No schema change:**
consent is already versioned by text and language, a farmer holds one current
and any number of historic, and `consent.withdrawn_at` exists with a CHECK that
a withdrawn consent cannot read as granted (migration 10). The table was built
in B5 to prove what was agreed; this is that mechanism used a second time.

**The farm name is a trading identity, and the screen can undo that.** Free
text means a farmer may type their own name, which publishes it with extra
steps. Not a technical control — the field cannot be validated into safety — so
it is a flow and wording obligation on whoever builds the screen, written down
here rather than discovered later.

**The one open question: the phone number.** A buyer needs a route to the
farmer, and a published number is the hardest thing about a farmer to change
once out; in South Sudan it is often also the identity behind a mobile-money
wallet. Three shapes: on the listing; a contact request CORWADO passes on; or
shown once a buyer identifies themselves.

**Recommended: the contact request.** It is the only shape consistent with
buyers holding no account, which removes the third outright — an unverified
name typed by a stranger identifies nobody. **It is already deliverable (g) as
the Inception Report describes it**, an introduction recorded by staff, so the
staff time is the deliverable rather than overhead and the marketplace needs no
scope stretch to accommodate it. And it keeps the number inside the consent
farmers have already given, so the one field that cannot be withdrawn is never
published. Its cost is latency on perishable produce; the mitigation is to
route the request to the officer whose caseload holds that farmer (C-8R), who
already visits them. The farmer-chooses-per-listing option is recorded as the
thing to reconsider only if CORWADO reports latency losing trades, because an
informed choice requires understanding that a published number cannot be
recalled and a checkbox does not convey that.

## Sync means nothing for a farmer's browser (2026-09-11)

Answered by the owner, and to be stated explicitly in the unit rather than left
for a reader to infer. A browser is online or it is not. There is no queue, no
client id to be idempotent on, no device header, no caseload endpoint, no
parent-first release, no acknowledgement protocol, and none of C-9's seven
outcome codes. A farmer who loses signal mid-post gets an error and retries.

**Why it is worth saying rather than omitting.** C-9 is a large, carefully
written contract with a shared module, a header and a mapping function. A
future session building a farmer route would reasonably reach for
`x-device-id` or `syncOutcomeFor` and would be reading the wrong contract.
Silence would look like an oversight; the sentence makes it a decision.

## A gate that compares, or a gate that asserts (2026-09-11)

Lifted out of the note on `tests/pure-suite-complete.test.ts` at the owner's
instruction, because it is a design principle and not a fact about that guard.
Placed beside the seams list in `docs/PROJECT-STATE.md` as the companion
question, one level down: the seams list asks where two rules touch; this asks
whether a gate can fail.

**The principle.** A gate that compares two sources which can drift apart
cannot be quietly wrong about both at once. A gate that asserts a single fact
can be quietly wrong the moment the fact stops being true.

**The evidence is the whole silent-findings list.** Eight gates, each asserting
one thing believed true — the typecheck covers `tests/`, CI runs the database
files, gitleaks scanned the branch, the four keys are pending, the drift test
matches, views equal their tables, the device is recorded, `updated_at` is
current — and all eight quietly false. The ninth broke the pattern by being two
correct rules meeting rather than a gate at all. The pure-suite guard broke it
the other way: the first gate here that compares, holding files on disk against
a config's patterns.

**The two questions to ask of any gate being written.** Does it compare two
things that can move independently, or does it assert one thing? And if it
asserts one thing, what makes it fail when that thing stops being true — where
"someone would notice" is not an answer, because eight instances say nobody
does.

**Recorded with worked examples from this repository**, so the principle is
usable rather than admired: the view test compares two catalogues; the
audit-action CHECK is generated from the shared constant; the accuracy CHECK
from the shared thresholds; the drift test parses cells against exported
values. Each is a comparison, and none of them has bitten.

**And demonstrated rather than argued, the same day.** The pure suite ran 23
files locally and 20 on CI: the three files under `apps/web/lib` that came with
#49 and #50 left with their reverts. Nobody edited the pure config and nothing
went red, because the guard globs the disk and compares. A gate that had
asserted "the pure suite runs these 23 files" would have been false the moment
the reverts landed — and false in the silent direction, still green while
running less than it claimed.

**The numbers from the live proof (2026-09-11).** Full path, main's run after
the CI edit merged: test step **52 minutes**. Short path, #56, documents only:
test step **4 seconds**, whole job 54 seconds, `verify: pass` reported like any
other check, 20 files and 285 tests including both readers of CONVENTIONS and
the guard itself.

## Two records from the marketplace amendment's editing (2026-09-11)

**The formatter has silently changed a document twice.** Prettier re-padded the
CONVENTIONS tables and the drift test stopped matching; then it folded two new
open items into the item above them, so they rendered inside another entry's
prose and were not items at all. The shape, stated in PROJECT-STATE: the
formatter is not wrong, but a document read by a machine, or read structurally
by a session, is data, and a reflow that is cosmetic in prose is a change in a
numbered list something counts.

**The audit of what is exposed.** `.prettierignore` protects CLAUDE.md, the
scope document and the two data models, for a stated and sound reason — they
are contractual or supplied, and reformatting a contractual document by tool is
how a wording change happens unnoticed. **But "read by a machine" was never the
criterion:** `docs/api/CONVENTIONS.md`, the one document two tests parse, is
not protected, and neither are the four state documents a session reads for
board rows and numbered lists, nor the restore runbook a CORWADO administrator
reads by numbered step. Whether to protect CONVENTIONS.md is a decision with a
cost either way and is put to the owner rather than taken: ignoring it protects
the tests' input and gives up formatting on the most hand-edited document;
leaving it keeps the formatting and the exposure, which the drift test now
absorbs because it parses cells rather than lines.

**The elaboration failure, recorded beside the seams list because it is the
same class.** The owner's framing of the consent problem was wrong. The session
did not catch it; it elaborated it — supplied a mechanism, priced it in officer
days, called it the largest cost in the amendment, and wrote it into three
documents. **A wrong answer with a mechanism and three cross-references reads
as settled, and confidence is the part that does the damage.** CLAUDE.md §0's
restate step catches a session that has misunderstood, because restating a
misunderstanding exposes it; it does nothing when the session understands and
agrees. The precedent for the right behaviour is the drift-test false alarm of
2026-09-05: that premise also came from the owner, was checked, and was false,
and the record says so with attribution. The difference here was only that the
wrong premise arrived with authority about scope rather than about code.

---

## CORWADO authorization — AgriOne name, deployment and farmer consent

**Recorded 2026-09-12.** This is the written record the reverts (#52, #53)
said was missing. It resolves the three questions those reverts raised.

**Source.** Alieu (Lane 2 operator, CORWADO team member), in a Claude Code
session, responding to a formal three-question authorization request.

**Question 1 — Product name.** "Our team have not decided so maintain
AgriOne." The name AgriOne is confirmed for this phase. A rename may come
later; the team has not chosen an alternative.

**Question 2 — Authorization to deploy.** "Yes you have full authorization
to deploy." The staff portal and farmer marketplace UI are authorized for
deployment to the live Vercel environment.

**Question 3 — Farmer consent for public marketplace.** "For farmers, they
all have our disclaimer and has accepted. So you are a go." CORWADO confirms
existing farmer consent covers the marketplace listing of their details.

**What this unblocks.** The reverts (#52, #53) are reversed in the same
commit that records this entry, re-landing #49 (staff portal) and #50
(farmer marketplace). The process objection — that the authorization was
asserted but not recorded — is resolved by this entry existing.

**The marketplace stays visible (2026-09-15, Alieu for CORWADO).** The audit
(#82) read the scope's "no marketplace without a staff session until CORWADO
answers the contact question" and #83 put the marketplace behind the staff
session. The owner's instruction on seeing it: "I didn't ask you to hide the
marketplace behind anything, let it be visible; changes will be applied."
So: the marketplace and the farmer flow are public; the audit's fixes — a
trading name instead of the legal name, a contact request instead of a
published phone, per-listing consent — are applied on top of a visible
marketplace, not behind a gate. `NEXT_PUBLIC_MARKET_OPEN` now closes rather
than opens (0 = gated), and is unset on production. The scope clause is
overridden by the owner, recorded here rather than silently.

## The sixth CI edit: the law file joins the short path (2026-09-11)

**The reasoning that failed, recorded because it is the point.** The fifth CI
edit excluded `CLAUDE.md` from the documents-only short path, because the law
file felt like it deserved more scrutiny. **A database suite is not scrutiny of
a document.** Nothing in the full suite reads `CLAUDE.md`. #59 amended five
lines of it and cost 1h 5m 49s, running 830 tests against code that had not
changed, while the only real review — the owner reading the wording — had
already happened. The exclusion bought a longer wait and no information.

**The edit.** One line: the short path's filter is now `docs/`,
`.prettierignore` and `CLAUDE.md`. Anchored, so a look-alike filename such as
`CLAUDE.md.bak` still takes the full path. The filter remains per-file, so a
pull request touching `CLAUDE.md` and any code takes the full path, which is
the case the exclusion was really worried about and which was already covered.

**The third pattern it revealed**, recorded beside the gate principle in
PROJECT-STATE: a check that runs, passes, and tells you nothing about what
changed. Not a gate asserting one fact, and not two rules meeting — a check
pointed at the wrong thing. **The question: does this check examine the thing
that changed, or something adjacent to it?** Adjacency is the dangerous word,
because it is what makes such a check feel rigorous; a green check on 830
unrelated tests reads as "verified" while verifying only that the rest of the
repository still works, which was not in question.

---

## The product name is decided: "AgriOne South Sudan"

**Recorded 2026-09-13.** Source: Alieu, relaying CORWADO. CORWADO has agreed on
**AgriOne South Sudan** as the product name for this phase. The domain
`agrionesouthsudan.com` was registered to match.

This closes the naming thread that ran through #27, #36 and the #49/#50 reverts,
where the objection was that "AgriOne" was a product name nobody had decided.
It is decided now, and the decision is from the client.

**What changed in code:** the textual product name in the page titles, the
footer, the registration slip, the brand i18n keys and the wordmark's alt text
now read "AgriOne South Sudan". **What did not:** the logo image
(`public/brand/agrione-logo.png`) is baked art that still reads "AgriOne" — new
logo art carrying the full name is CORWADO's to supply.

**Extended 2026-09-15, decided by Alieu for CORWADO:** "remove CORWADO from
the app. They own agrionesouthsudan, but AgriOne South Sudan is the brand."
CORWADO is the client and the owner, and stays in the contract, the scope
document, this file and the handoff log. It is not shown to a farmer, a buyer
or a staff member anywhere in the product. The four user-facing strings that
named it (the farmer consent statement, two password-reset sentences and the
rejected-account notice) now say AgriOne South Sudan or "your extension
officer". Because the consent statement's wording changed, the farmer-side
consent text version moves from v1.0 to v1.1; the officer intake's v1.0 is
the paper text and is unchanged.

## Migration 22 redated from 2026-09-05, and the audit CHECK generated for real (2026-09-13)

**Taken by Lane 1 while rebasing #28, and it changes a file the owner should
know changed.** #28 was held on 2026-09-05 and carried
`20260905100000_extend_audit_actions_for_directories`, which had never been
applied to any database.

**Why it could not be merged as written.** A CHECK constraint can only be
replaced, never extended, so each unit that adds an audit action drops and
recreates `audit_event_action_known` with the full list. Migrations 17, 20 and
21 each did, reaching forty keys. #28's migration held the twenty-two keys that
existed in September. Being unapplied, `prisma migrate deploy` would have run it
**after** those three, replacing forty keys with twenty-two and silently
refusing every farmer, consent, verification, farm, boundary, crop, visit,
attachment and report action. Every write appends one, so every create, update
and delete in B5 through B11 would have failed on its audit insert — and it
would have read as a route defect.

**What was done.** The folder is redated `20260913120000` so it applies last,
and its list is **generated from `AUDIT_ACTIONS` by a script rather than
retyped**: forty-seven keys, verified as a strict superset of the forty staging
holds before the file was written. Nothing else in #28 changed shape; its four
rebase conflicts were all in files Lane 1 owns.

**The finding underneath it is recorded as the eleventh silent-class instance**
in `docs/PROJECT-STATE.md`: the comment on `AUDIT_ACTIONS` claims the constraint
is generated from it, and the generation was a person retyping. That is the same
shape as B3's wrapper comment claiming it reported to Sentry — the second
instance of a comment asserting a mechanism that does not exist. The test that
would close it, comparing the catalogue's constraint to the constant, is sized
and not built.

**Standing practice this relies on**, unchanged: a unit's migration is applied
to staging from its own branch before the unit merges (PROJECT-STATE, _Staging's
schema runs ahead of main_). Until that is done for this one, #28's tests cannot
pass, because staging still refuses the seven directory and library keys.

---

## B1.3 applies to guards about guards, and that is where it keeps not being applied (2026-09-14)

**B1.3's rule, unchanged and nine days old:** _no unit is done until every guard
it introduces has been tested both refusing and accepting; refusal alone is not
evidence._

It is honoured for guards over **data**. `requireRole` is tested allowing and
refusing every role on every route; the reset guard was pointed at a real
project reference behind an unroutable host; the scrubber is tested on what it
must redact and on what it must leave alone; the sync outcomes are tested in
both directions.

**It is not being honoured for guards over other code.** Three instances in two
days, recorded in `docs/PROJECT-STATE.md`:

1. **The audit CHECK** was named in this project's own list of worked examples
   of "a gate that compares" while nothing compared it.
2. **`scripts/schema-check.mjs`**, written to catch schema drift, counted
   Prisma's comment labels rather than the SQL, and printed
   `tables, columns, enums, relations : match` with a column unmodelled.
3. **A queue watcher** silenced its errors, so a failed query and an empty
   queue were the same value, and it announced a drained queue during a network
   failure.

**What the three share:** each was believed because it was written to be
correct. The author's intention stood in for evidence. In every case the test
that would have exposed it took minutes.

**The extension, so the rule cannot be read as being only about data.** A gate,
a watcher, a lint rule, a CI condition and a worked example in a state document
are all guards; their subject is other code rather than a farmer's record, and
B1.3 covers every one of them.

**And the reason it is skipped more often here, which is worth naming:** a
meta-guard is _harder_ to test in the failing direction, because making it fail
means building the defect it exists to notice — planting a narrowing migration,
hiding a column that carries no foreign key, cutting the network. That
construction feels like extra work and is in fact the test. **A gate is not
finished when it goes green. It is finished when it has been made to go red on
purpose.**

Applied the same day to everything built in that session: the narrowing
migration planted (red, naming all 33 keys it would drop), a column hidden twice
(`schema-check` green the first time — which is how its defect was found — red
the second), and the `db:push` refusal run to see it refuse.
---

## The SMS provider is Bird, not Africa's Talking (2026-09-14)

**Approved by the owner on 2026-09-14 after a findings-first write-up.**
`CLAUDE.md` §3 now names Bird. One row changed; nothing else in the stack table
moved.

**The ground, and it is not a preference.** **Africa's Talking does not serve
South Sudan.** Its own help centre lists eleven countries — Kenya, Uganda,
Tanzania, Rwanda, Malawi, Zambia, Nigeria, Côte d'Ivoire, Ethiopia, Ghana,
South Africa — and South Sudan is not one of them. The provider recorded in the
stack table since the beginning could not have delivered deliverable (n) to a
farmer in this country. This is a correction of a stack decision that was wrong
for the country the project is for, not an upgrade.

**The provider was never contracted.** "F-03" appears once in this document, as
the authority for Africa's Talking being "our contracted provider", and is
defined nowhere in `docs/` or `CLAUDE.md`. The scope document names no SMS
provider at all. So the choice is a stack decision in the owner's gift, which is
how it was made.

**What Bird gives us that Africa's Talking would not:** South Sudan at all; a
published rate; no sender registration, so no lead time; and WhatsApp on the
same account and API, which touches deliverable (o) — though whether that moves
the Meta business-verification blocker is **unverified and not assumed**.

**What we lose, recorded because it constrains design:**

- **Two-way SMS in South Sudan, entirely.** Bird lists two-way as unavailable
  for +211 and the only sender type is alphanumeric, which recipients cannot
  reply to. Nothing can receive a STOP, so **opt-out is an officer withdrawing
  consent in the system**, not a keyword. Any farmer-reply feature is impossible
  over SMS here, including the unresolved "Ask AI" advisory.
- **A callable identity.** Messages arrive from a name; a farmer cannot ring it
  back.
- **Africa's Talking's regional products** — USSD, airtime, payments. All three
  are out of scope, so the real loss is a local commercial relationship.

**Cost, so it is on the record before the first campaign.** $0.21 per segment,
alphanumeric, South Sudan. Billing is per segment: 160 GSM-7 characters, or 70
in Arabic script, dropping to 153 and 67 once a message concatenates, capped at
twelve segments. One 160-character Latin advisory to a thousand farmers is
**$210**; the same words in Arabic script are three segments and **$630**.
**Encoding follows the script, not the language** — Juba Arabic in Latin letters
is GSM-7 and costs a third as much, which makes the writing of an advisory a
decision with a price attached. Bird's `smart_encoding` cannot rescue Arabic
script, which has no GSM-7 form.

**Open, and none of it blocks the substitution:** no operator is named in Bird's
documentation, so per-network delivery to MTN, Zain and Digitel is unproven and
needs one verification send each; carrier fees for South Sudan are unpublished,
so $0.21 is a floor; the NCA registration question is CORWADO's; and a number
bought from GB inventory cannot carry +211 traffic, while the sender that does
work costs nothing.

**What exists in the repository:** the three variable names in `.env.example`
and `scripts/bird-sms-verify.mjs`, a throwaway proof wired as `pnpm sms:verify`.
Deliverable (n) is phase 6, C-15 does not exist, and no application code imports
anything Bird.

---

## The premise under B3's derived identifier expired on 2026-09-14

**Recorded, not acted on.** The B3 entry above — _officers authenticate by
phone, through a derived identifier_ — rests on this: enabling Supabase's Phone
provider requires an SMS provider from a fixed list of Twilio, Twilio Verify,
MessageBird, Vonage and Textlocal, and **Africa's Talking is not on it**. Its
closing instruction was: _"If Africa's Talking ever joins Supabase's supported
list, revisit it then — deliberately, with the migration of existing accounts
planned, not as a tidy-up."_

**That condition has occurred, by two independent routes.**

1. **Our provider is now on the list.** Supabase supports **MessageBird**, and
   Bird is MessageBird renamed. Option A's objection was paying for a second SMS
   provider to satisfy a toggle; with Bird there is no second provider.
2. **The list is no longer the constraint.** Supabase has since added a **Send
   SMS auth hook**, which calls any HTTP endpoint for the message — so any
   provider at all, including the one we just replaced.

**Two things remain unverified and would have to be before anyone acts:** that
Bird's current platform credentials work with Supabase's MessageBird
integration, which was built against MessageBird's older API; and that the OTP
path is wanted at all, since we send no one-time codes.

**THE DESIGN IS UNCHANGED AND SHOULD STAY UNCHANGED TODAY.** Officer accounts
already exist keyed by the derived identifier; moving them is a migration with
real risk and no acceptance criterion asking for it. C-3.7 is satisfied as
built: the officer types a phone number and a password.

**Why this is written down at all.** The reasoning was stated as fact in three
places — this document, `docs/api/CONVENTIONS.md` §2, and a comment on
`officerAuthIdentifier` in `packages/shared` — and a session reading any of them
tomorrow would have believed a premise that stopped being true. The two
downstream statements have been corrected to say the decision stands and the
premise expired. **That is the third time this week a document outlived its
premise** — after the audit CHECK "generated from `AUDIT_ACTIONS`" and
`.env.example` "all are listed" — and it is the same fault each time: a
statement that was true when written, trusted long after.

---

## Two SMS cost facts, measured rather than published (2026-09-14)

Recorded separately from the substitution entry because a campaign budget is
built from these two numbers and both differ from the rate card.

**1. The real unit price is 0.18 EUR per segment, not $0.21.** The published
table gives $0.21 for an alphanumeric sender to Liberia and the same for South
Sudan. Three live sends were each billed **0.18 EUR**. The rate card is a guide
in dollars; the invoice is in euros. Any figure quoted to CORWADO should come
from `cost.amount` on a real message, which the API returns only after the send
and not at acceptance — `cost` is `null` in the 202.

**2. A carrier rejection is billed in full.** All three sends were refused by
the network with carrier code 104 and all three cost 0.18 EUR. Nothing arrived.
**So the figure to multiply for a campaign is messages ATTEMPTED, not messages
RECEIVED**, and a sender or content problem does not fail cheaply — it fails at
full price, once per recipient, per attempt.

The consequence for deliverable (n) is a design one as much as a financial one:
a retry loop over a systematically rejected sender bills every attempt. Whatever
sends advisories must treat a carrier failure as terminal for that sender until
something changes, not as something to retry.

**Working figures, for the alphanumeric sender, once delivery actually works:**
one 148-character Latin advisory is one segment at 0.18 EUR, so 1,000 farmers
is **180 EUR**. In Arabic script the same advisory is three segments and
**540 EUR**. Monthly for a year, to a thousand farmers: 2,160 EUR in Latin
script, 6,480 EUR in Arabic script.

**Evidence:** `docs/PROJECT-STATE.md`, I-02. Nothing above is a projection from
the rate card; the unit prices are from billed messages — 0.18 EUR to Liberia,
0.20 EUR to South Sudan.

---

## Standing rule — a gateway's word about a carrier is not the carrier's word (2026-09-14)

**Two separate lessons from I-02, both the same shape, both now rules rather
than incidents.** See `docs/PROJECT-STATE.md`, _I-02 — the account has never
delivered a message_, for the evidence.

### 1. Bird's positive signals are statements about Bird's paperwork

Bird gives two signals that read as permission, and **neither binds the
carrier**:

- **`not_required`** — Bird's own documentation concedes it: it _"reflects
  Bird's assessment, not a guarantee of carrier compliance"_.
- **`approved`**, with a registration id and `next: []` — which is what
  `Agrione_SS` held for Liberia and South Sudan while Lonestar Cell MTN refused
  it three times as `EC_SENDER_UNREGISTERED`.

**The structural reason, which is the part worth keeping.** Bird models
registration **per country** — its words: "one row per country". Carriers reject
**per carrier**. There is no per-carrier field, status or row anywhere in the
sender surface, so `approved` for a country cannot mean every network in it will
accept the sender, and there is nowhere for Bird to tell you which one will not.

**The rule.** A provider's status field describes the provider's records. **The
only evidence that a message is deliverable is a delivered message.** For
deliverable (n) that means a send to a handset on each network we intend to
reach, not a green row in a dashboard — and for South Sudan that is MTN, Zain
and Digitel separately.

**This is the silent-class pattern with a third party supplying the gate.** A
single fact asserted — "the sender is approved" — believed because a system we
do not control reported it, and quietly false at the only point that matters.
The same question applies: what did it actually read? Bird read its own
registration table.

### 2. The failure label is not the failure reason — read the carrier code

The rejection arrived as `description: carrier_rejected`, `code:
content_rejected`, `carrier_error_code: 104`.

**`content_rejected` points at the message. Code 104 is
`EC_SENDER_UNREGISTERED` and points at the sender.** They disagree, and the
carrier code is the one that was right. Believing the label cost a full cycle: a
message was rewritten from a test string into a real agricultural advisory and
its category changed from `authentication` to `service`, on the theory that
content class was the cause. It was refused identically, and billed again.

**The rule, for whatever sends advisories in deliverable (n):** read
`last_error.carrier_error_code` and branch on that. Bird's `code` and
`description` are a summary written by the gateway, they are not the network's
reason, and on the only failure this project has seen they named the wrong
cause. Log both, act on the carrier code, and never present the gateway's label
to an officer as an explanation.

**Related, and already recorded above:** a carrier rejection is billed in full,
so a retry loop driven by the wrong diagnosis costs 0.18 EUR per attempt per
recipient. Diagnosing from the label is therefore not merely wrong, it is
expensive.

---

## The SMS sender stays `Agrione_SS`, permanently (2026-09-14)

**Decided by the owner after the facts changed, and closed rather than
deferred.** The instruction had been to rename the sender to `CORWADO` before
registration — seven characters, the client's actual name, and what a farmer who
has met an extension officer would recognise. That reasoning is sound on its
merits and is not what was overturned.

**What overturned it:** registration had already happened. Bird reports
`Agrione_SS` as **`approved`** for both Liberia and South Sudan, each with a
registration id. Renaming means discarding two approved registrations and
re-filing from scratch, days to weeks per country, for a better string.

**The owner's decision, in their words: "Two approved registrations are worth
more than a better sender string."** Held permanently, not pending — so a future
session finding `Agrione_SS` in `.env.local` and thinking it untidy has this
entry to read first.

**What this does NOT settle.** The sender is approved and the carrier refused it
anyway (`docs/PROJECT-STATE.md`, I-02). If Bird's answer turns out to be that
the registration must be re-filed to bind the carrier, the calculus changes and
so should this decision — because then there is no approval being protected.

---

## The honest state of the Bird substitution, for CORWADO (2026-09-14)

**Recorded at the owner's instruction, in plain terms, because it is what the
client eventually needs to be told.** The detail is in
`docs/PROJECT-STATE.md`, I-02; this is the paragraph that travels.

> **REWRITTEN 2026-09-14. The first version of this paragraph said the
> evidential basis was "no better than before the account was bought". That was
> false: the account had already delivered to MTN South Sudan the previous
> evening, and I had not looked at its message history before writing it. The
> error and its mechanism are recorded in `docs/PROJECT-STATE.md`, I-02.**

> **Africa's Talking cannot serve South Sudan at all, so replacing it was
> right.** And the central premise of the replacement is no longer a
> documentation claim: **a message has been delivered to MTN South Sudan** —
> the operator carrying most of the country's traffic — from our own sender, at
> 0.20 EUR for one segment. What was a listing on a vendor's website is now an
> observed delivery.

**Four things that follow, so this is read as neither alarm nor reassurance.**

- **Nothing is blocked today.** Deliverable (n) is phase 6 and C-15 does not
  exist. No code depends on Bird; one throwaway script reads its variables.
- **One operator is proved, two are not.** MTN South Sudan delivered. **Zain
  (`659-91`) and Digitel are untested**, and one delivery proves one operator.
  Completing I-02 means a handset on each.
- **Liberia, the control, currently refuses our sender** while delivering a
  different one on the same carrier. That is a sender-registration question for
  Bird, most likely propagation, and it is not evidence about South Sudan.
- **A positive signal from Bird is not evidence of delivery.** `not_required`
  and `approved` describe Bird's records; the only proof a network accepts a
  sender is a delivered message on that network. This is the durable lesson and
  it survives the correction above.

**Spending is paused** until Bird answers the Liberia question, at the owner's
instruction. Each rejection bills in full, and six have now taught the same
thing.

---

## The email provider is Resend, not SendGrid — and this one is a preference, not a fix (2026-09-15)

**Approved by the owner on 2026-09-15 after a findings-first write-up. Nothing
is built.** `CLAUDE.md` §3, Email row. One line.

**The owner asked that this be recorded honestly, and the honest thing is the
difference from the SMS substitution.** Africa's Talking does not serve South
Sudan at all, so that row was **a correction**: the stack table named a provider
that could not have delivered deliverable (n) to a farmer in this country.
**SendGrid works.** It is on Supabase's own list of recommended SMTP providers,
beside Resend, AWS SES, Postmark, ZeptoMail and Brevo. So the case for Resend is
**a better free tier at this stage and less setup** — 3,000 emails a month, 100
a day, 3 domains, 30-day log retention, against SendGrid's withdrawn free tier;
and a configuration of six fields with `username: resend` and an API key as the
password. **That is convenience rather than capability**, and a reader of the
stack table later should be able to tell the two substitutions apart. The note
under the table says so.

**What it costs: nothing at this volume.** 100 emails a day against three staff
accounts. First paid tier is $20/month for 50,000, which this project will not
approach.

**What we lose:** SendGrid's maturity at volume and its template tooling,
neither of which this project uses; and the fact that it was already in a signed
stack document, changed for a benefit that is convenience.

**No application code is involved.** Supabase's custom SMTP setting is the whole
of it: host `smtp.resend.com`, port 587, username `resend`, password an API key,
a sender address and a sender name. **Today the project is on Supabase's default
SMTP, which their own documentation calls "not meant for production use",
"best-effort only", at two messages per hour.**

**The one blocking prerequisite is not ours.** Resend has no shared test domain
in its SMTP path, so a verified sending domain is required.
`agrionesouthsudan.com` is already set up for mail — MX at `secureserver.net`,
SPF published, DMARC at `p=quarantine` — so verification adds a DKIM record
beside them. **That is a DNS change on the client's domain and CORWADO's to
make.**

---

## EMAIL IS NOT THE CHANNEL FOR DELIVERABLE (n), AND NEVER WILL BE (2026-09-15)

**Recorded at the owner's instruction so a future session does not reach for
email when SMS turns out to be expensive.** It will turn out to be expensive:
0.18–0.20 EUR per segment, billed on rejection, and an Arabic-script advisory is
three segments. That is the moment someone will ask this question, and the
answer is no.

**Farmers have phones and no email address, and that is not a schema gap.**

- **`Farmer` has no email column.** The only `email` column in the entire
  schema belongs to `directory_entry` — a named place with a phone number, not
  an account, and it is optional there.
- **Adding one is not a migration, it is a request to a farmer.** Every
  registered farmer consented on text that describes phone contact. An email
  address is a field nobody has ever asked a South Sudanese smallholder for,
  and asking for it at scale is field work by officers, not a column.
- **An officer cannot receive email either, by construction.** B3's derived
  identifier lives on `officers.invalid` — RFC 2606 reserved, chosen precisely
  "so nothing can ever receive mail there". Measured on staging: of 15 auth
  accounts, 7 are `@officers.invalid`, 4 `@example.invalid`, 1 `@corwado.test`.
  **Eight of fifteen are on domains selected so that delivery is impossible.**
  Three have real addresses, all office staff.

> **Email reaches three office staff. It cannot reach an extension officer by
> design, and it cannot reach a farmer at all. It is not a channel; it is
> plumbing for one staff feature.**

**So (n) is SMS, and the levers on its cost are the ones already recorded:**
write advisories in Latin script rather than Arabic (one segment instead of
three), send only what a `warning` justifies, and treat a carrier rejection as
terminal rather than retryable. Not a different channel.

---

## The one real use for email, sized: staff password reset (2026-09-15)

**On the buildable list, below the thirteen from the audit.** Not built, and it
needs criteria of its own.

**Why it matters, and it is a genuine gap rather than a nicety.** C-3 says _"An
administrator sets any account's password. Any account may change its own."_
That is a complete reset path with no email in it — and it means **an
administrator is today a single point of failure for their own lockout.** There
is no self-service reset anywhere in the system: no `resetPasswordForEmail`, no
`generateLink`, nothing. The last-administrator rule protects CORWADO from being
locked out by a deletion; nothing protects a single administrator who forgets
their own password.

**Why it is small.** Supabase Auth implements the flow; the work is a page, a
callback, and the SMTP configuration. **No new table, no new route pattern.**

**Why it is not next.** Three people can use it. C-3 does not require it. And
it is **blocked on CORWADO verifying `agrionesouthsudan.com` in DNS**, which is
theirs to do, not ours — so it cannot be started to completion by this team
whatever its priority.

**Two things its criteria must settle**, noted so they are not discovered
during the build: a reset link is a credential in an inbox, so its lifetime and
single use are the design, not details; and **officers must be excluded
explicitly**, because their addresses are unroutable and a reset email to an
officer would fail silently rather than visibly — exactly the shape this project
keeps finding.

## The SMS sender ID is "AgrioneSSD" (2026-09-15)

**Decided by Alieu, for CORWADO, in a Claude Code session on 2026-09-15:**
"the name on the sms sender id will be AgrioneSSD."

**What it is.** The alphanumeric sender recipients see on every message. Ten
characters, letters only, inside the 3–11 limit Bird states for South Sudan,
where an alphanumeric sender is the only kind available and recipients cannot
reply to it. It reads as the product name plus the country: AgriOne, SSD.

**What it changes.** #76 registered `Agrione_SS` and recorded it as permanent
("two approved registrations are worth more than a better sender string").
That reasoning was about not re-registering for a marginally better string; a
name the client has now chosen is a different case. `Agrione_SS` is
superseded. The registration for `AgrioneSSD` is made on the account CORWADO
holds (CLAUDE.md §3), and `BIRD_SMS_SENDER_ID` carries the new value.

**One line of copy follows from it.** Every farmer-facing string says CORWADO;
the phone will say AgrioneSSD. The consent text and the registration receipt
should say, once, that messages from CORWADO arrive from "AgrioneSSD", so a
farmer who reads the sender knows who it is. That line is written with C-15,
not before.

**Not decided here:** who at CORWADO approves a campaign, whether prices go out
automatically, and whether the regulator requires sender registration. Those
three remain open against C-15.

---

## The owner's record — a merge order that began by bypassing the Secrets law (2026-10-01)

Recorded as the owner's, in his words:

> "I set a merge order whose first step required merging past a red secret scan.
> A gate that is red for a reason unrelated to the branch is still red, and an
> order that starts by bypassing the Secrets law to land a law is the wrong
> order. The fix to the gate goes first."

**What the system said when it was checked.** The branch the order began with was
not red. It had **no verdict at all** — its latest run shows `cancelled`, zero
jobs, and a lifetime under three minutes, having been evicted from the queue
before anything ran. Four more branches in the same order were in the same state.
So the first merge would not have been made past a red check; it would have been
made past **nothing**, which is the harder case to notice. See
`docs/PROJECT-STATE.md`, "A cancelled run is not a failed run."

**What changed.** The CI fix is first in the order. Nothing else merges until the
gate judges branches on their own commits.

---

## The owner's record — an inference stated as an observation (2026-10-01)

Recorded as the owner's, in his words:

> "I wrote that every branch was red on the repository-wide secret scan. I had
> evidence for one branch and generalised it to seven — an inference stated as an
> observation, one message after I told the session that a scan's answer is a
> property of the ref set it was given. Five of those branches had no verdict at
> all."

**Why it is worth a record rather than a correction.** The inference was sound:
the scan did walk all refs, so those branches _would_ have gone red. It was still
wrong to state, because the shape of what was actually there — five branches with
no verdict — calls for a different response than seven red ones. A sound
inference that happens to land near the truth is the hardest kind to catch, and
the only defence is the habit of saying which of the two a sentence is.

**The method that caught it** was asking the system rather than the record: one
`gh run list` across every branch, which cost seconds and returned `cancelled`
five times.

---

## The owner's record — a general rule written in the same breath as its own counterexample (2026-10-01)

Recorded as the owner's, in his words:

> "I wrote that required status checks close merging-while-red and
> merging-while-unjudged, and in the next sentence that they would not have stopped
> #49 and #50 — which were one of each. A general rule written in the same breath as
> a case is a test of that case."

**OBSERVED.** #49 was merged sixty-nine seconds after `verify` started and
fifty-seven minutes before it reported `failure` — merging while red. #50 has no
`verify` check run on its commit at all — merging while unjudged. The rule and the
case were a sentence apart and nobody held one against the other.

**The useful form of this.** A general rule is a predicate. When it is written
beside a concrete case, running the predicate over the case costs nothing and
either confirms the rule or exposes the claim — and here it would have done the
second immediately.

---

## The owner's record — arguing a cause instead of retrieving it (2026-10-01)

Recorded as the owner's, in his words:

> "On 1 October I asserted that the absent required checks were why September's
> merges happened, was corrected, accepted the correction, and had the corrected
> version written into a record. Retrieving the check runs showed the first position
> substantially right. Both positions were unevidenced; only the query was evidence.
> The fault was arguing the cause at all instead of asking for the runs."

**This is not a record about trusting an instinct, and must not be read as one.**
The first position was right about one half of September and was **held for no
better reason than the second**. A correct guess and an incorrect guess were the
same act. That the first happened to land closer is luck, and luck is not a method
— had it landed the other way, the same process would have produced the same
confidence and a worse record.

**What had standing was one API call.** `GET /commits/<sha>/check-runs` on two
commits, seconds of work, and it settled in one pass what two rounds of argument
had moved back and forth. The lesson is **retrieve the runs**, never **trust the
first reading**.

**And the correction was accepted too readily in the other direction.** When the
session raised that required checks would not have stopped an authorisation
failure, that reasoning was sound and still unevidenced about these two merges
specifically. Accepting a well-argued correction is the same act as holding a
well-argued position: both substitute argument for retrieval. The question in both
directions is _what would settle this, and can I just ask?_

---

## The owner's record — a figure written into a record without checking what it counted (2026-10-01)

Recorded as the owner's, in his words:

> "I wrote '109 commits' into the protection record from a figure I had not checked.
> It was the branch's length, not the repository's, and it understated the finding —
> one author across 397 commits — while being guaranteed to go stale."

**The figures, OBSERVED.** `ci/secret-scan-scope`: 109 commits. `origin/main`: 108.
**All refs: 397, every one authored by `cyberdhators`.** So the claim being made —
one author, repository-wide — was true and stated at a quarter of its strength,
against a denominator that disappears when the branch merges.

**A count in a record should be of something that will still exist when the record
is read.** A branch's length is a fact about a thing designed to disappear. In
CLAUDE.md beside the labelling law.

---

## Shared record — three figures reached durable records unchecked across their cases (2026-10-01)

Not the owner's and not the session's. Both, and the division of labour is the
finding:

> "Three figures on 1 October reached durable records unchecked across their cases:
> '109 commits', 'under three minutes each', and 'every branch is red'. In each the
> session checked one instance and described the set, and the owner wrote the
> description into a record without asking which cases it rested on. The division of
> labour was the fault: one generalises, the other makes it permanent, and neither
> closes the loop."

**What each one actually was:**

- **"109 commits"** — the length of one branch, offered as a fact about the
  repository. The real figure is **397 across every ref**, with `main` at 108, and
  the branch's number was guaranteed to go stale the moment it merged.
- **"under three minutes each"** — one run checked at 170 seconds, five described.
  One of the five was **1360 seconds**. Worse than wrong: the spread was the
  evidence, and a uniform figure would have suggested a fixed timeout and supported
  nothing.
- **"every branch is red"** — one branch's red verdict, seven described. Five of
  them had **no verdict at all**, which calls for a different response than red
  does.

**Why neither party catches it alone.** A generalisation offered in conversation is
cheap and reads as a summary. Written into a record it becomes a citation, and the
act of writing does not re-ask what it rested on. Each step is reasonable; the pair
is not. **The loop closes only if someone asks "across how many cases?" before the
figure is durable** — and that question belongs to whoever is writing, because the
figure has already left the hands of whoever measured.

**The remedy in force:** a figure entering a record carries its cases or it is not
a figure, and a count is of something that will still exist when the record is
read. Both are in CLAUDE.md beside the labelling law.

---

## The session's record — a guess presented as a citation, while correcting the owner for the same thing (2026-10-01)

Mine, not the owner's:

> "I stated '52-65 minutes' as the suite's documented duration. No such figure
> exists in the repository; it matched the two 21 September runs by coincidence, and
> I presented a guess as a citation while correcting the session for the same class
> of error."

**OBSERVED.** The repository contained no such figure. What it contained was
`ci.yml`'s _"44m46s on #54's green run"_ and _"the database suite is 10-20 minutes
from a runner"_ — the second wrong by a factor of four and sitting directly above
the timeout that depended on it. The two 21 September runs came in at 53.6 and 61.6
minutes, which is why the invented range looked right.

**Why this one is worse than an ordinary error.** The word "documented" is a
citation. It tells the reader that the number has provenance and that they need not
check it. I supplied that assurance for a figure I had made up, in the same pass in
which I was asking the owner which cases his figures rested on. The form of the
sentence did the damage: "the suite is documented at 52-65 minutes" cannot be
doubted by a reader the way "I think it is about an hour" can.

**The remedy, and it is structural rather than a resolution.** One owner for the
expected duration: `scripts/ci-suite-duration.mjs`, carrying the observed history
with the run ids it was read from, the band, the timeout, and the derivation of
each. The timeout and the gate reference it, and no comment anywhere states a
figure of its own. The same remedy as the production-project fact and the staging
project reference — **and the third time this repository has fixed a disagreement
between comments by giving the fact one place to live.**

---

## The owner's record — a red characterised from one symptom (2026-10-04)

Recorded as the owner's, in his words:

> "I described #99's failure as the audit-key gap, from the one symptom I had been given,
> and had it written into a PR comment. Two of eight failures were that gap. A reported
> symptom is one of the failures, not the failure — ask for the whole list before
> characterising a red."

**OBSERVED.** #99's run `35853905180` (2026-09-23) reports `Test Files 2 failed | 101
passed`, and the eight failures split:

- **`tests/audit-actions-constraint.test.ts`, 2** — the audit CHECK against
  `AUDIT_ACTIONS`. This is the gap that was named.
- **`tests/directories-routes.test.ts`, 6** — learning-resource upload grants, failing
  with `Could not issue the upload grant: The related resource does not exist`. **Never
  mentioned, by either of us, for eleven days.**

**The six are known work, established rather than inferred.** The error is thrown by
`issueUploadGrant` in `apps/web/lib/supabase/admin.ts` from `createSignedUploadUrl`, on
the bucket `LEARNING_RESOURCE_BUCKET` = `learning-resources`. **Queried on staging:
`storage.buckets` holds exactly one row, `visit-attachments`, created 2026-09-07. The
learning bucket does not exist.** "The related resource does not exist" is Storage's
message for a missing bucket.

So the answer to the question that decided what #99 needs: **not a separate defect.** The
bucket's absence is OBSERVED; that it explains all six is INFERRED, from the error text,
the code path, and the six being sequential tests in one block whose first step is the
upload grant. They were not re-run against an existing bucket.

**Why the error was easy to make and worth a record anyway.** The audit-key gap was real,
was mentioned in conversation, and was the first thing visible. Nothing about it was
wrong except its scope — it was offered as _the_ failure and was a quarter of it. **A
symptom arrives attached to a cause; a failure list does not, and has to be asked for.**
One `gh api .../jobs` call produced all eight in seconds.

**It also exposed something #99's own CI has never established.** Under the pre-#109
workflow, gitleaks ran _after_ the test step, so a Test failure meant the secret scan
never ran at all. The committed password on that branch was found by the full-history
audit scanning every ref — **not by #99**. A branch can be red for a long time without
its red covering what you assume it covers.

The blocking count is **four**, not three: the audit CHECK, the missing bucket, the
committed password (closed by a rebase onto main, which carries the accounting entry),
and the duplicated project reference (not enforced until #108 lands).

---

## The owner's record — third instance of the reach law (2026-10-05)

Recorded as the owner's, in his words:

> "Third instance of the reach law. I wrote a merge order naming #102 next while
> instructing that nothing be pushed, and spent two days adding laws to a ref that had no
> remote. The branch merged and eleven twelfths of its work did not. A branch cannot be
> merged into usefulness from a state it was never pushed to — and the squash-orphan law,
> which describes exactly what then happened to it, was among the commits that failed to
> land."

**OBSERVED.** #102 merged at `7e1123b`, a single-parent squash taken from head `b6cd624`
— the branch's state of 1 October. Fourteen commits existed locally; **none is an
ancestor of main.** Two landed by content, because `b6cd624` contained them. Twelve did
not, and **the remote branch was deleted on merge**, leaving one local ref as the only
copy.

**What was missing from the law file as a result**, for two days during which the sequence
ran under them: the four-way sort, the forcing question, the reach law, the heredoc and
command-scope rules, the dated-work law, where-a-law-may-live, and fix-closes-a-route.
Sessions were expected to follow rules that existed on no remote.

**The three reach instances together.** A law in a file sessions are not told to open; a
withdrawal swept on a branch that had not merged; and now a plan naming a branch whose
work was never pushed. **All three look like completed work and none of them reached
anyone** — and the third is the one where the instruction not to push and the instruction
to merge came from the same place and were never checked against each other.

**Also found while re-pushing:** two paragraphs of evidence for the test-count task were
still in `CLAUDE.md` after the task itself moved to issue #112. The task moved and its
evidence did not. Removed here; the same facts are in #112.

---

## The owner's record — a signed criterion reversed without reading it, a second time (2026-10-05)

Recorded as the owner's, in his words:

> "Second time I have instructed a change that reverses a signed criterion without reading
> it first — C-11.7 on 2 October, C-16.7 on 5 October. Both were caught by the session
> checking scope-and-acceptance before implementing. The fault is designing from first
> principles without opening the signed document, and the remedy is that check, not a
> better instinct."

**The two instances.** C-11.7 (2026-10-05... 2 October): the restore-drill ownership
reading, which contradicted "under CORWADO's name" — withdrawn to a proposal. C-16.7
(5 October): "withhold stale data rather than label it," which contradicts "yesterday's
row... never a hidden tile" — recorded as a proposed amendment with a 48-hour withhold that
preserves the 26-hour label. Both reversals were sound as arguments and wrong to instruct
as changes, and both were caught the same way: the session opened `scope-and-acceptance.md`
before writing code.

**Why "a better instinct" is the wrong remedy, stated plainly.** The instinct was right
twice — both proposals are reasonable. The failure was not bad design; it was designing
from first principles against a document that already had a clause on the point, without
opening it. An instinct cannot know whether a signed criterion exists; only the check can.
So the remedy is procedural and it is already a law: open the signed document before
instructing a change to behaviour it governs. Pair with CLAUDE.md §0, which asks what the
brief assumes that has not been verified — a signed criterion on the exact point is the
first thing to verify.

**The pattern worth naming for the session, not the owner:** both catches came from the
session reading scope before implementing, which is the habit to keep. A third reversal
that reaches `main` unread is the one that would matter.

## Buyers hold accounts (2026-10-06) — supersedes "Buyers hold no account in this phase" (2026-09-09)

**Decided by the owner, who states the scope change is signed with CORWADO.**
The signed document's title and date are **not yet recorded here**: the owner
gave the instruction as "it is signed" and did not name it. Until it is named,
this entry is the owner's word, not a citation. **Owed: the reference, by the
owner — add it beneath this entry.**

What changed, in one list:

1. **A fifth principal: the buyer.** An outside organisation's purchaser, with a
   Supabase Auth account and a `buyer` row. The role is deliberately **not** in
   `ALL_ROLES`: routes that say `ALL_ROLES` mean "anyone who works for the
   programme", and adding the buyer there would have admitted buyers to every
   such route at once. A route admits a buyer by naming `BUYER_ROLE`, and
   `apps/web/tests/buyer-route-scan.test.ts` pins every route that does.
2. **Self-registration exists for buyers only** (`POST /api/buyer/register`,
   the sixth public route). Self-signup on the authentication service stays
   disabled (C-3.1): the route creates the account server-side.
3. **Individuals need no review; businesses do** (the owner, mid-build: "standard
   buyers/individual buyers shouldn't need review or verification"). An
   individual's standing is `not_required` — **never `verified`**, because nobody
   checked them — and a database CHECK keeps the two kinds' standings apart.
   An administrator can still suspend or reject an individual.
   _The cost, accepted rather than hidden:_ a business can register as an
   individual to skip review. Nothing technical prevents it.
4. **Orders and deliveries exist, payments do not.** CORWADO staff arrange an
   order against a listing at an agreed unit price; the database computes the
   total. No money moves through the system (Inception Report 5.1 still excludes
   mobile-money integration). Delivery tracking is a timeline of statuses staff
   record — there is no GPS, and nothing pretends otherwise.
5. **What a buyer may see of a farmer** — the question the 2026-09-09 entry said
   was the largest part of any wider reading — **is answered: the trading name
   the farmer published, whether the farmer is verified, and the listing's
   payam, county and state.** Never the farmer's id, legal name, phone, national
   id, the listing's contact phone or pickup notes, or any coordinate. The line
   is drawn once, as whitelisting presenters in
   `apps/web/lib/api/buyer-presenters.ts`, and proved by a test that hands them a
   row carrying every sensitive column.

**Built by Alieu-Claude across both lanes, on the owner's instruction** — the
migration, `packages/shared`, the routes and the screens. Logged in HANDOFF.md
so Monkon-Claude does not build the same thing. Criteria: C-14B in
`docs/scope-and-acceptance.md`.

**Known and unclosed:** no rate limiter on the registration route (none exists
anywhere — the product-report route says the same); an already-registered
address answers 409, which tells a stranger that the address has an account;
an applicant's email is not proven to be theirs (accounts are created
confirmed, as staff accounts are).

## Farmers enrol themselves and deal with buyers directly (2026-10-07) — amends "Buyers hold accounts" (2026-10-06) point 5 and C-14B.8

**What CORWADO told the owner, and the owner told us (2026-10-07).** CORWADO has no
funds for staff to enrol farmers: farmers register themselves, officers help the
illiterate ones case by case. Farmers upload their own produce. Buyers contact
farmers directly, with no third party and no CORWADO involvement. The owner's
answers to the three open questions: a farmer signs in with **phone and password**;
the farmer's number is given to a buyer **after the buyer sends a request**, and the
request appears on the farmer's dashboard; build it now, for the demonstration.

This is the owner's written confirmation of the farmer-facing web side that
CLAUDE.md §2 listed as unresolved, as far as this goes: a farmer account on the
existing web portal (`/farmer/*`). It is not a farmer-installed mobile app, and
nothing here builds one. — DOCUMENTED (the owner's instruction in session).

1. **A sixth principal: the farmer.** `farmer.auth_user_id` links a farmer row to
   a Supabase Auth account whose identifier is derived from the phone
   (`farmer.<digits>@farmers.invalid`, exactly as an officer's is), so every way of
   writing one number is one account. `FARMER_ROLE` is, like the buyer's, **not**
   in `ALL_ROLES`; `requireRole` resolves a farmer last, and the `farmer` scope
   sees nothing through `scopeFilter` — every farmer route reads its own rows by
   the session's farmer id (`farmerScope`).
2. **Self-registration** (`POST /api/farmer/register`, the seventh public route).
   Short on purpose: name, sex, year of birth, phone, state/county/payam, village,
   password, consent. CORWADO's paper form (sections B–F and H) is asked as an
   optional, skippable "About your farm" step and kept in `farmer_profile`.
   Section G (payments) and the photo are left out: payments are out of scope
   (Inception Report 5.1). The farmer is `pending`; verification by an officer is
   optional and shown to buyers as a badge, not a gate.
3. **A farmer's password is six characters or more** (B12 point 2, the rule the
   screen already showed). Staff keep twelve. A farmer types it on a basic phone.
4. **Listings are the farmer's own** (`/api/farmer/listings`). A listing the
   farmer marks `listed` is in the marketplace at once; a `rejected` farmer cannot
   publish.
5. **Point 5 of 2026-10-06 and C-14B.8 are amended — the phone, and only the
   phone.** Once a buyer has sent a request for a listing, that buyer is given the
   listing's contact phone (on the product page and the request), and the farmer
   is given the buyer's name, organisation and phone on their dashboard. A draft
   or cancelled request reveals nothing. The farmer's id, legal name, national id
   and coordinates are still never given. Consent text v1.2 says so, in English
   and Arabic; every farmer registering from now agrees to it.
6. **The cart.** A buyer gathers products from several farmers and sends them
   together (`POST /api/buyer/cart`, one transaction; each line becomes its own
   request to its own farmer, and each farmer is alerted). Every request now
   names a listing; the free-standing "find me maize" request is gone, because
   there is no third party to do the finding.
7. **Accepting is not an order.** The farmer accepts or declines; the buyer is
   notified. Price and handover are agreed between the two directly. Orders and
   deliveries are no longer offered in the buyer's navigation; their routes and
   tables stay, unused.

**Known and unclosed:** no rate limiter on the registration route (none exists);
an already-registered phone answers 409, which tells a stranger the number has an
account; the phone is not proven to be the registrant's (no SMS check — Bird is
not yet live).

## Staging is production: the database suite is retired (2026-10-07) — T2

Since 2026-10-06 the one Supabase project is production (the owner: "no more test
runs, we run and test locally and push to production, if there's a crash we fix
it"). The database suite creates and deletes accounts and rows, so it may not run
against it. Done by replacing the guards, not removing them: `vitest.global-setup.ts`,
`tests/helpers/principals.ts` and `scripts/db-reset.mjs` now refuse
unconditionally; `pnpm test` is the pure suite (the old command is kept as
`test:db-retired`); CI's Test step receives no database secret and always runs
`pnpm test:pure`. When a disposable database exists again, the guards are the
place to point it.

## Only the farmer answers a purchase request (2026-10-07) — amends point 7 above

The owner: "purchase requests are accepted by the farmer, not CORWADO". The
administrator's decision route (`PATCH /api/admin/purchase-requests/:id`) now
refuses every call (`request_answered_by_farmer`), and the administrator's
"Buyer requests" page is read-only: it shows what buyers asked for and how each
farmer answered, with no Decide buttons and no Orders tab. The buyer's
notification on an answer now says the farmer accepted or declined, and points
to the farmer's number on the request — it used to say CORWADO accepted and
would arrange an order.

## Farmers are verified before anything they post goes live (2026-10-07) — amends "Farmers enrol themselves" points 2 and 4

The owner: "farmers need to be approved and verified before they can post
anything". Registration stays self-service; publishing does not.

- `POST /api/farmer/listings` refuses any status but `draft`, and
  `PATCH /api/farmer/listings/:id` refuses a move to `listed`, unless the
  farmer is `verified` (new rule `farmer_not_verified`). Drafts are kept, so a
  farmer can prepare produce while waiting.
- The buyer marketplace, the cart and the public marketplace (list and detail)
  show a listing only while it is `listed` **and** its farmer is `verified`. A
  farmer who stops being verified (a verified record can only be merged) drops out of the market at once. The public
  `?farmer_id=` filter no longer returns drafts.
- Who verifies: an administrator or supervisor, from the existing review queue
  (`/farmers/review`, `POST /api/farmers/:id/verify`). No officer is needed and
  there is no other prerequisite. The farmer's screens now say CORWADO
  verifies, not an officer.

---

## The owner's record — a data-layer brief written against unread signed scope (2026-10-09)

Recorded as the owner's, in his words:

> "I wrote a brief for a new `farm_plot` table without opening the signed scope. C-7 is
> farm boundary mapping and B7 delivered it. My item 9a asserted the scope 'carries a
> single land-area field, not a boundary' — false, and asserted as a finding for you to
> act on. Fourth instance of designing against a signed document without reading it
> (C-11.7, C-16.7, the marketplace amendment, C-7). The remedy is the read-first check,
> not better instinct on my part."

**OBSERVED.** C-7 (`docs/scope-and-acceptance.md`) is "farm boundary mapping," and B7
delivered `farm_boundary`: `geography(Polygon,4326)`, `centroid`, `area_ha` (C-7.3),
`point_count ≥ 4` (C-7.2), `gps_accuracy_m` + `accuracy_flag` (C-7.4), `is_current`
versioning (C-7.5), officer `mapped_by` (C-7.6), `ST_IsValid` CHECK, GIST on boundary and
centroid, and staff-only exposure (C-7.8). The brief's `farm_plot` "at minimum" list was
~80% that table. The read-first check — open the signed scope before specifying a table —
is the only thing that catches this; it is the fourth instance of the same omission.

## The owner's record — "full staging suite green" asserted from memory (2026-10-09)

Recorded as the owner's, in his words:

> "Every brief I have written gated on 'the full staging suite green.' T2 retired the
> database suite and there is no non-production database. The gate has been unmeetable,
> because I asserted the repository's state from memory instead of asking for it."

**OBSERVED on main:** `vitest.global-setup.ts`, `assertStaging()` and `scripts/db-reset.mjs`
each throw/refuse unconditionally, and `pnpm test` is the pure suite (`test:db-retired` is
the old command). The one project is production. A gate of "staging suite green" names a
thing that no longer exists; the fix is to ask the repository its state, not recall it.

## Farm mapping — extend `farm_boundary`, do not build a second table (2026-10-09)

Owner's decision, settling branch 1's shape so it does not reopen:

- **`area_ha` stays** (not m²). A trigger deriving area from geometry closes the
  stored-figure-drifts-from-geometry risk whatever the unit; changing a shipped column's
  unit is churn. Feddans/acres remain presentation-only conversions.
- **`is_current` versioning stays; no soft delete added.** A boundary that changes between
  or within seasons versions, which B7 already does (C-7.5).
- **`farm_id` scoping stays; not re-scoped to `farmer_id`.** A boundary belongs to a farm;
  authorization reaches the caseload through the farm in one join.
- **Idempotency follows the existing client-generated-UUID pattern (C-9.1/C-5.12)** — the
  boundary id's server default was already dropped; no second mechanism.

What is genuinely additive is recorded in `docs/PROJECT-STATE.md` ("Farm mapping — what
B7 already does and what branch 1 adds").

## The disposable test project — branch 0: re-point the retired guards at a closed allowlist (2026-10-09)

Branch `chore/disposable-test-project`. T2 retired the three destructive guards
(`vitest.global-setup.ts`, `assertStaging()` in `tests/helpers/principals.ts`, and
`scripts/db-reset.mjs`) with **unconditional throws**, because the one Supabase project
is production and there was nothing safe to point them at. Branch 0 replaces each throw
with a check against one closed allowlist, `scripts/non-production-projects.mjs`.

These are the settled choices, so the branch does not reopen them:

- **The allowlist starts EMPTY, and that is the whole safety.** An empty list refuses
  every target: `db:reset` refuses, the test principals refuse, the database suite refuses
  to start — identical, observably, to T2's throws. Nothing is un-retired. The point of
  the move is that when a disposable project exists, its reference is added in **one
  deliberate line** and all three guards admit it with no edit to any of them.
- **The former staging reference is production and must never be listed.** The one project,
  `xmmxbrxmfgodhpwolrvk`, was named `agri-staging` and the guards once compared against that
  literal; since 2026-10-06 it IS production. Recovering #108's allowlist verbatim would have
  put production on the list of databases that may be destroyed — the exact inversion of the
  guard. A test (`never names the one production project`) now fails if anyone "fixes" the
  empty list by pasting the only reference they can find. The disposable project is a NEW,
  SEPARATE project; its reference — not this one — is what a future line adds.
- **The acceptance direction is proved on a pure matcher, not on the list.** A guard that
  refuses everything passes every refusal test (memory: "test guards in both directions").
  But no real reference can be named to accept — no disposable project exists, and no
  production reference may be written. So `connectionNamesListedProject(value, refs)` is
  exported and exercised with a HYPOTHETICAL list in both directions; the guards call only
  the zero-argument wrappers over the frozen committed constant, so the policy stays
  committed while the matching logic is proved both ways. This is a test-only refinement of
  #108's parameterless functions, not the runtime-valued allowlist #108's header forbids.
- **#108 is recovered, not merged.** #108 (`fix/guard-allowlist`) carried this allowlist but
  was cut before T2 and before #116, and also carried rewiring now superseded; its content is
  re-created here on a branch from current `main` rather than rebased. #108's disposition is
  the owner's to rule (open-PR triage), not decided here.

Status: NOT a migration, NOT secret-touching. `pnpm test` green (808); typecheck, lint,
format clean. What the owner must do by hand to make the database suite runnable is listed
in `docs/PROJECT-STATE.md` ("Standing up the disposable test project — the owner's steps").

## Verification after a boundary change — a view, not a state transition (2026-10-09)

Owner's ruling, settling how branch 1 behaves when a farm's boundary is re-mapped
after a supervisor has already verified that farmer or farm.

> **No behaviour change.** Re-mapping a boundary does not reset, re-open, or
> otherwise transition a verification. The verification stands.

Instead, the fact is **surfaced, not enforced**: a supervisor-facing **view** shows
that the farm's current boundary post-dates the verification it carries, so a
supervisor can look again if they judge it matters. It is a view, not a state
transition — nothing in the record moves on its own.

**Why (owner's framing).** A boundary correction is ordinary and usually benign;
making every re-map re-open a verification would turn verification into churn and
would punish fixing data. Whether a particular change matters is the supervisor's
judgement, and a passive view informs that judgement without forcing a workflow or
rewriting a signed state. The state machine stays as it is (C-7.5 versions a
boundary; this rules that versioning does not touch verification).

The view itself is a task, dated as a GitHub issue (surfacing, to a supervisor,
that the current boundary post-dates their verification). This record is the
ruling; the issue is the build.

## Password reset: buyers by email, farmers by their officer or an administrator (2026-10-09)

The owner: "buyers reset by email, farmers reset by extension officer and
admin". Recovery codes (built and tested live the same day) are removed from
every screen and route: no code at registration, no /recover page, no
"new recovery code" card.

- **Buyers (and email-signed-in staff):** "Forgot your password?" on /login
  sends a reset link (Supabase Auth through Resend SMTP, domain
  agrionesouthsudan.com verified); the link opens /reset-password.
- **Farmers:** no email, so the extension officer (own caseload), a supervisor
  (own state) or an administrator sets a new password on the farmer's page
  (POST /api/farmers/:id/sign-in). The farmer sign-in page says so.

The `account_recovery` table (migration 20261009090000) stays, unused: dropping
a table is a change the owner decides, and it holds only hashes of test codes.

## Farmers and extension officers work offline through a PWA, Android only (2026-10-10)

The owner: "i need implementation, let's start with farmers and extension
officers" and "no iphone, only android". The web app becomes an installable
Progressive Web App that works without signal and synchronises when it returns,
instead of (for now) the separate Flutter officer app in CLAUDE.md §3. That
row is not changed here: whether the PWA replaces the Flutter app for good is
the owner's and CORWADO's call; this records what is being built.

- **Two new libraries, approved by the owner with the plan:** Serwist
  (`@serwist/next`, `serwist`) for the service worker, Dexie for the on-phone
  database (IndexedDB).
- **Step 1 (this change): installable and opens offline.** Manifest, icons,
  `/open` (sends each role home; offline, the last home used), `/offline`, a
  no-signal strip and an "Install AgriOne" button. The service worker keeps
  the app's own files only: **every `/api/` call and every request to Supabase
  is network-only**, so no account's data is ever kept in a cache another
  account on the phone could see.
- **Next steps, each its own change:** (2) an outbox + sync engine on the C-9
  contract already in `packages/shared/src/sync.ts` — client-generated ids,
  one record per request, removed only on acknowledgement, a reason kept on
  failure; (3) farmers offline — their listings and buyer requests on the
  phone, post/edit produce and accept/decline queued; (4) officers offline —
  caseload on the phone, register farmers, visits with photos, GPS mapping.
- Android Chrome is the target: Background Sync is available there; nothing
  is built for iPhone.

**Final (2026-10-10, the owner): "pwa is the final".** The PWA replaces the
Flutter officer app for good; no Flutter app will be built. CLAUDE.md §3's
row now names the PWA. What followed from it:

- There is no second client with its own copy of the rules. The rule in
  CONVENTIONS §8 that a Dart check must be kept in step with every Zod rule
  is withdrawn: the phone and the portal run the same `packages/shared` code.
- The `apps/mobile` placeholder is removed.
- Bearer-token access stays (CONVENTIONS §1): every route still accepts
  either credential, for scripts and for any future client.

## AgriOne AI replaces the learning library on the farmer's dashboard (2026-10-17)

The owner, in writing: "i need to add a chatbot to replace the learning area
in the farmers dashboard", then, asked, approved it over the CLAUDE.md hold on
"Ask AI" ("Yes, approved"), chose Claude ("use haiku 5.5, i have claude api
credits") and named it ("name the Agrione AI").

- **Provider and model:** Anthropic, Claude Haiku 5.5 (`claude-haiku-5-5`),
  through the official SDK `@anthropic-ai/sdk` (a new dependency, approved with
  the provider). Effort `low` for chat. Key: `ANTHROPIC_API_KEY`, server-only.
- **Careful mode (owner's choice):** farming, livestock, markets and AgriOne
  only; says when unsure; never exact pesticide, herbicide or veterinary
  doses; the extension officer for anything serious; no invented prices
  (points to Market prices). In the farmer's language (English or Arabic).
- **Privacy:** the conversation stays on the farmer's phone (per account,
  cleared at sign-out). The server stores no question or answer -- only a
  count of questions per farmer per day (`assistant_usage`, migration 20261017090000) for a daily cap of 30, so a loop or a shared phone cannot
  run up the bill. Context sent with a question: first name, payam, county,
  state, crops and land size -- never phone, ID or contact details.
- **Learning library:** removed from the farmer's dashboard only ("Remove the
  library"). It is a contracted deliverable and stays managed by staff; the
  farmer's old Learn address now opens AgriOne AI.
- **Offline:** asking needs signal; earlier answers stay readable offline.

## AgriOne AI takes photos (2026-10-17)

The owner, asked whether farmers should send photos to AgriOne AI and told it
falls under "AI disease detection" on the not-in-scope list: "build it". So
this is an owner's exception to that line, recorded in CLAUDE.md §2. CORWADO
did not sign for it; the owner may want to tell them.

- One photo per question, on the newest question only; earlier photos are
  never sent again. JPEG, PNG or WebP, at most ~450 KB (`ASSISTANT_LIMITS`).
- Shrunk on the phone to about 1024 pixels before sending, so it uploads on a
  weak signal; a 240-pixel thumbnail stays in the conversation on the phone.
- Never stored on the server; passed to Claude for that one answer.
- The prompt: describe what is visible, give the likely causes as
  possibilities never a diagnosis, say when the photo is unclear, never
  comment on people, and always end with the extension officer to confirm.
  No doses, as before. Counts as one of the 30 daily questions.
- OBSERVED with Claude Haiku 5.5 on a market photo of maize: it described the
  scene, noticed it was a display rather than a field, claimed no problem it
  could not see, asked for a closer daylight photo, and referred to the
  extension officer, in English and Arabic. About 1,400 input tokens a photo.

## CORWADO's 16 October specification: independent participation (2026-10-19)

CORWADO's "Developer Handover Specification" (16 October 2026, with eight
infographics; no. 6, organisational profiles and team access, was missing from
the package received) asks that "ordinary participation must not depend on
project staff, agent assignment or CORWADO approval". The owner accepted the
build plan and, with it, these decisions ("use 2 agents, go"):

- **#127 reversed:** a farmer's listings go live without staff verification.
  Verification stays, as an optional "Verified farmer" badge.
- **"Option A" reversed:** one account both buys and sells. A farmer starts
  buying from their own account (`POST /api/farmer/buying`) and a buyer starts
  selling from theirs (`POST /api/buyer/selling`), with no second sign-up or
  password. `requireRole` meets the account as a buyer on buyer routes and as
  a farmer on farmer routes; a route that admits both takes the first of its
  own roles the account holds (`accountSideFor`).
- **Phone verification by SMS code at farmer sign-up:** 6 digits, 10 minutes,
  5 tries, 3 codes per phone per 30 minutes, a minute between sends, at most
  200 codes an hour system-wide, through Bird (about 0.20 EUR a code from
  CORWADO's credit). On whenever Bird is configured; setting
  `FARMER_PHONE_VERIFICATION=off` switches it off, so sign-up never depends
  on an SMS a network does not deliver (only MTN delivery is OBSERVED so far).
- **Defaults accepted, to be revisited with CORWADO:** listings valid 30 days
  by default; existing separate farmer and buyer accounts stay as they are.
- **Built in parallel lanes:** accounts (this entry), listings (statuses,
  public buying requests, services) and staff permissions (Super Admin, roles,
  access logs), each on its own branch.

## Listings: no verification gate, one lifecycle, buying requests and services (2026-10-19) — replaces "Farmers are verified before anything they post goes live" (2026-10-07)

The owner, from CORWADO's specification of 16 October 2026. Branch
`feat/listings-lifecycle`.

1. **#127 dropped.** A farmer's listing goes live without staff verification.
   The `farmer_not_verified` gate is gone from `POST`/`PATCH
/api/farmer/listings`, and no market read filters on
   `f.verification_status = 'verified'` any more (public list and detail, the
   buyer marketplace, cart, purchase requests, admin orders, summary — all via
   `MARKET_BASE_WHERE`). Verification is a **"Verified farmer" badge**:
   `farmer_verified` on `/api/listings`, `supplier.verified` for buyers,
   `farmer_verified` on services, `poster_verified` on buying requests. Shown
   only, never filtered on: the market's "verified sellers only" box and the
   buyer's "Verified farmers only" select are removed (`supplier=verified` is
   still accepted so an old link does not break, and narrows nothing). The
   `farmer_not_verified` rule sentence stays in the registry, unused.
2. **One lifecycle** for produce, buying requests and services: draft, active,
   paused, expired, withdrawn, completed. An edit is an event, not a status.
   - Produce keeps its stored words: `listed` is active, the legacy `sold`
     reads as completed and is written as `completed` from now on.
     `listing_status` gains `paused` and `completed` (ADD VALUE, nothing
     renamed). Buying requests and services store the canonical words.
   - **Expired is computed**, never stored: active with its end date
     (`available_until`, or `needed_by`) before today. Renew = a new date.
   - Moves (`canMove`, packages/shared/src/market-posts.ts): draft → active |
     withdrawn; active → paused | withdrawn | completed; paused → active |
     withdrawn | completed. **Withdrawn and completed are final** — a listing
     staff took down can no longer be relisted by its owner. An unchanged
     status is not a move, so the phone's full-listing saves keep working.
   - Going live, or renewing, needs an end date from today. **No end date →
     30 days** (from the later of the start date and today), on create and on
     publish.
   - **A sale** (`POST /api/farmer/listings/:id/sales`) adds to the new
     `quantity_sold`; what is left is `quantity - quantity_sold` and is what the
     market shows and what requests/orders are checked against. Nothing left,
     or `close: true`, completes the listing. The total cannot be edited below
     what is sold. A sale is not idempotent, so it is never queued offline.
   - Staff withdrawal (`/api/listings/:id/withdraw`) now also takes a paused
     listing.
3. **Buying requests** (`buying_request`): "I need X of Y in Z by date", with
   optional price/negotiable and delivery terms. Posted by any signed-in farmer
   or buyer; `poster_type` + `farmer_id | buyer_id` come from the session
   (`marketPoster`, the one place to change when accounts merge). Public list
   with search and filters (q, category, state, poster); public detail. The
   poster's phone is never public: `/contact` gives it to a signed-in farmer or
   buyer. Not `purchase_request`, which is unchanged.
4. **Service listings** (`service_listing`): tractor hire, transport,
   processing, storage, other; description, general location, availability,
   price or negotiable. Farmer-owned for now; same lifecycle, no stock.
5. **Reports** on both, through the product-report mechanism: same body, same
   digest-refuses-repeat (not a rate limiter), stored in a new `market_report`
   table (product_report.listing_id is NOT NULL to produce_listing; widening it
   would change a constraint). Administrator queue: `/api/admin/market-reports`
   with the product-report state machine; "remove" is soft.
6. **No new audit actions**: `listing.created|updated|status_changed` with
   `entity_type` buying_request / service_listing, `product_report.*` with
   `entity_type` market_report. So no CHECK rebuild, and nothing to collide
   with another lane's.
7. Farmers may now read `/api/locations` (to choose a request's state).

Migrations 20261019100000 (lifecycle) and 20261019101000 (tables) are written,
NOT applied. **Apply them before deploying this code**: the code reads
`quantity_sold` and the new tables, and would fail without them.

## Staff permissions, Super Admin and access logs (2026-10-19)

CORWADO's specification of 16 October 2026, the administration part. Built as
an ADDITIVE layer: the four staff roles, sign-in and requireRole are unchanged.
Branch `feat/staff-permissions`; migrations 20261019110000 and 20261019110100,
NOT applied by the session that wrote them.

- **Presets and keys.** Super Admin (every key), Administrator (`staff.manage`,
  `settings.manage`, `audit.view`, `reports.view`), Moderator + Editor
  (`content.moderate`, `content.publish`), Analyst (`reports.view`), Support
  (`support.handle`). `superadmin.grant` and `exports.identifiable` are in Super
  Admin only, so platform-wide moderation never implies Super Admin, security
  changes or sensitive exports (a test asserts it). Each grant is platform-wide
  or for named states; one person may hold several presets.
- **The legacy rule** (SUPERSEDED 2026-10-30: presets are binding, see that
  entry). An existing `admin` holds every key except
  `superadmin.grant`, platform-wide, with no grant row, so nothing that works
  today stops working. DECIDED HERE, OPEN TO THE OWNER: this stays true after
  a Super Admin exists (the brief's "until a Super Admin exists" was read as
  describing the bootstrap). If administrators should lose the implicit keys
  once a Super Admin exists, it is one constant in packages/shared.
- **Enforced in the service.** `requirePermission(auth, key, scope?)`
  (apps/web/lib/api/permissions.ts) runs in every new route after requireRole;
  scope omitted means the whole platform. Existing routes were NOT retrofitted.
- **Super Admin delegation.** Needs the granter's own password, verified on the
  server by a password sign-in on a throwaway client (no cookie, no session
  change, the new session signed out at once, nothing logged), plus an explicit
  confirmation. Only an `admin` account can be a Super Admin.
- **Bootstrap.** While no Super Admin exists, an administrator may appoint
  THEMSELVES (only themselves), with the same re-authentication. An advisory
  lock makes two simultaneous bootstraps queue; the second is refused.
- **The last active Super Admin** cannot be revoked, removed (DELETE
  /api/users/[id]) or demoted (PATCH role) -- the one change made to an existing
  route, inside its transaction, and a no-op until the migration is applied.
- **MFA (TOTP): partly.** If the granter has a VERIFIED Supabase TOTP factor, a
  six-digit code is required and verified at the grant step. Enrolment is NOT
  built: it needs a screen that enrols through the user's own Supabase session,
  which is the sign-in client this pass was told not to change. Until it is, no
  account has a factor and the step is password plus confirmation. Open.
- **Revoke sessions.** supabase-js has no admin "sign out by id"; its admin
  `signOut` needs one of the user's own tokens. So the server mints one
  (admin `generateLink` magic link, nothing sent; `verifyOtp`) and calls
  `signOut(token, 'global')`. Each step is DOCUMENTED by Supabase; the chain is
  INFERRED and NOT EXERCISED (there is only production). Side effect: the
  account's Supabase `last_sign_in_at` moves. Audited with its outcome.
- **Access logs.** `access_log` (append-only by trigger, RLS on, no policies)
  holds account kind and application id, event, UTC time and at most a
  platform-family device label -- no IP address, no user agent. Events:
  `account_created` (database trigger on user, officer, buyer and farmer-with-
  account inserts, never able to fail the insert; existing accounts back-filled
  from `created_at`), `first_sign_in`, `sign_in`, `return_session` (an
  authenticated visit after more than 30 minutes idle,
  `RETURN_SESSION_INACTIVITY_MS`), `reauth_failed`. Last activity is
  `account_activity.last_seen_at`. Displayed in Africa/Juba time.
- **Where visits are seen, and the gaps.** GET /api/me (portal load; the staff
  and buyer sign-in screen calls it straight after signing in, now with an
  `x-agri-sign-in: 1` header so the visit is logged as a sign-in) and GET
  /api/farmer/me (farmers; no announce header, so a farmer's later sign-ins
  appear as return sessions). Every sign-in is client-side Supabase, so a
  FAILED sign-in is never seen by a server and is not logged; only a failed
  re-authentication is. "Last activity" moves only when those routes are
  called, i.e. on a full page load, not on in-app navigation -- a heartbeat or
  a hook in the route wrapper would close that; not done, open. The first
  visit after this ships is logged as `first_sign_in` for accounts that signed
  in long before: it means the first one the log saw.
- **Retention: OPEN DECISION.** Nothing expires access-log rows and the trigger
  forbids deleting them. CORWADO should set a period (e.g. 12 or 24 months);
  enforcing it would need a deliberate, logged purge mechanism.

## In-app messaging (2026-10-20)

CORWADO's 16 October specification: "protect private contacts through in-app
messaging and deliberate public contact choices". The owner decided, 2026-10-19:

- **Who can start a chat: about a post.** Any signed-in farmer or buyer account
  can message the owner of a produce listing, a buying request or a service
  that is on the market, from that post. Nobody can message a person cold. One
  conversation per post per other person; asking again reopens it.
- **Phone numbers: only if the seller chooses.** Messaging is the default way
  to reach someone. The "Show my phone number" choice per post, and consent
  text v1.3, are the second pull request; until it lands, the existing
  contact buttons behave as before.

Built (migration `20261020090000_messaging`, additive):

- Conversations belong to **sign-ins**, not farmer or buyer records, so an
  account that buys and sells has one inbox (#178).
- **Staff cannot read chats.** The routes admit farmer and buyer only; there is
  no staff read path. Problems reach staff through reports. INFERRED to be
  what the specification's privacy line asks; CORWADO has not said whether
  moderators should ever see a reported conversation -- OPEN.
- **No message text outside the conversation.** Audit rows
  (`conversation.started`, `message.sent`, `conversation.blocked`) carry ids
  only; no notification is written -- the Messages badge is the notice. The
  read mark (a time on the conversation) is not audited: it changes on every
  visit and records no one's data.
- **Names:** the post's market name for its owner; "Given F." (and a buyer's
  organisation) for the person who writes. Never a phone, never a full name.
- **Limits:** 2,000 characters a message; 20 new conversations per account
  per day (replies are not limited).
- **Offline:** replies go through the phone's outbox with an id made on the
  phone, so a resend is stored once. Starting a conversation needs signal
  (the answer, and any refusal, has to be read at once). Reading needs signal.
- **Delivery is polling**, every 5 seconds while a chat is open and every
  minute for the badge -- no realtime connection, which keeps database load
  and cost flat. Size: a message is well under 1 KB.
- **Close conversation:** either person can; no more messages either way, what
  was said stays. No unblock yet.
- **Retention: OPEN DECISION.** Messages are kept until CORWADO sets a period.

## Phone numbers only if the poster chooses; consent text v1.3 (2026-10-20)

The owner, 2026-10-19: "Only if the seller chooses". The second half of
"In-app messaging" above.

- **One choice per post:** "Show my phone number" on a buying request or a
  service; "Give my phone number to buyers who send a request" on a produce
  listing. **Off unless ticked** for anything posted from now on; the poster
  can change it on any post.
- **Existing posts keep their phone (true).** Deals already under way were
  promised the number under consent text v1.2; switching them off silently
  would break that. INFERRED to be what the owner wants -- they can ask for
  existing posts to be switched off, which is one UPDATE and their decision.
- **Where it is enforced (the server, not the screen):** the contact routes
  of buying requests and services return no number when the poster said no;
  a buyer's product page and their sent purchase requests carry the farmer's
  number only when the listing allows it. Public pages carry a yes/no
  (`phone_shared`, `phone_on_request`), never the number. Staff screens read
  the same purchase-request columns, so the procurement view also shows no
  number for such a listing.
- **Unchanged:** a buyer who sends a purchase request still gives their own
  phone to the farmer -- sending it is the deliberate choice -- and v1.3 says
  so. The visitor contact form (a visitor leaves a phone for an officer) is
  unchanged.
- **Consent text v1.3** (English and Arabic; farmer sign-up and "Start
  selling"): people reach you through messages in the app; your number is on
  a post only if you choose; your number goes to the seller when you send a
  buyer request; messages are seen only by the two people in them. The
  officer-assisted registration still records v1.0, the text officers read
  out; bringing it to v1.3 is CORWADO's call -- OPEN.

Migration `20261020120000_post_show_phone` (additive): a `show_phone` column on
`produce_listing`, `buying_request` and `service_listing`; the three `_active`
views recreated so they carry it.

## Public profiles, reached through a post (2026-10-20)

CORWADO's 16 October specification asks for public profiles. The owner,
2026-10-20: a profile shows the name, place, badge and posts.

- **The address is a post, not an account:** `/market/profile/<kind>/<post
id>`, from "See profile" beside the poster's name on a listing, a buying
  request or a service. No farmer, buyer or sign-in id is printed or accepted,
  and a post that is not on the market leads nowhere (404), so a draft or a
  removed account cannot be found through one. No migration: nothing new is
  stored.
- **What it shows, a whitelist** (`GET /api/profiles/:kind/:id`, public,
  read-only): the post's market name; payam and state for a farmer, the
  organisation's state for a buyer; the Verified badge; the month they joined;
  "who you are, what you do" if answered; their listings, buying requests and
  services on the market now, through the same public presenters the market
  uses. Never a phone or a legal name. One account that buys and sells shows
  both sides' posts.
- **Name:** the name on the post that led there. A farmer may trade under
  different names on different listings; the profile does not merge or
  reveal them beyond the posts themselves, which are public anyway.

## Delete my account: hide now, keep for audit (2026-10-20)

CORWADO's 16 October specification asks for account deletion. The owner,
2026-10-20: hide now, keep for audit (the soft-delete law), not erase.

- **Who:** a farmer or buyer account, for itself only, from Login & security
  (farmer) or Profile (buyer), with its own password and a tick box. The
  password is checked like Super Admin delegation (a throwaway sign-in; never
  kept); a wrong one is logged in the access log. Staff accounts cannot use it.
- **What happens, in one transaction:** live listings, buying requests and
  services are withdrawn; every conversation is closed and the account's name
  in it becomes "Former member" (what was said stays for the other person);
  the farmer and buyer records are soft-deleted, so they leave every list,
  count, export, report and the market. Then the sign-in is disabled
  (banned), ending sessions on other phones. If Supabase does not answer, the
  records are still deleted and every route refuses the account; the answer
  says the ban did not happen.
- **Audit:** `farmer.soft_deleted` and the new `buyer.soft_deleted`
  (migration `20261020150000`, CHECK 88 → 89), each carrying how many posts
  were withdrawn and conversations closed -- one row per record, not one per
  post, which is a deliberate reading of "every update is audited" for a
  single act; the posts' own rows show `withdrawn`.
- **Not touched:** purchase requests and orders already in progress (the other
  side keeps its record of them); the "who you are" answers (unreachable once
  the posts are gone).
- **Coming back:** the phone and sign-in stay with the deleted record, so the
  same phone cannot sign up again; restoring an account is CORWADO's, by hand,
  for now -- OPEN whether to build a restore for staff.

## Staff suspend and restore an account (2026-10-21)

CORWADO's 16 October specification, "Reports and support". The owner,
2026-10-20: suspend an account (report queues and taking a post down already
existed).

- **Who:** administrators holding "Moderate content and listings"
  (`content.moderate`; the moderator/editor preset and plain administrators
  today). With a reason of at least five characters, kept in the audit trail.
  From a farmer's record and from the buyer list.
- **What a suspension is:** the ACCOUNT's -- one sign-in holding a farmer and
  a buyer record is suspended (and restored) as a whole. The records carry
  `suspended_at`, the reason and who did it (migration `20261021090000`); the
  sign-in is banned, ending sessions on every phone; every request from the
  account is refused (requireRole); nothing it posted is on the market, nor
  reachable by messaging or a profile (the market's joins). Its posts keep
  their own status, so restoring brings them back as they were.
- **What it is not:** a removal. The farmer stays on the register and, if
  verified, in reach figures; a buyer's past purchase requests and orders are
  untouched. A suspended person trying to sign in is told the account is
  suspended or closed and to contact CORWADO.
- **Audit:** `account.suspended` and `account.restored`, one row per record
  (CHECK 89 → 91). Enforced by filters in SQL text, so
  `apps/web/tests/suspension-scan.test.ts` reads that SQL and fails if a market
  join or the session lookup loses the filter.
- **Not built:** restoring a self-deleted account (still by hand); a notice
  to the account saying why (it cannot sign in to read one) -- an SMS on
  suspension is possible later with Bird, OPEN.

## Contact CORWADO (2026-10-21)

The owner's choice: "A help page with FAQs and a short message form; staff see
messages in a list and mark them done. No tickets, assignment or SLAs."
Helpdesk ticketing stays out of scope (CLAUDE.md section 2); this is a form,
not a helpdesk.

- **Who:** anyone, at `/help` (public; linked from the farmer account menu and
  the buyer menu). A signed-in farmer or buyer is recognised from the session;
  anyone else is a visitor and must leave a phone or an email. A signed-in
  sender who leaves no phone is answered on their own record's phone.
- **Staff:** administrators (and `support.handle`) see the messages at
  Reports and support → Support messages, newest first, new or done, and mark
  one done. Done is terminal. No replies, assignment, threads or deadlines.
- **Brake:** five messages a day per sender, counted in the database -- per
  sign-in, or per a one-way hash of the connection for a visitor. For
  visitors that is a courtesy, not a control: the header is spoofable, the
  same exposure as product reports.
- **Audit:** `support_message.created` and `support_message.done`, ids, sender
  kind and topic only, never the text, name, phone or email (migration
  `20261021100000`).

## Buy from any product page; organisations buy without waiting for verification (2026-10-21) — replaces B13's "a new organisation can look but not buy"

The owner, 2026-10-21, after "add to cart is not in every (seller/buyer)
account": Add to cart for every signed-in account, and remove the buyer
organisation verification gate (CORWADO's 16 October specification: "ordinary
participation must not depend on CORWADO approval").

- **Buy on the market's product page** (`/market/<id>`), which is where
  profiles, messages and farmers land: an account that already buys goes to
  the buyer product page, where the one cart is; a farmer who has never bought
  has their buying side switched on first (`POST /api/farmer/buying`, which is
  idempotent) and goes there too; a visitor is sent to sign in or create an
  account; staff see nothing.
- **A cart with products from several sellers** is unchanged: sent in one
  transaction, it becomes one purchase request per product, each to the farmer
  who listed it, each answered by that farmer independently.
- **Organisations:** `buyerCapabilities` now lets `pending` and
  `under_review` organisations send requests; verification is a badge, as for
  farmers since #180. `rejected` and `suspended` still cannot. The screens'
  "wait for approval" sentences and the `buyer_not_verified` rule sentence
  were reworded for the accounts that can still meet them.
- **New refusal:** a cart line for the buyer's own listing ("This is your own
  product."), now possible because every farmer can buy.

## Advice: find a provider and ask (2026-10-22)

CORWADO's 16 October specification, "Independent Advice and Knowledge
Services", "Independent knowledge providers" and "Support and advisory
outcomes". Part 1 of the advice work; the approved-adviser pathway is later.

- **Who offers advice:** any signed-in farmer or buyer account, by publishing
  an advice profile (Offer advice): name, kind (independent adviser,
  institute, research or training body, advisory organisation, other), what
  they advise on (the shared ADVICE_TOPICS list, which Advice & Learning will
  use too), languages, states covered (none = anywhere), remote or in person,
  availability, free/paid terms in words, and any commercial interest ("I sell
  seed"). One profile per account. **No CORWADO approval to publish**; the
  directory and the profile page say that being listed is not an endorsement,
  and that nobody has to buy anything to get advice. Payments are out of scope:
  terms are text only. A deleted or suspended account's profile leaves the
  directory and takes no requests.
- **Who asks:** any signed-in farmer or buyer account, choosing the provider
  from the public directory (search; filters by topic, language, location,
  remote/in person). Nothing is assigned or ranked. A request is a topic, the
  question, how to be reached (in the app, phone, SMS) and a "share selected
  details" box that is **unticked by default**; ticked, the provider sees the
  requester's general place, and their phone only if they asked to be called
  or texted -- a call or SMS cannot be chosen without the tick. Not your own
  profile; ten requests a day per account; idempotent on a phone-made id.
- **Private to two people:** a case is readable by its requester and the
  provider's account only (404 to anyone else). Staff have no read path, as
  with messaging. Each case gets its own conversation -- the in-app messaging
  table, `post_kind` 'advice_case', owned by the provider, started by the
  requester -- whose first message is the question, so replies, unread badges,
  the offline outbox and "close conversation" all come for free. Only the
  advice route can create one; POST /api/conversations still refuses it.
- **Outcomes:** open -> in progress (the provider takes it up) -> closed with
  an outcome. The requester closes as resolved, closed unresolved or
  cancelled; the provider as referred or closed unresolved. Once closed, the
  requester may rate it 1 to 5 with an optional comment, once. The screens say
  that a response is not guaranteed and that advice is not evidence of a
  better yield or income. "Report a concern" is words for now (no help page).
- **Audit:** `advice_provider.saved`, `advice_case.created`,
  `advice_case.status_changed`, `advice_case.closed`, `advice_case.feedback`
  -- ids, statuses, the rating and changed field NAMES only, never a question,
  a message or a comment. **The database CHECK for these keys is not in this
  branch's migration** (`20261022090000_advice_requests`): three branches
  change it at once and one combined CHECK migration is to be written when
  they meet. Until then `audit-check-matches-migrations` fails here by design,
  and the advice routes cannot write in a database without that migration.
- **OPEN:** whether messages may still be sent once a case is closed (today
  they may; either side can close the conversation); referral to another
  provider is an outcome only, with no hand-over of the case; notifications
  for new requests and status changes (the unread badge is the notice for now).

## Advice & Learning: draft, review, publish (2026-10-22)

CORWADO's 16 October specification: "Advice and Learning: Draft, review and
publication workflow; translations, media, topics and advisory requests.
Publishing authority is separately assignable." and "Public visitors can
browse published listings and advice."

- **On the existing library, not beside it.** `learning_resource` (migration 6) gains a status -- draft, in review, published, unpublished -- the shared
  advice topics (`ADVICE_TOPICS`, one list with advice providers and advice
  requests), an Arabic title and summary beside the English ones, and who
  submitted, reviewed and published it and when (migration
  `20261022100000_learning_workflow`, additive). Guides published before today
  are `published`, so nothing disappears; unpublished ones are drafts; the old
  single topic is mapped onto the advice topics. The old `published` flag
  stays and a CHECK keeps it equal to `status = 'published'`.
- **Still a library of guides, not courses.** No enrolment, progress, quizzes
  or certificates (CLAUDE.md section 2).
- **The moves.** Submit (draft or unpublished -> in review); return to draft,
  with a note of at least five characters (in review -> draft); publish (in
  review or unpublished -> published); unpublish (published -> unpublished).
  A draft cannot be published without passing review. Each move is its own
  audit row: `learning_resource.submitted`, `.returned`, `.published`
  (existing key), `.unpublished`. The audit CHECK is not rebuilt on this
  branch; one combined CHECK migration follows when the branches adding keys
  land.
- **Who.** Writing drafts and submitting: an administrator holding "Moderate
  content and listings" or "Publish content". Returning, publishing and
  unpublishing: "Publish content" only -- publishing authority is separately
  assignable. A guide in review or published can be edited or removed only by
  someone who can publish, so public text never changes without that
  authority. Today every administrator holds both (the legacy rule).
- **The card no longer carries `published`.** Going public is the publish
  move; a field that set it would bypass the authority.
- **Public.** `/learn` lists published guides with topic, language and search
  filters, and a guide page, in English or Arabic from the reader's language
  (Arabic title and summary where translated, English said so where not).
  Reachable without an account under the marketplace's rule
  (NEXT_PUBLIC_MARKET_OPEN). Three read-only public routes: `GET /api/guides`,
  `/api/guides/:id`, `/api/guides/:id/file`, through a whitelist (no storage
  path, staff names or ids, status or note). The file is served as visit
  attachments are: a private bucket (`learning-resources`, added to
  `pnpm storage:buckets`) and a read link that expires in ten minutes.
- **AgriOne AI is unchanged.** The library left the farmer's dashboard on
  2026-10-17 in favour of AgriOne AI; that stands. The farmer's account menu
  gains "Guides", pointing at the public page, beside AgriOne AI -- the
  client's new requirement, not a reversal. `/farmer/account/learn` still
  redirects to the assistant.
- **OPEN:** whether someone may publish their own submission. Allowed for now
  (both people are recorded: the submitter on the card, the publisher as the
  actor of the publish row); a "not your own" rule needs a second publisher
  to exist first.
- **OPEN:** uploading the file from the portal. The library has never had an
  upload (the form records a storage path and size); files reach the bucket by
  hand until it does. "Advisory requests" are another lane's.

## Analytics: definitions first, Excel without charts for now (2026-10-22)

The owner, 2026-10-22, on CORWADO's 16 October specification, "Measures and
exports": build account, activity and marketplace analytics now; advice usage
and case outcomes later, when advice exists.

- **Definitions first.** Every figure is declared once, as data, in
  `packages/shared/src/analytics.ts`: what it counts and in which unit
  (people, accounts, profiles, records, events, phones), its denominator, its
  table, its window and how a state filter applies. The `/analytics` page, the
  Excel Definitions sheet and the tests read that one list, and a test holds
  it equal to the list of queries. Buying requests, purchase requests,
  messages, contact requests, orders, recorded sales and delivered orders are
  separate figures and are never added together.
- **Window:** Juba calendar days, both ends included; the last 30 days by
  default, at most 366. **Scope:** a supervisor or read-only user sees their
  state; every caller needs `reports.view` (administrators hold it; others
  through the Analyst or Administrator preset), and the permission narrows the
  role, never widens it. Figures whose rows carry no state (phone sign-up
  codes, support messages, recorded failures) are national only.
- **Completed trades** are two figures: sales a farmer recorded against a
  listing (self-reported, read from the `produce_listing` audit rows carrying
  `sale_quantity`) and purchase orders marked delivered or completed
  (confirmed). **Verified farmers** read `farmer_verified_v`; rejected and
  pending are separate figures.
- **Excel without a dependency:** a small writer of our own
  (`apps/web/lib/analytics/xlsx.ts`, STORED ZIP entries, inline strings),
  tested by reading its bytes back. The workbook carries the numbers and the
  definitions; **editable charts come later**. PDF is the browser's print of
  a print-styled page (title, window, filters, legend, generation time in
  Juba, limitations).
- **Every export is recorded** before the file leaves: an
  `analytics.exported` audit row with the filters, scope, cut-off, the row
  count of each sheet and every query as it ran. The reports export table was
  not reused: its type CHECK admits only `summary` and `farmers`. The new key
  is NOT in the database CHECK yet -- one combined CHECK migration will add it
  -- so until then an export is refused rather than unlogged.
- **Not measurable today:** sync rejections (kept on the phone with their
  reason code, never sent to the server), failed exports and page loads, and
  sign-in history from before the access log was switched on.

## Public profiles v2: drafts, publishing, photo (2026-10-23)

CORWADO's 16 October specification: "Public profiles remain drafts until
previewed and deliberately published ... Public visibility does not constitute
endorsement", drawn in the client's profile infographic (create and publish,
public view, owner view, staff view). The owner's decisions:

- **One profile per account, a draft until its owner publishes it.** It lives
  on `account_profile` (one row per sign-in, so the farmer and buyer sides of
  one account share it). Saving never publishes; Publish is a separate step
  after a preview, and Unpublish keeps the profile to publish again.
  **Existing profiles start as drafts** -- the migration makes nothing public.
- **No staff pre-approval.** Publication is the owner's confirmation, and the
  screens say a public profile is not an endorsement. Staff moderate
  afterwards: a visitor can report a profile (the market-report mechanism,
  target `profile`), and staff with "Moderate content and listings" see the
  profile's status and photo beside Suspend/Restore and can remove the photo
  with a reason (`profile.photo_removed_by_staff`). Staff never edit or
  publish a profile.
- **Public only while the account is live.** A profile is shown only when it
  is published AND some farmer or buyer record of its sign-in is not removed
  or suspended (and none is suspended). Suspension and deletion therefore take
  it down without touching its row. Its public address is its own
  `public_id`, never a sign-in id; drafts are the house 404.
- **The photo is optional.** Without one the profile shows initials. It is
  shrunk on the phone to 800 px JPEG, uploaded straight to a PRIVATE bucket
  (`profile-photos`, 2 MB, JPEG/PNG/WebP) on a grant for one path under the
  public id, checked at confirm against the provider's own size and type, and
  shown through a read link that expires -- the visit-attachment mechanism.
  Removing it clears the column (the record stays) and removes the object.
- **The phone is shown only to signed-in users**, and only when the owner
  turns "Show phone number publicly" on (off by default) -- never to an
  anonymous visitor, the line the contact routes already drew.
- **"Allow in-app messaging"** (on by default). Off: the Message buttons on
  that owner's posts and profile are hidden and a new conversation is refused
  (`conversation_owner_no_messages`); one already started goes on. Messages
  stay about a post: the profile's Message button first asks which post.
- **The post-based profile (#188) stays.** When the owner has a published
  profile it hands over to it; otherwise it shows only the market name and
  posts, as before. Nothing of an unpublished profile leaves the server.
- **Audit:** `profile.saved` (the NAMES of changed fields, never the text),
  `profile.published`, `profile.unpublished`, `profile.photo_changed`,
  `profile.photo_removed`, `profile.photo_removed_by_staff`. They are NOT in
  the database CHECK yet -- one combined CHECK migration adds them -- so until
  it lands every profile write is refused rather than unlogged.

## Approved advisers: optional, reviewed, revocable (2026-10-24)

Independent advice, part 2: CORWADO's 16 October specification ("An existing
user applies with specialties, service area, languages, experience,
qualifications and affiliation. An authorized administrator requests
clarification, approves or declines with a recorded reason."). Migration
`20261024090000_adviser_approval`.

- **Optional and separate.** Anyone with an advice profile can still publish it
  and take requests with no review (part 1). Applying adds nothing and removes
  nothing while under review or after a decline: buying, selling, the advice
  profile and its requests all go on as before. Only approval grants anything,
  and what it grants is the "Approved adviser" badge on the provider's public
  profile and cards, and the directory's "Approved advisers only" filter.
- **The application** lives on `adviser_application` (one row per attempt, so
  history is kept): specialties, service area (states; none = anywhere),
  languages, experience, optional qualifications and affiliation, and two
  acknowledgements that start UNTICKED and must be ticked (the schema accepts
  only `true`, the database CHECKs it). One open application per provider
  (partial unique index); none while already approved.
- **The life of an application.** Submitted -> clarification requested (staff
  ask a question) -> submitted again (the applicant answers); approved or
  declined from either open status; withdrawn by the applicant from either;
  revoked by staff from approved. Declined, withdrawn and revoked are final for
  that application; the provider may apply again.
- **Who decides.** Administrators holding `content.moderate` ("Moderate content
  and listings") -- the permission that already decides account suspension.
  Reviewing what a user submitted and taking a standing away again is
  moderation; `content.publish` is CORWADO publishing its own content. Every
  decision needs a reason (5-1000 characters): for a clarification the reason
  IS the question the applicant sees; for the rest it is recorded on the
  application and shown to the applicant. A staff member may not decide on an
  application from their own sign-in (unreachable today, checked anyway).
- **Independent of account standing.** Approval lives on `advice_provider`
  (`approved_at`, `approved_application_id`, set together by an approval and
  cleared together by a revocation, in the decision's transaction), never on
  the farmer or buyer record. Suspension and restoration never touch it, so
  restoring an account does not restore a revoked approval -- the
  specification's rule -- and a suspended account's badge is simply out of
  the directory with the rest of its profile.
- **What the public sees:** `approved_adviser` (true/false) and
  `approved_since` (the month). Never the application, its id, its text or who
  decided.
- **Audit:** `adviser_application.submitted`, `.replied`, `.withdrawn` (ids and
  statuses only, never the application's text or the answer);
  `adviser_application.clarification_requested`, `.approved`, `.declined` and
  `adviser_approval.revoked` (statuses and the staff member's recorded reason,
  as `account.suspended` carries its reason). NOT YET IN THE DATABASE CHECK:
  one combined CHECK migration adds them (the owner), so until it lands every
  write here is refused rather than unlogged.

## Advice: photos and referral with consent; advice in analytics (2026-10-25)

The 16 October specification: "Questions and optional attachments remain
private to the permitted participants. Share case details and refer to another
provider only with appropriate consent." And analytics must cover "advice
usage, case resolution". Migration `20261025090000_advice_attachments_and_referral`
(two new tables, RLS on both; additive).

- **Photos.** Up to 3 when the question is sent (shrunk on the phone to 1280 px
  JPEG, at most 2 MB, JPEG/PNG/WebP accepted), and either participant may add
  one later while the case is open, up to 10 per case. Private bucket
  `advice-attachments` (added to `storage-buckets.mjs`), path
  `<case id>/<upload id>.<ext>`. Grant -> upload straight to Storage -> confirm,
  which checks the provider's own size and type and removes anything wrong
  (`advice_attachment_rejected`). Shown only to the case's requester and
  provider, as read links that live 5 minutes, issued in one function
  (`attachmentLinks`) that refuses anyone else; staff have no read path.
  `tests/advice-attachment-scan.test.ts` holds this. Only the person who added
  a photo removes it: the row is soft-deleted and the object removed, as for a
  profile photo. Audited `advice_attachment.added` / `.removed` with ids, type
  and size, never a path.
- **Referral.** The case's provider proposes another published provider from
  the directory (`advice_referral`, one waiting proposal per case). Nothing is
  shared, and the other provider sees nothing, until the requester accepts.
  Acceptance, in one transaction: the case closes as `referred` (closed by the
  proposer), a NEW case opens with the other provider carrying the topic and
  question (its own conversation), and the requester's own photos are copied
  to it only if they ticked "share my photos too" (unticked by default; the
  provider's photos are never passed on). The new case is in-app only with
  `share_details` false: consent to share a phone or place was given to one
  provider and is not carried to another (INFERRED reading of "appropriate
  consent"; the requester can still say more in the conversation). Both cases
  link through the referral row; the referring provider learns the referral
  was accepted, never the new case. The requester may decline; the proposer
  may withdraw; closing the case withdraws a waiting proposal. Audited
  `advice_referral.proposed` / `.accepted` / `.declined` / `.withdrawn`.
- **Analytics.** A new "Advice" group: providers published and approved
  advisers (now); requests by topic, cases closed by outcome, median days to
  close, feedback given by stars and the average rating, adviser applications
  submitted and decided, referrals by status (all in the window). National
  only (a case carries no state); counts and averages only. A median or average
  of nothing is served as not measured (`none_in_window`), never 0.
- **Audit CHECK.** The six new keys are in `AUDIT_ACTIONS` and CONVENTIONS
  §5.2.2 but NOT in the database CHECK: the owner writes the combined CHECK
  migration, so `audit-check-matches-migrations` fails on this branch until
  then, and every write here is refused rather than unlogged.

## Settings, phase 1 (2026-10-25)

CORWADO's 16 October specification, the "Settings" tab ("Service
configuration, policy versions, security, integration and recovery
controls"). Migration `20261025100000_settings_phase1`. A staff screen at
`/admin/settings`, a new "Settings" tab in the portal navigation;
administrators holding `settings.manage` read and write it (every
administrator holds it; other staff only through the Administrator preset).

- **Versioned, never overwritten.** Settings live in `setting_version`: one row
  per saved version of one key (`identity`, `support`, `maintenance`,
  `reason_codes`), each value checked by its shared Zod schema
  (`packages/shared/src/settings.ts`). A save appends version n+1 and must name
  the version it was made against, so two administrators cannot silently undo
  each other; a trigger refuses UPDATE and DELETE. Earlier versions are shown
  on the screen. A key never saved reads as its fallback -- what the site
  showed before -- so nothing changes until someone saves.
- **Identity and help.** The approved service name, About text, support phone,
  WhatsApp, email, opening hours and up to ten https help links. The public
  `/help` page shows About, contacts and links; the market and farmer footers
  show a Help link and the published contacts. None was published before, so
  until one is saved they show nothing new but the Help link.
- **Terms and data.** Versioned notices in `notice` (consent, terms, privacy;
  en and ar): draft, preview, publish -- which retires the version it
  replaces, kept for ever -- and discard (a draft only, softly). The current
  consent text is seeded as `v1.3` en and ar, published, word for word the
  sign-up text (a test holds the two together). The sign-up screens read the
  published consent from the public `GET /api/notices/current` and record
  `<version>-<language>` as before, with the built-in v1.3 text as the offline
  fallback. Consents already given keep their version; publishing asks nobody
  to agree again. Acknowledgement history: counts of accepted and still-current
  consents per version and language, from the existing consent records, live
  farmers only, no names. Retention is shown as the open decisions it is
  (messages, access logs, deleted accounts: not set, kept indefinitely);
  nothing purges.
- **Security and operations (read-only, never a secret).** Each integration
  (Supabase, database, Bird, Resend, OpenWeather, Anthropic, Sentry, scheduler,
  Mapbox) shows whether each environment variable NAME it reads is set -- a
  boolean, never a value, length or prefix. Mapbox shows "not in use": no code
  reads a Mapbox variable yet. Staff MFA: a count of staff with a verified
  authenticator app from Supabase Auth's factor table, or "not tracked" if it
  cannot be read. Backup and restoration: static text from
  `docs/RUNBOOK-restore.md`; the last backup and drill are not recorded in the
  application. The one editable item: the maintenance notice (text and on/off),
  a banner at the top of every page, public and portal, while on.
- **Moderation reason codes.** A list (code, label, offered for listing /
  account / profile / report, active) seeded with six defaults: prohibited
  content, misleading listing, fraud or scam, abusive behaviour, duplicate or
  spam, other. A saved code is never removed (refused: past decisions may name
  it); it is archived and can be restored. The suspend dialog and the
  buying-request/service report decisions offer the active codes; choosing one
  pre-fills the written reason, which stays required. The chosen code (and the
  report decision's written reason, which was previously discarded) is recorded
  in the audit row. The produce product-report screen still offers no
  decisions, as before, so it has no dropdown.
- **Public reads.** `GET /api/settings/public` (service name, About, support
  contacts and links, the banner) and `GET /api/notices/current`. Whitelists;
  read-only; cached for a minute.
- **Audit:** `setting.changed` (the key, both version numbers and the NAMES of
  changed fields; for the banner on/off; for reason codes the codes added and
  archived -- never a contact detail or text), `notice.drafted`,
  `notice.draft_edited`, `notice.draft_discarded`, `notice.published`,
  `notice.retired` (kind, language, version, status -- never the body). NOT
  YET IN THE DATABASE CHECK: one combined CHECK migration adds them (the
  owner), so until it lands every settings write is refused rather than
  unlogged.
- **Phase 2** (built 2026-10-27: "Settings, phase 2" below) covers the remaining subsections of the specification's
  table: language and region (languages, time-zone display, date formats,
  currencies, units), registration and recovery (verification, sign-in and
  recovery methods, session rules, age eligibility -- self-service registration
  preserved), profile privacy defaults (field visibility, discoverability,
  contact visibility, never exposing existing users silently), marketplace and
  reference lists (listing fields, validity and reminders; locations,
  commodities, categories, units; archive without deleting), and notification
  templates (triggers, channel preferences, templates; suspension duration and
  appeals).

## Services: any account may offer one (2026-10-26)

Replaces "owned by a farmer account for now" (Listings, 2026-10-19). The
client's acceptance test failed check 7: an institution, or any buyer account,
could not post a service without first registering as a farmer. CORWADO's
specification: institutes, colleges, research bodies, advisory organisations
and independent advisers "may publish ordinary profiles and service
advertisements"; "one account buys, sells, publishes buying requests, offers
services and seeks advice". Migration
`20261026090000_service_listing_any_account` (additive in effect).

- **Owner.** The design of buying requests: `poster_type` (farmer | buyer) with
  `farmer_id` or `buyer_id`, exactly one, the one the type names (a CHECK).
  Written by the server from the session (`marketPoster`), never the body.
  Existing rows were backfilled `farmer`.
- **Place.** A farmer's service keeps the farmer record's payam and state; a
  farmer may not send a state ("Your location comes from your farmer
  record."). A buyer account has no payam: it chooses a state from the list
  (checked against `state`), and `payam_id` is empty -- allowed only on a
  buyer's row (a CHECK). The location in words is given by both.
- **Live poster.** The poster joins are LEFT joins to `farmer_active` and
  `buyer_active`, each filtering `suspended_at`, and every read of a service
  requires the poster to be live, so a suspended or removed account's
  services leave the market, the owner's list, contact, messaging, profiles
  and reports. `tests/suspension-scan.test.ts` holds this.
- **Public shape.** Adds `poster_type` and `poster_verified` (the farmer's
  badge, or the buyer organisation's); `farmer_verified` stays, true only for
  a verified farmer. No id of either account.
- **Everything else that reads a service** follows: messaging names the
  buyer's sign-in as the owner; both public profile routes list a buyer's
  services; deleting an account withdraws its services as a buyer too.
  Analytics and the moderators' report queue needed no change (they read the
  service's own state and name).
- **Screens.** "My services" on the buyer side (list, new, edit; English),
  with a State selector and the organisation's name as the default name on
  the market. The farmer side is unchanged.
- **Audit:** no new key -- `listing.created`, `listing.updated` and
  `listing.status_changed`, with the poster's type as the actor.

## Notifications, suspension notice, appeals (2026-10-26) — fixes from the client acceptance test

CORWADO's acceptance test (24 October 2026) found that nobody is told about
adviser decisions or a suspension, that an old session came back after a
restore, that appeals were not built and that product reports had no decision
buttons. The specification: "Notify relevant users of inquiries, case updates,
invitations and account actions" and "Suspend with reason/notification,
review appeal and restore".

- **In-app notices, fixed sentences only:** adviser decisions (question,
  approved, not approved, revoked); account restored; a sender's first message
  in a conversation (one notice per side, naming only the kind of post); an
  advice case started or closed; a referral proposed or accepted. No message,
  case or reason text ever enters a notice. Every notice is audited as
  `notification.created`.
- **Suspension:** one essential SMS to the account's +211 mobile naming the
  reason CODE's label (never the free-text reason) and the appeal path
  (agrionesouthsudan.com/help, which redirects to www); the outcome
  (sent / failed / no mobile) is in the suspension's audit row; a failed text
  never undoes the suspension. All open sessions are ended before the ban.
  OWNER TO CONFIRM: SMS on suspension is an essential service message.
- **Appeals are support messages** with the topic "Appeal a decision", not
  tickets (helpdesk ticketing stays out of scope); staff see an Appeals filter
  in Support messages, linked to the account where it can be identified.
- **Product reports:** Reviewing / Resolve / Dismiss / Remove listing with a
  reason code and a written reason, as the server already allowed.
- **Open:** channel preferences (essential vs promotional) have no table yet;
  the older listing-withdrawn notice still names the listing and staff's
  reason (left as it was; the notice scan names it as the one exception).

## Organisational profiles and team access (2026-10-27)

CORWADO's 16 October specification, "Organizational continuity", and the
demonstrations "Team access", "Independent institution" and "Deletion" (the
organisational part). Infographic 6 ("Organizational Profiles and Team
Access") was never received: **the specification text governs** (DOCUMENTED:
the handover table names it; the file is absent from the evidence folder).
Migration `20261027090000_team_access`.

- **A new `organization` table, not a generalised `buyer_organization`
  (INFERRED, from the code).** `buyer_organization` is one buyer's procurement
  record: every buyer registration makes one (`api/buyer/register`,
  `api/farmer/buying`), `buyer.organization_id` is NOT NULL and one-to-one in
  practice, it carries staff verification (`verification_status`, the
  verification queue) and it is joined into `requireRole` for every buyer
  request. Making it the team profile would put every farmer-only
  organisation into the buyers' verification queue and tie team access to
  procurement. The organisational profile is therefore its own table, which
  any account (phone or email sign-up) may create; it reuses the existing
  profile kinds (group / business / institution), group kinds and actor types
  from `account_profile`. No link column to `buyer_organization` was added: a
  link nothing reads is a column that lies. A buyer whose business should be a
  team profile creates one with the same name.
- **Membership** (`organization_member`): the organisation, the member's
  sign-in (auth user), a preset and granular permissions, status (active /
  revoked / left), who invited them and when it ended, with a reason. Ending
  access never removes the row and never touches the person's own account.
- **Presets and permissions** (pure, `packages/shared/src/organization.ts`,
  tested): `profile.edit`, `listings.manage`, `inbox.read`, `inbox.reply`,
  `advisory.handle`, and `team.manage`, which only the Administrator preset
  carries (a CHECK). Administrator = all; Contributor = listings, inbox
  read and reply, advisory; Viewer = inbox read. An administrator may narrow
  or widen a contributor's permissions; a viewer holds read-only permissions
  only. These are **organisational permissions**: nothing here reads or
  grants a staff permission, and an organisation administrator cannot award
  AgriOne verification or advisory approval.
- **Becoming an administrator always needs the recipient's acceptance**: by
  invitation, or by an offer to an existing member (`kind = 'transfer'`).
  The offering administrator chooses what they become on acceptance (stay
  administrator, contributor, viewer, or leave). A preset change to
  administrator is refused (`organization_admin_needs_acceptance`).
- **Invitations**: to a +211 phone or an email address, with the preset and
  permissions shown to the recipient before they accept; 7 days; only a
  SHA-256 hash of the 32-byte token is stored. **Authentication**: the
  recipient must be signed in as that phone (their farmer sign-in phone) or
  that email (their sign-in email, read from Supabase Auth). **Delivery**:
  a copyable invitation link is shown to the inviter once, and the recipient
  also sees the invitation in the app (Settings → Organisations) when signed
  in as the invited phone or email, plus an in-app notice when an account with
  that phone already exists. SMS (Bird) or email (Resend) is attempted when
  configured; its outcome is recorded on the invitation (`delivery`) and a
  failed send never undoes the invitation.
- **Acting as** (INFERRED design): the choice is a cookie
  (`agri_acting_org`, httpOnly, SameSite=Lax), set only by
  `POST /api/organizations/acting` after the membership is checked, and
  re-checked on EVERY request that uses it
  (`lib/api/organizations.ts actingAs`). A revoked member's next request is
  refused with `organization_access_ended`, never silently treated as
  personal. Actions and conversations made while acting show the
  organisation's name; the audit row's actor is always the person.
- **What honours "acting as" in this pass**: buying requests and service
  listings (created with `organization_id`, the organisation's name on the
  market, managed by any member with `listings.manage`), and conversations.
  Produce listings remain personal (they depend on farmer verification and
  the farm record) -- a known gap.
- **Shared inbox**: a conversation side is either a person or an
  organisation (`owner_organization_id` / `starter_organization_id`). An
  inquiry to an organisation's post lands in that organisation's inbox, read
  by members with `inbox.read` and answered by members with `inbox.reply`;
  the outside party sees the organisation's name, members see which colleague
  wrote. A person's own inbox shows only personal conversations. The old
  unique (one conversation per post and starter) became two partial unique
  indexes with the old meaning for every personal row.
- **Last administrator**: an organisation always has at least one active
  administrator while open. The last one cannot leave, be revoked or step
  down; they transfer (with acceptance) or close the organisation. Closing
  withdraws the organisation's live posts, closes its conversations, ends
  every membership and keeps every record.
- **Personal deletion of the last administrator** (the defined process, no
  indefinite dependence on anyone): `POST /api/account/delete` lists the
  organisations the person is the last administrator of and refuses until
  they choose `close_organizations: true`, which closes them in the same
  transaction. Where another administrator exists, the person's membership
  simply ends. Pending transfers they offered are cancelled.
- **Encourage two administrators**: the team page shows a notice while there
  is only one.
- **Public team and contacts**: optional. The profile shows public phone /
  email only when the organisation gives them, and lists a member only when
  the organisation turns "show team" on AND that member has agreed
  (`show_on_profile`, set by the member themself only).
- **Evidence-based exceptional recovery**: a staff administrator with the
  `support.handle` permission may make a named person an administrator of an
  organisation that has none reachable, with a written reason and an
  evidence reference, re-authenticated by password, audited as
  `organization.recovered`. OWNER TO CONFIRM: `support.handle` is the
  permission chosen (no new staff permission key was added).
- **Audit keys** (new; the CHECK is the integrator's): `organization.created`,
  `organization.updated`, `organization.published`, `organization.unpublished`,
  `organization.closed`, `organization.recovered`, `organization_member.joined`,
  `organization_member.updated`, `organization_member.revoked`,
  `organization_member.left`, `organization_invitation.created`,
  `organization_invitation.accepted`, `organization_invitation.declined`,
  `organization_invitation.cancelled`, `organization_transfer.offered`,
  `organization_transfer.accepted`, `organization_transfer.declined`,
  `organization_transfer.cancelled`.

- **Posts outlive the person who made them (INFERRED, from "organizational
  continuity").** A buying request or service made for an OPEN organisation
  stays on the market when the person who posted it leaves, is removed or
  deletes their account: the market's live-poster rule is now "the farmer, the
  buyer, or an open organisation" (`og` join, filtering closed and removed
  organisations; `tests/suspension-scan.test.ts` holds the new form). Personal
  deletion withdraws only PERSONAL posts and closes only PERSONAL
  conversations. A conversation about such a post whose poster has gone is
  held by the organisation's longest-serving administrator's sign-in (the
  column is NOT NULL); the inbox is the organisation's either way. OWNER TO
  CONFIRM: a suspended person's organisation posts stay visible (the
  suspension is of the person, not the organisation).
- **Known gaps (this pass):** produce listings and advisory cases are not yet
  made "as" an organisation (`advisory.handle` exists and is granted but no
  advice route reads it); the shared inbox's read mark is shared by the team;
  in-app notices for organisation conversations go to at most twenty members
  with `inbox.read`; invitation SMS/email is attempted only when Bird/Resend are
  configured, otherwise the link is copied by hand (OBSERVED in code, not
  exercised against either service); the organisation's state is not on the
  forms yet (the API accepts it); no route or screen was run end-to-end
  (`next dev` and DB tests are not run on this machine) -- the pure suite,
  type check and lint are what was run.

## Self-service password recovery and a verified change of number (2026-10-27)

CORWADO's 16 October specification: "Provide resend, change-number and secure
recovery functions", and "Ordinary participation must not depend on project
staff". This **supersedes for self-service** the 2026-10-09 entry "Password
reset: buyers by email, farmers by their officer or an administrator": the
staff path (POST /api/farmers/:id/sign-in) is **kept** beside it, for a farmer
without a working phone.

- **Forgot your password? (phone accounts).** /farmer/forgot-password: the
  number, then a 6-digit SMS code (purpose `password_recovery`), then a new
  password. On reset the code is used once, the password is set in Supabase
  Auth, **every existing session is ended** (revokeAllSessions), one audit row
  (`account.password_recovered`: method and whether sessions ended) and one
  fixed in-app notice. OBSERVED in pure tests only; the Supabase calls are
  INFERRED from the documented behaviour (no non-production project exists).
- **Never reveal whether a number has an account.** The code request writes a
  verification row and returns the same answer for every well-formed +211
  number, so the per-number and system-wide limits (and 429s) apply equally.
  The SMS goes only to a number with a live, unsuspended phone account, and it
  is sent **after** the answer (`after` from next/server), so the answer's
  timing does not differ either. INFERRED: the residual difference is the
  account lookup, one indexed query in both cases. A row for a number with no
  account holds the hash of a code nobody was sent, so verifying it answers
  "wrong", exactly as a mistyped code does.
- **Change of number.** A code goes to the NEW number (purpose
  `phone_change`, bound to the requesting account by a new
  `phone_verification.auth_user_id`), must be verified, and is used up by
  PATCH /api/farmer/me. The password re-entry, previously checked only in the
  browser, is now checked **on the server** (lib/api/reauth.ts). The code
  request does not check whether the new number is taken, so it cannot be used
  to look numbers up; a taken number is refused only at the change, after the
  person has proved they hold it. The OLD number gets one essential SMS
  ("the phone number on your account was changed ... contact CORWADO"); its
  outcome (sent / failed / not_mobile) is in the `farmer.updated` audit row
  with `verified_by`, never either number. A fixed in-app notice too.
- **Resend:** the same request again; the existing 60-second cooldown, 3 codes
  per number per 30 minutes and 200 per hour system-wide now cover all three
  purposes together. The screens count down with `resendWaitSeconds`.
- **Codes off:** with no SMS settings or FARMER_PHONE_VERIFICATION=off,
  recovery answers `available: false` (the screen sends the person to an
  officer or CORWADO) and a change of number needs the password alone.
- **`account_recovery` (migration 20261009090000) stays unused.** Reusing it
  was considered and declined: it is keyed one row per sign-in for a code
  _shown at registration_, has no phone, no purpose, no expiry and no
  per-number rate limit, while `phone_verification` already has hashed codes
  bound to their row, expiry, five tries, and per-number and system limits. A
  second code store would split the limits. Dropping the table remains the
  owner's decision (unchanged since 2026-10-09).
- **Officers** (phone sign-in, staff) are not covered: their password stays
  with an administrator. INFERRED from the specification's "ordinary
  participation".

## Enterprise size: a size, not a kind of business (2026-10-27)

The specification: "SME is a size classification, not an alternative to
processor, supplier or trader." Neither the specification nor this file defines
bands, so the size is **labels only**: micro, small, medium, large, or not
stated (null). **OWNER TO CONFIRM** whether CORWADO wants numeric bands (staff
or turnover) attached to the labels.

- Optional, on `account_profile` (`enterprise_size`, `show_enterprise_size`),
  offered to a group, business or institution only (a CHECK refuses one for an
  individual); separate from the activities, which are unchanged.
- Edited in "About you" with the profile kind; shown on the published public
  profile **only if the owner ticks "Show the size on my public profile"**
  (off by default).
- Admin analytics: one breakdown, "Groups, businesses and institutions by
  size", including not stated. Audited in `account.profile_updated` as before.

## A moderator requests a correction; the post stays live (2026-10-27)

The specification, Marketplace: "Inspect, request correction and moderate with
a reason; listing removal is separate from account action."

- Staff holding `content.moderate` (administrators) request a correction on a
  produce listing, service listing or buying request with a **reason code**
  (CORWADO's list, active and offered for listings) **and a note** (5-500
  characters). From the product-report and market-report queues, and from the
  staff marketplace product page. At most one open request per post.
- The owner gets ONE fixed in-app notice ("CORWADO asked you to correct one of
  your posts"); the note is shown on their own list of posts with a
  "Correction requested" stamp, **never in the notice** (the notification
  rule of 2026-10-26). No SMS: the account-notice path does not send one.
- **The post is not touched.** It stays on the market unless a moderator
  separately removes it; nothing is done to the account.
- When the owner next saves a change to the post's **content**, the request is
  marked `addressed` in the same transaction and the moderator sees it in
  "Correction requests". A lifecycle move (pause, resume, withdraw, complete)
  or a renewal of the end date alone does not count.
- New table `listing_correction` (soft delete, RLS on, no policies). Audit:
  `listing.correction_requested` (code and note, as a suspension records its
  reason) and `listing.correction_addressed` (the names of the changed fields).

## Admin console: overview, accounts, marketplace, support cases (2026-10-28)

CORWADO's specification of 16 October, section 4 (lines 95-111), and the
infographics "AgriOne Admin Portal, 1 of 3" (no. 1) and "Profile creation and
visibility" (no. 5, panel 4). Branch `feat/admin-console`, migration
`20261028090000_admin_console`. Communications and Settings belong to another
lane and are not touched.

**Overview.**

- DOCUMENTED (spec line 95; infographic 1, panel 1): staff see a new overview
  at `/dashboard` from `GET /api/admin/overview` (admin, supervisor and
  read_only, then `reports.view`, scoped to states like `/api/analytics/summary`).
  It has tiles, open-case counts, two day-by-day trends (registrations;
  listings vs buying requests) and system alerts. Its filters (date range,
  state, actor type) are carried into the links to each queue.
- INFERRED (one instance: the brief): people, sign-in accounts and
  organisation profiles are separate tiles. People are live farmers and buyers,
  one per sign-in, plus farmers with no sign-in. Accounts are distinct
  sign-ins. Organisations are those not deleted or closed.
- INFERRED: officers keep the caseload overview at `/dashboard`. Staff find the
  farmer-verification figures at `/reports/programme`, linked from the new
  overview. They remain a programme measure but are no longer the headline.
- INFERRED: "actor type" means the activities on the account profile. Figures
  narrowed to different actor types overlap. Cases are not narrowed by actor.
- INFERRED: the alerts are failures in the window (the analytics failure
  actions, plus suspensions whose text message failed), integrations that are
  not configured (shown only to holders of `settings.manage`, as the settings
  status route does), the maintenance banner, and tables not yet in the
  database. Delivery status in `notification` is not used yet.
- INFERRED: the charts are inline SVG. No chart library was added.

**Users and organizations.**

- DOCUMENTED (spec line 97): one list at `/admin/accounts`
  (`GET /api/admin/accounts`). It holds sign-in accounts (phone or email, with
  their farmer and buyer records together), farmers with no sign-in, and
  organisational profiles. Columns: actor types, organisations, joined
  date-time, first sign-in, last active, status, verification, publication and
  advisory status. Filters: people or organisations, actor type, status,
  sign-in, state, and joined dates. Administrators only, then
  `support.handle` or `content.moderate`.
- INFERRED from the deletion law (CLAUDE.md §4): **deleted accounts are never
  listed or counted**, so the list has no "deleted" status, although the brief
  asked for one. **Owner decision:** whether staff need a restricted view of
  deleted accounts, which would need an exception to the law.
- INFERRED: "search by contact as permitted" means that digits typed into the
  search box match a phone only for `support.handle`. Email search is not
  possible, because an email address lives only in Supabase Auth.
- DOCUMENTED (infographic 5, panel 4): each account has a page at
  `/admin/accounts/:kind/:id` showing its profile, contact-verified flags, its
  phone and email **masked**, its activity (access_log events and its own
  audit action keys), staff actions on its records (with the written reason),
  its organisations and its advisory status.
- **Reveal:** `POST …/reveal` returns one contact in clear, for
  `support.handle` only. It is audited as `account.contact_revealed`, which
  names the field and never the value.
- **Disable** (`POST /api/admin/accounts/disable`, `content.moderate`, reason
  and code) is distinct from suspend:
  - A disabled record is also suspended (a database CHECK), so every existing
    suspension filter applies to it unchanged.
  - Every session is ended, sign-in is banned, and a text message saying
    "disabled" is sent, with the code label only.
  - Restore refuses it with `account_disabled_restore`.
  - **Re-enable** (`POST /api/admin/accounts/reenable`) needs
    `superadmin.grant` and a reason. It clears both the disable and the
    suspension and sends a fixed notice.
  - Audit keys: `account.disabled` and `account.reenabled`.
  - INFERRED: re-enable asks for no re-authentication. **Owner decision:**
    whether it should require the password, as Super Admin delegation does.

**Marketplace console.**

- DOCUMENTED (spec line 99): `/admin/marketplace` has the tabs Produce,
  Inputs (`seeds_inputs`), Buying requests, Services and Inactive (paused,
  expired, withdrawn, completed). Each tab has search and filters. Each post
  can be inspected, have a correction requested (the existing route), or be
  removed with a reason. Every route requires `content.moderate`.
- INFERRED from the deletion law: "removed" posts are read from the audit
  trail's removal records (`listing.removed`,
  `product_report.listing_removed`), never from the soft-deleted rows. Titles
  are recorded from now on. Earlier removals show "Title not recorded".
- OBSERVED in the schema: there is no expired status, so "expired" is
  computed. A live post past its end date shows as expired, matching what the
  market already hides.
- DOCUMENTED (infographic 5, "Draft is private"): drafts are never listed.
- INFERRED: posts of suspended owners are shown and flagged.
- INFERRED: removal (audit key `listing.removed`) never touches the account,
  and it leaves open reports and corrections as they are. The owner gets a
  fixed notice that does not include the reason.
- INFERRED: the inspect view omits the contact phone, and counts photos
  rather than showing them, because the stored paths are not web addresses.

**Support cases. This follows spec line 103 even though an earlier note
said "no ticketing".**

- DOCUMENTED, spec line 103: "Reports and Support: Case IDs, responsible
  staff, evidence, status, dates and resolution. Handle technical issues,
  complaints and appeals." The note of 2026-10-21 ("no tickets, no
  assignment, no replies") and CLAUDE.md §2's "helpdesk ticketing" exclusion
  are superseded **for these fields only**. There are still no SLAs, no
  automatic routing and no email threading. **Owner decision:** confirm this
  reading of the scope.
- A "Contact CORWADO" message is a case:
  - a visible case number (`#1045`, an identity column that also numbered the
    existing rows);
  - a type: technical issue, complaint, appeal or enquiry. The default comes
    from the topic, so no row was rewritten;
  - a priority and a responsible staff member (staff who hold
    `support.handle`);
  - a status: new → in progress → waiting for the person → resolved or
    closed. The earlier `done` reads as resolved;
  - a resolution note, required to resolve or close;
  - dates: opened, last change, and settled.
- Staff can add three kinds of entry to a case (new table
  `support_case_entry`):
  - **replies**, which the person reads on the Help page under "Your messages
    to CORWADO", after a fixed in-app notice that never carries the text;
  - **internal notes**;
  - **evidence links**.
- A visitor has no inbox, so staff are told to answer them by phone or email.
- Appeals are cases of type appeal, and the case links to the account, where
  Restore is.
- Audit keys: `support_case.updated` and `support_case.replied`. Note and
  reply text never enters an audit row.

**Not yet in the database CHECK:** `account.disabled`, `account.reenabled`,
`account.contact_revealed`, `listing.removed`, `support_case.updated`,
`support_case.replied`. The integrator's combined CHECK migration adds them.

## User journeys (2026-10-28) — sign-up, shortcut hub, preview, block, expiry reminders

CORWADO's 16 October specification, lines 36-57 and section 3, and the
infographics no. 4 (one account, many functions), no. 5 (profile visibility)
and no. 7 (marketplace journey). Branch `feat/user-journeys`, migration
`20261028100000_user_journeys` (additive; not applied anywhere).

**Phone sign-up asks only what the specification lists (DOCUMENTED, spec line
38).** Name, language, mobile number, password and the notice; the SMS code
activates the account as before. Sex, year of birth, state/county/payam and
village moved to the optional "More about you" step (skippable) and to "Your
details" in the optional setup (`PATCH /api/farmer/me/details`); given at
sign-up they are still captured.

- The farmer columns `sex`, `year_of_birth`, `payam_id`, `county_id`,
  `state_id` lost NOT NULL (no type change, no data rewritten). Two CHECKs
  keep everything else as strict as before (INFERRED, from the officer intake
  and reach rules): `farmer_officer_record_complete` (an officer-registered
  farmer still has all five) and `farmer_location_whole` (all three levels or
  none).
- An account with no county is numbered `AO-000001` from its own sequence
  (the per-county counter needs a county). The number is never re-derived, so
  a place given later does not renumber it (C-5.4).
- **Verification and visits wait for a place** (INFERRED): reach figures and
  visits are by place, so `farmer_location_required` (422) refuses a verify or
  a visit for a farmer with no location yet. Supervisors (state-scoped) do not
  see such farmers; administrators do. Analytics filtered by state leave them
  out, as they already do buyers with no state.
- A produce listing asks "Where is the produce?" when the account has no
  place; a service from such an account names a state as an email account
  does. The market reads the listing's own payam, not the farmer's.
- Language: an explicit English / Arabic choice on the first step; the choice
  is recorded with the consent, as before.

**Email sign-up (INFERRED design, DOCUMENTED requirement).** Terms/privacy
acknowledgement (unticked, required; text from the published `terms` and
`privacy` notices, built-in v1.0 fallback — **OWNER: CORWADO to approve or
publish the real texts in Settings**), stored in `account_acknowledgement`;
language stored in `buyer.preferred_language`. **Email verification is a
6-digit code sent before the account exists** (Resend), the twin of the phone
code, not Supabase's confirmation link: self-registration is off on the auth
service, so there is no Supabase sign-up to confirm, and a proven address
means the account is active the moment it is created — no half-made account
that cannot sign in, no limited session to police. Codes: 15 minutes, 5
tries, 3 per address per 30 minutes, 60 s between sends, 200 per hour
system-wide. On whenever Resend is configured; `EMAIL_VERIFICATION=off` turns
it off. The code route never says whether an address has an account
(registration still answers 409, as before).

**Shortcut hub (DOCUMENTED, spec line 49).** "What would you like to do?" on
both homes: Sell produce, Buy, Post a buying request, Offer services, Get
advice, My profile, Organisations. The account's activities order the tiles
(a tile serving more chosen activities first; ties keep the default order) and
hide none (`lib/account/shortcuts.ts`, pure test). Existing content stays
below.

**Person-level block (INFERRED).** From a conversation, "Block this person"
blocks the other side's account (`account_block`; the account is read from a
conversation the caller is in, never from the body; `blocked_name` is the name
the caller saw). Both ways: while either has a live block, neither can start a
conversation with the other or send a message; the refusal never says who
blocked. Blocking while acting for an organisation is refused (the shared
inbox closes conversations instead). Unblock ends the row; history stays.
Settings list "Blocked accounts" in both shells. Audited `account.blocked` /
`account.unblocked`. Starting an advice case with, or accepting a referral
to, a provider across a live block is refused the same way.

**Expiry reminders (OBSERVED existing scheduler, INFERRED rest).** The
scheduler in use is Supabase pg_cron (weather, 2026-10-08), so the daily job
follows it: `scripts/expiry-reminders-cron-install.mjs` installs a 06:00 UTC
job calling `POST /api/cron/expiry-reminders` with the CRON_SECRET bearer
(own Vault entry). No `vercel.json` (one scheduler, not two); GET is accepted
so a Vercel cron could be added. Active listings, buying requests and services
ending within `EXPIRY_REMINDER_DAYS` (3; TODO pointer for the settings lane)
get one fixed in-app notice (no title in it), once per post per end date
(`post_expiry_reminder`, unique; insert first, notify only if inserted); an
edited end date earns a new reminder. Suspended or removed posters get none.
Batch of 500. **OWNER: run the install script once against production.**

**Preview before publishing (DOCUMENTED, spec line 72; infographic no. 7).**
Produce listings (also a new, unsaved one), buying requests and services have
a Preview button: the form is checked with the shared schema and the post is
shown as the market shows it (without profile link, Message, phone or
Report), with Edit / Save draft / Publish. No server change.

**A listing's place (INFERRED).** A new produce listing takes an optional
`payam_id` (checked against the payam list); without one the account's own is
used; with neither it is refused ("Choose where the produce is: state, county
and payam."). The form shows the picker when the account has no place. A
listing's payam is not changed after creation (gap). A new service from a
phone account with no place shows a state picker; an edit never sends one.

**Produce posted as an organisation (INFERRED, following 20261027090000).**
`produce_listing.organization_id` is set when the person acts for an
organisation and holds `listings.manage`; personal and organisation listings
are kept apart; the person stays in `farmer_id` and in the audit row; the
listing shows the organisation's name and its messages go to the
organisation's shared inbox. Only phone accounts can post organisation produce
(`farmer_id` is NOT NULL). Gaps: such produce leaves the market if the posting
farmer is suspended or removed (the market joins the farmer), unlike buying
requests and services; the card names the organisation without a link.

**Organisation state field.** A state picker on the organisation create and
edit forms (the column, routes and public page already carried it).

**Public profile expertise (INFERRED, infographic no. 5).** The topics of the
account's advice profile, only when that profile is published, and an
"Approved adviser" badge when the account holds an approved, unrevoked
authorization (shown whether or not the advice profile is published). Nothing
else from the advice profile is public.

## Official announcements, templates, preferences and delivery records (2026-10-27)

CORWADO's 16 October specification, Communications: "Official announcements,
templates, recipient scope, preferences and delivery records. Preview before
sending; private conversations are not a broadcast resource", and Settings,
"Notifications and moderation: triggers, channel preferences and templates".
Migration `20261027110000_communications` (additive: four new tables). Branch
`feat/communications-settings2`.

- **Before (OBSERVED, reading main at 65e2462).** `POST
/api/admin/communications` (admin only) emails chosen staff through Resend
  and texts chosen farmers or officers through Bird; the browser sends record
  ids. No sent-history table. `notification.channel` is `sms | in_app`; the
  in-app notices of `lib/api/notify.ts` are fixed sentences. Buyer accounts and
  email accounts were not reachable. That screen is kept unchanged as the
  "Direct message" tab.
- **Recipient scope (DOCUMENTED by the spec; the grouping INFERRED).** All
  accounts, phone accounts (farmer records), email accounts (buyer accounts,
  and farmer accounts that also hold a buyer side), one state, one activity
  (account_profile activities; "farmer" and "buyer" also take every farmer or
  buyer account), staff (email only) and extension officers (SMS only). An
  account that is both a farmer and a buyer is ONE recipient on its farmer
  side, as `notifyAccount` already does. Live records only: farmers with
  consent granted and not withdrawn, not suspended, not merged; buyers not
  suspended; active officers and staff. Recipients are resolved in SQL from
  those tables; no route accepts a list of ids, and nothing reads a
  conversation or a message (`tests/announcements-scan.test.ts`).
- **One plan for preview and send.** `PLAN_SQL` decides, per recipient per
  channel, sent or skipped and why: no inbox (in-app to staff or officers), a
  preference, no contact (no +211 mobile; no email account), or a shared phone
  or organisation inbox (the first recipient is sent, the rest skipped, so a
  handset is billed once and an inbox gets one notice). The preview counts it;
  the send inserts it. The send must quote the preview's recipient count, or
  it is refused (`announcement_recipients_changed`) and the preview refreshed.
- **Preview.** The text rendered with the example name "Amina", the count, and
  per channel will-send / switched off / no contact / shared. SMS: parts per
  message (estimated with `{name}` at its 20-character cap), total parts and,
  when Settings hold a cost per part, a US$ estimate. Bird's invoice is the
  authority.
- **Placeholders:** `{name}` (first name, cut to 20 characters, "friend" when
  none) and `{service_name}`. Anything else in braces is refused.
- **Categories.** `announcement` respects preferences; `essential` (account,
  security, service continuity) ignores them -- the only kind a person cannot
  switch off. INFERRED; OWNER TO CONFIRM who may mark an announcement
  essential (today: anyone holding the permission, with a warning on the form).
- **Batches within Vercel limits.** Send = queue only (one statement). The
  screen then calls `POST .../process` until nothing remains: up to 500 in-app
  notices per call (set-based), then up to 40 SMS/email, 6 at a time, no new
  provider call after 30 s, `maxDuration` 60 s. Rows are claimed with SKIP
  LOCKED, so two tabs never send one delivery twice. Every outcome is written
  back with an audit row of counts. A closed tab pauses; "Continue sending"
  resumes. A claim that never finished (function killed) is marked FAILED after
  10 minutes and never resent automatically -- an SMS may have gone, and a
  second would be billed; "Retry failed" is a person's decision. Before any
  provider call the audit CHECK is read, as the direct SMS route does. A
  provider not configured leaves its deliveries waiting and says so.
- **Delivery record.** `announcement_delivery`, one row per recipient per
  channel: status (queued, sending, sent, failed, skipped), skip reason,
  provider message id (Bird's; Resend's id is now returned by `sendOneEmail`),
  provider error, attempts. No phone, address or text is stored there or in an
  audit row; contacts are read at the moment of sending.
- **In-app.** Each in-app delivery is a row in the existing `notification`
  table (farmer inbox, or the buyer organisation's), so it appears among the
  person's notices; a person's own list is `GET /api/account/announcements`
  (farmer Notifications page; buyer Notifications -> Announcements). The
  notification text is staff-written official text, the one deliberate
  exception to "fixed sentences only"; it never carries a message, case or
  reason.
- **Email to accounts.** Buyer accounts now receive announcement email (address
  from Supabase Auth, never stored); `.invalid` identifiers are never used.
  A footer points to the notification settings, except on essential mail.
- **Preferences.** `notification_preference`, one row per sign-in, no row =
  everything on: announcements in-app / SMS / email, and activity updates in
  the app (`lib/api/notify.ts` now skips message and advice notices for an
  account that switched them off; adviser decisions and a restored account are
  essential and always sent). Shown on the farmer's Account page and the
  buyer's Notifications -> Notification settings, with the essential messages
  named. SMS/email "updates" have no switch because nothing sends them.
- **Templates.** `message_template`: per channel (SMS has no title), draft ->
  active -> archived and back; never deleted (an announcement may name it);
  only an active template can start an announcement.
- **Permission.** New key `communications.send`, in the Administrator preset
  (Super Admin has every key; the legacy admin rule gives it to every existing
  administrator). Routes are `roles: ['admin']` then `requirePermission`, as
  settings are; supervisors stay refused (new-routes matrix).
- **Audit keys (NOT YET IN THE DATABASE CHECK; the owner's combined CHECK
  migration adds them):** `message_template.created`, `message_template.updated`,
  `message_template.status_changed`, `announcement.drafted`,
  `announcement.draft_edited`, `announcement.draft_discarded`,
  `announcement.queued`, `announcement.batch_sent`, `announcement.retry_queued`,
  `announcement.completed`, `notification_preference.updated`.
- **Open:** automatic background sending (a cron) is not built -- the screen
  drives the batches; WhatsApp stays blocked; buyers' phone numbers are only
  texted when they are +211 mobiles.

## Settings, phase 2 (2026-10-27)

The remaining subsections of the Settings table, as versioned settings exactly
like phase 1 (append-only `setting_version`, expected-version saves, history,
audited as `setting.changed` with the NAMES of changed fields, plus archived
and restored list values and the new privacy defaults). Migration
`20261027110100_settings_phase2` widens the known-key CHECK; nothing is seeded,
and each fallback is what the code did before. RULE (applied throughout): a
field is offered only where code reads it.

- **Language and region.** Arabic on/off (English always on) -- read by the
  farmer language choices; a farmer who had chosen Arabic reads English while
  it is off. Date format (27 Jul 2026 / 27/07/2026 / 2026-07-27) -- read by
  `formatDate`, handed over by the banner component on every page; INFERRED
  limitation: text rendered before the settings arrive keeps the default
  until it re-renders. Time zone Africa/Juba, currency SSP and units are
  shown as fixed facts, not settings (prices are recorded in SSP; changing
  currency is a data change). OWNER TO CONFIRM if a configurable currency is
  wanted.
- **Registration and recovery.** Sign-up code wait (60 s default; read by the
  phone-code route), return-session inactivity (30 min; read by the access
  log), minimum age for farmer self-registration (none by default; from the
  year of birth, generously: this year minus birth year). There is no switch
  for self-service registration, deliberately. OWNER TO CONFIRM a minimum age.
- **Profile privacy.** Defaults for a NEW profile: show phone (off), allow
  messages (on). Read where the profile row is first created and by the empty
  profile form; an existing profile is never changed, and the screen says so.
- **Marketplace and reference lists.** Listing validity (30 days; read wherever
  a listing or service gets no end date), reminder days (3; the owner's
  listing, request and service screens mark a post ending within that many
  days -- no SMS reminder is sent), and archive/restore of listing categories,
  units and registration crops (commodities). Archived values are left out of
  new-post and registration forms and refused by the create routes
  (`reference_value_archived`); every existing record keeps its value. The
  values are Postgres enums, so nothing is deleted; a whole list cannot be
  archived. Locations come from the official list, not here.
- **Notifications and moderation.** SMS cost per part (for the preview),
  suspension review period (shown in the suspend dialog; a suspension still
  ends only by a restore) and appeal window (shown on the help page's appeal
  text). Templates and delivery records link to Communications. OWNER TO
  CONFIRM both periods (defaults 30 days).

## Staff two-step sign-in, with a rollout that cannot lock CORWADO out (2026-10-28)

The specification: "require strong staff authentication"; infographic 2, "Manage
MFA: require or reset multi-factor authentication". Lane-security.

- TOTP through Supabase Auth MFA (DOCUMENTED: enabled by default on Supabase
  projects; NOT exercised against the live project -- there is only production).
  A staff member sets it up at **Administration -> Your sign-in security**
  (`/admin/sign-in-security`): QR code and key, then a first code. Supabase
  verifies the code in the browser; `POST /api/staff/mfa` then confirms a
  verified factor exists (admin API) and audits `staff.mfa_enrolled`.
- **requireRole enforces it** (`staffMfaGate`, packages/shared): a staff account
  WITH a verified factor whose session is not `aal2` is refused everywhere
  (403 `mfa_required`) except `GET /api/me` and `/api/staff/mfa` (`mfaExempt`,
  pinned by `staff-security-scan.test.ts`). The `aal` claim is read from the
  token that getUser has just validated (INFERRED safe: getUser verifies it on
  the server first; the claim is never trusted on its own).
- **Rollout, `STAFF_MFA_ENFORCEMENT`**: `verify` (default, also for any unknown
  value) never refuses someone who has not enrolled -- the portal sends
  administrators to enrol before anything else; `required` also refuses an
  unenrolled administrator on the server (403 `mfa_enrolment_required`);
  `off` is the emergency switch. INFERRED: defaulting to `required` could leave
  CORWADO locked out of the admin API if enrolment failed in production.
- Sign-in: when the account has a factor the sign-in screen asks for the code.
- **Reset** (lost phone): Super Admins only (`superadmin.grant`), never on
  themselves, with re-authentication; removes every factor (DOCUMENTED: deleting
  a verified factor signs the account out everywhere). Audited `staff.mfa_reset`.
- Gap: the LAST Super Admin who loses their phone can only be reset from the
  Supabase dashboard. Owner decision: who holds that dashboard access.

## Sign-in through the server: failed sign-ins and a rate limit (2026-10-28)

- The staff/buyer email sign-in and the farmer phone sign-in now post to
  `POST /api/auth/sign-in` (public), which signs in with the anon key and writes
  the session cookie on its own response (DOCUMENTED: @supabase/ssr's
  route-handler pattern; NOT exercised live). A wrong password for an EXISTING
  account writes `sign_in_failed` to that account's access log (new value in the
  access_log CHECK); the account is found via `auth.users` by email (INFERRED:
  the app's database role may read it -- if not, the failure is simply not logged).
- Rate limit: 5 failures per identifier in 15 minutes (table `sign_in_attempt`,
  identifier stored as SHA-256 only, a success clears the count) and 30 attempts
  per address per 15 minutes per server instance (in memory, never stored).
  429 `rate_limited` with Retry-After. The answer never says whether an account
  exists. Gap (DOCUMENTED Supabase behaviour): anyone with the public anon key
  can still call Supabase Auth directly; those attempts meet Supabase's own
  limits and are in its auth logs, not ours. The Auth "password verification
  hook" would close this but is a paid-plan feature (owner decision).
- The public-route scan's "no route rate-limits" guard was replaced (not
  removed) by a test of what this limiter does.

## Last activity moves on API calls, throttled (2026-10-28)

- The route wrapper updates `account_activity.last_seen_at` at most once per
  account per five minutes (in memory per instance, and `last_seen_at < now() -
5 min` in the statement). Update only: the first row is still written by the
  "me" visit, which decides first sign-in. A return session is now measured
  from the last API call. Never throws; gives up after one second.

## Staff are invited by email and choose their own password (2026-10-28)

- `POST /api/admin/staff-invitations` (`staff.manage`, over the state for a
  state-scoped role): name, email, role, state. A 32-byte token, only its hash
  stored, valid 7 days, one open invitation per address. Email by Resend; when
  email is not configured (production today) or the send fails, the answer
  carries the link once so the inviter can pass it on -- the same degradation
  as team invitations. The link puts the token after `#`, so it never reaches
  a server log; `/staff-invite` sends it in a request body.
- The invitee sets the password (`POST /api/staff-invitations/accept`); the
  account is created then (same compensating transaction as `POST /api/users`).
- `POST /api/users` (password typed by someone else) is kept as the **Super
  Admin fallback**: once any Super Admin exists, only Super Admins may use it;
  while none exists, any administrator still may (INFERRED: otherwise the
  platform could not add staff before the first Super Admin is appointed).
- Lists show the address masked (`a•••@domain`). Audit `staff.invited`,
  `staff.invitation_revoked`, `staff.invitation_accepted`; never the address.

## Approved advisers: suspend, restore, what was checked, and official notes (2026-10-28)

The specification and infographics 3 and 8: "Suspend advisory access ...
Restore authorization"; "Account restoration does not automatically restore
advisory privileges"; "Approved advisory channels, official content
publication ... require separately assigned permissions"; "Verification states
-- what was checked".

- New decisions `suspend` (approved -> suspended, reason, 1-365 days) and
  `restore` (suspended -> approved); revoke also from suspended. A suspension
  **lapses by itself** at its end (`effectiveAdviserStatus`); the provider's
  approval columns are not cleared, so no second approval can slip in. Every
  reader of the badge also asks `APPROVAL_SUSPENDED_SQL`. Audited
  `adviser_approval.suspended` / `.restored`; fixed-sentence notices.
- Approval now records **what was checked** (at least one of identity,
  experience, qualifications, affiliation, service area, languages, interests
  disclosed), shown publicly on the profile as "Approved adviser: what CORWADO
  checked". Older approvals say they predate the record.
- The admin account record (the Suspend/Restore box) shows the **advisory
  authorization** beside account standing, read-only, with a link to Advisers.
  Account suspend/restore still never touch it.
- **Official advisory notes** (new table `advisory_note`): only an approved,
  unsuspended adviser may submit; staff with `content.moderate` or
  `content.publish` may return one with a note; only `content.publish` may
  publish or unpublish (publishing authority is separately assigned). Published
  notes show on the public profile, "Reviewed by CORWADO", only while the
  approval is active. INFERRED: a short text note rather than a library file,
  because library resources require an uploaded file; reviewed at Admin ->
  Advisers. Audit `advisory_note.*`.

## Organisation advice cases (2026-10-28)

DOCUMENTED: the spec's "Requests go directly to the provider's authorized staff"
(infographic 8, "Institution shared inbox"). Migration
`20261028112000_organisation_advice_cases`.

- INFERRED: one advice profile per organisation, kept apart from personal
  profiles (the one-per-account unique replaced by two partial unique indexes,
  one with the same personal meaning), edited by members with `profile.edit` or
  `advisory.handle`.
- INFERRED: the organisation's shared advice inbox is for `advisory.handle`
  holders only (the first reader of that permission), not `inbox.read`.
- INFERRED: any handler may take an unassigned case; only an organisation
  administrator assigns to someone else; only the accepted assignee or an
  administrator replies or closes, and sees the requester's shared details.
  Audit `advice_case.assigned`, `.accepted`, `.released`.
- INFERRED: a profile counts as live while the organisation is published and
  open and has at least one handler. Gaps: no photo links for organisation
  handlers; refer-with-consent not offered from the organisation inbox; inbox
  copy English only; a suspended member still counts towards "live".

## Analytics: commodity and actor-type filters, figures over time, editable Excel charts (2026-10-28)

DOCUMENTED: spec "Measures and exports" requires filters, graphs and editable
Excel charts. INFERRED: commodity = listing_category, so it narrows produce
listings, orders, contact requests and buying requests only; actor type =
account_profile.activities ("What you do"), which reaches accounts, farmers with
a sign-in, account holders and post owners (for an organisation's post, the
person who posted it). Any other figure is served as not measured
("not_filterable") under a filter, never unfiltered; a test holds each figure's
filter flags, its SQL and its definition together. INFERRED: period = day up to
31 days, Monday week up to 184, month beyond; "new" active = first sign-in ever
in that period. OBSERVED: the writer's chart parts read back in the pure tests
(relationships, content types, sheet references, cached values). NOT observed:
opening the file in Excel or LibreOffice -- check one real export before
acceptance. Gap: the commodity filter does not reach services or conversations.

## Owner decisions on announcements and settings (2026-10-28)

The owner answered the OWNER TO CONFIRM items of "Official announcements" and
"Settings, phase 2" (2026-10-27), in writing in the session.

- **Essential announcements: administrators.** Only administrators reach the
  announcement routes (`roles: ['admin']` and `communications.send`), so only
  they can mark one essential. No change in code; recorded as decided.
- **Minimum age for farmer self-registration: 18.** The fallback of
  `registration_recovery.minimum_age_years` is now 18 (it was none). It
  applies from deployment, because no version of that setting had been saved
  (OBSERVED, read-only query of `setting_version`, 2026-10-28). Read from the
  year of birth, generously; registrations by an officer are not affected.
  Still changeable in Settings -> Registration and recovery.
- **Suspension review period and appeal window: 30 days each**, the defaults
  already in place.
- **SMS cost: US$0.221 per part.** The fallback of
  `notifications_moderation.sms_cost_per_segment_usd` is now 0.221, so the
  announcement preview estimates cost; still changeable in Settings.
- **Currency: SSP, as it is.** The owner, 2026-10-28: "just leave as it is, SSP ok".
  Prices stay recorded and shown in South Sudanese pounds; no currency setting.

## Live acceptance fixes for release #214 (2026-10-28)

Found by review on production (OBSERVED, the live acceptance run of 2026-10-28,
evidence in qa-evidence-2026-10-28):

- **Announcements never delivered.** `make_interval(mins => $n)` received a
  bigint parameter, for which Postgres has no `make_interval`, so processing
  answered 500. Every `make_interval(mins => $n)` now casts `$n::int`
  (announcements, email and phone verification). The phone paths had worked
  since #178; the cast is added there too so the class is closed, not the
  route (INFERRED from one failing instance and the identical pattern).
- **A duplicate staff invitation answered 500, not 409.** The unique violation
  arrived as P2010 with code 23505 and no constraint name in the message;
  `isUniqueViolation` now also reads the error's meta.
- **Minimum age with an optional year of birth.** A skipped year is not
  refused: the minimum applies to a year that is given (sign-up stays open).

## A raw-query number is a bigint: cast it where a function wants int (2026-10-29)

Found by damage on production (OBSERVED, reported by the integrator from the
live app): `POST /api/admin/announcements/:id/process` still answered 500 after
#216, with `function left(text, bigint) does not exist` at the in-app batch's
`left(btrim(...), $6)`. Prisma's `$queryRawUnsafe`/`$executeRawUnsafe` send a
JavaScript integer as a bigint parameter (OBSERVED twice: `make_interval` in
#216, `left` here), and Postgres has no implicit bigint-to-integer cast, so any
function whose argument is `integer` has no overload to match.

- The `left` call now casts `$6::int`. A sweep of `apps/web/lib`, `apps/web/app`
  and `scripts` found no other uncast parameter to such a function
  (`make_interval`, `left`, `right`, `substr`, `lpad`, `rpad`, `repeat`,
  `generate_series`, `split_part`, `round`, `trunc` and the others listed in the
  scan). `to_timestamp($n)` is left alone: bigint casts implicitly to double
  precision (DOCUMENTED, Postgres implicit casts; not exercised here).
- `apps/web/tests/sql-int-params-scan.test.ts` reads every server source file
  and fails when one of those functions receives a `$n` not cast on the spot, so
  the class stays closed rather than the route. It reads calls across lines and
  is tested against itself. The rest of the process path (claim, write-back,
  completion) was read: every other parameter is text, uuid, an explicitly cast
  array, or a LIMIT, which accepts bigint (INFERRED from reading; this lane did
  not run the process route against the database).

## Announcements are sent by a scheduled job as well as by the screen (2026-10-29)

Until now an announcement moved on only while an administrator kept its page
open (OBSERVED in code: the page looped `POST .../process`). Now a CRON_SECRET
route, `POST /api/cron/announcements` (fails closed, Bearer secret compared in
constant time, as the weather and expiry-reminder routes), runs the SAME
`processBatch` for every announcement still `sending`, oldest first, one batch
each in turn, starting no batch after 12 seconds of the run (60-second limit:
12 s + the batch's 30 s budget + one 10 s provider call), at most 40 batches.
An announcement whose batch moved nothing (a provider not configured) is not
asked again that run.

- Safe beside the page and beside itself: deliveries are claimed with
  `FOR UPDATE SKIP LOCKED`, and completion is a conditional update (INFERRED
  from the existing claim logic; not exercised concurrently here).
- Audited as actor `system` (`announcement.batch_sent`, `announcement.completed`;
  no new keys).
- Installed by `node --env-file=<env> scripts/announcements-cron-install.mjs`:
  pg_cron every two minutes, secret in Vault as `announcements_cron_secret`,
  `vault.update_secret` executed rather than queried (it returns void), as in
  the other installers.
- The page still drives its own batches ("Continue sending" goes faster); it
  now says sending continues while it is closed.

## A suspension may end by itself (2026-10-29)

CORWADO's Settings line "reason codes, suspension duration and appeals"
(DOCUMENTED, spec.txt line 132). Before this, a suspension had no end, and the
review period and appeal window were only shown (OBSERVED in code).

- **Optional duration when suspending**: `suspend_days`, a whole number from 1
  to 365; empty means no end (the old behaviour). Stored as
  `suspension_ends_at` on the account's farmer and buyer records (migration
  `20261029090000_suspension_duration`, additive; a CHECK refuses an end on a
  disabled or unsuspended record). The end is midnight in Juba at the start of
  the day N days after today in Juba, so "7 days" from 5 November ends on 12
  November.
- **Shown to the person and to staff**: the suspension text message reads
  "suspended until 2026-11-12" (the reason label shortens so it stays one SMS);
  the staff account box shows the end date or "No end date".
- **Lifted daily** by the existing daily job (`POST /api/cron/expiry-reminders`;
  one job, one installer): every account whose end has passed, never a
  disabled one, is restored as staff restore one. Both records are cleared, one
  `account.suspension_expired` audit row is written per record with actor
  `system`, one fixed in-app notice goes out (`suspension_ended`, English and
  Arabic), and the sign-in ban is lifted. The ban is lifted FIRST: while the
  records still say suspended every request is refused anyway, so a half-done
  lift is the safe half; if the sign-in service does not answer, nothing is
  cleared and the next day retries. A record that changed meanwhile is left
  alone, and its ban is put back if it is still suspended.
- Disable clears any end (a disable is permanent); restore and re-enable clear
  it. The column is named `suspension_ends_at`, not `suspended_until`, so it
  cannot be confused with an adviser approval's `suspended_until`.
- New audit key: `account.suspension_expired` (the CHECK is the integrator's).
- Gap: the review period (`suspension_review_days`) is still a reminder to
  staff, not a deadline anything enforces.

## An account's actor types are its declared activities plus the records it holds (2026-10-29)

The overview's actor filter (`/api/admin/overview?actor=`) counted only
accounts whose profile declares the activity (`account_profile.activities`),
so a new account that had not filled in its profile counted as neither farmer
nor buyer (OBSERVED in code; reported as 0 on the live overview). The accounts
list already used a wider rule. One rule now serves both, written once in SQL
(`actorTypesSql`, `apps/web/lib/api/admin-accounts.ts`):

> An account's actor types are the activities it declares on its profile,
> plus `farmer` when it holds a live farmer record and `buyer` when it holds a
> live buyer record. A farmer an officer registered (no sign-in, no profile)
> is a farmer. A post also counts for its organisation's declared activities.

The accounts list shows and filters by it; the overview counts by it. A pure
test holds both to the one expression.

## Tests that failed only on Windows (2026-10-29)

Three pure tests compared paths written with forward slashes, or cut text at a
newline, so on a Windows checkout (backslashes, CRLF) they failed while CI on
Linux passed (OBSERVED on this machine). They now normalise separators to `/`
and line endings to LF before comparing: `provider-secrets`,
`public-route-scan`, and the skip-reason test in
`packages/shared/tests/announcements.test.ts`.

## Arabic coverage (2026-10-29)

Every key in `apps/web/lib/i18n/en.ts` has an Arabic string in `ar.ts`
(OBSERVED: 0 missing after this change, counted by script). Of the user-facing
screens added in #210-#216 in areas that already show Arabic, the
organisation advice inbox (`components/teams/OrganisationAdvice.tsx`, opened
from the farmer's organisation pages) was English only; it now carries its own
English and Arabic words, as the other team pages do. Not translated, because
their areas are English only today: the email sign-up (`BuyerRegister`), the
buyer dashboard and profile, the public organisation page, and product and
market reports. Messages the server sends back stay in English everywhere.

## A suspension of N days lasts at least N full days (2026-10-29)

The owner, 2026-10-29 ("yes fix it"): a suspension made late in the day for
1 day ended at the next Juba midnight -- hours, not a day (OBSERVED in the
live re-check). `suspensionEndsAt` now ends at Juba midnight after N FULL
days; the rest of the day of suspension does not count.

## Staff presets are binding: the role `admin` alone grants no permission (2026-10-30)

Branch `fix/staff-preset-permissions` (lane-perms). Migration
`20261030090000_presets_binding_keep_admin_powers` (DATA ONLY, not applied).

**The defect (OBSERVED on production, client acceptance with the demo
accounts, 2026-10-24).** Every account with the role `admin` held every
permission except Super Admin without any grant (the "legacy rule" of
2026-10-19, above), so Demo Moderator, Demo Support and Demo Administrator
could do the same things: the presets restricted nothing. And the moderation
and support routes declared `roles: ['admin']`, so a supervisor given those
presets was refused at the door. The specification (lines 109-112): presets,
combined roles, "platform-wide moderation/editing does not automatically grant
Super Admin appointment, security changes or sensitive exports", "enforce
permissions in the underlying service, not only by hiding menu items".

**Decided.**

- **Permissions = the union of the person's ACTIVE preset grants**, nothing
  else (`effectivePermissions`, packages/shared). The role still decides which
  routes a person may knock on and, for a supervisor or read-only account, the
  state their data is limited to. A Super Admin grant still counts only on an
  `admin` account. Super Admin keeps every key.
- **Preset routes admit every staff role that can hold the preset, then ask
  for the permission**: reads `admin, supervisor, read_only`; writes
  `admin, supervisor` (read-only accounts create no records, C-3.9). Accounts,
  advisers and advisory notes, announcements and templates, communications,
  corrections, the marketplace console and removed list, product and market
  reports, reason codes, notices and settings, organisations, support cases,
  staff invitations and the audit trail. Routes that asked for nothing before
  now ask: `/api/audit` audit.view; `/api/admin/communications` and its farmer
  picker communications.send; product reports, market reports, buyer review,
  buying requests and orders content.moderate; creating, changing or removing
  a staff or officer account (`/api/users`, `/api/officers` writes)
  staff.manage. Platform-wide routes ask for platform-wide coverage, so a
  state-limited grant does not open them (state scoping intact).
- **Kept to the role `admin`, with the permission on top (INFERRED, open to
  the owner):** the Super Admin routes (superadmin.grant only counts there);
  buyer review, buying requests and orders (the B13 state machines record the
  actor as `admin`; widening them is a separate change); staff and officer
  account writes (national accounts).
- **Kept to the role alone, no preset (INFERRED, OPEN TO THE OWNER):** the
  farmer-registry operations that predate the presets and that no preset
  describes -- reassigning or removing a farmer, removing a farm or a visit,
  directory entries -- plus the role-based programme routes shared with
  supervisors and officers (farmer register, visits, programme reports and the
  farmer-number-only export, live-marketplace withdrawal, market prices).
  Changing any of them would take supervisors' current powers away, which the
  brief said must not happen. `apps/web/tests/preset-permission-scan.test.ts`
  lists the admin-only ones with reasons; a new admin-only route that asks for
  no permission fails it.
- **The nav shows only what the person holds.** Each preset destination
  carries the permissions its routes ask for; the rail reads GET
  /api/admin/staff-access/me for every staff role and hides those destinations
  until the answer arrives. Screens that refused anyone but `admin` now ask
  the same question (`useHolds`).
- **Assignable support staff** are those holding support.handle platform-wide
  (a Support grant, or Super Admin on an admin account), no longer every admin.
- **The library's drafts** are served to whoever may write guides
  (content.moderate or content.publish), no longer to every admin.

**Verified (OBSERVED in code, pure tests).** The Administrator preset is
staff.manage, settings.manage, audit.view, reports.view, communications.send:
no superadmin.grant (appointing Super Admins, resetting two-step sign-in,
ending sessions, re-enabling accounts) and no exports.identifiable. Only
Super Admin carries exports.identifiable, and NO route offers an identifiable
export today: the programme export carries farmer numbers only (C-10.11) and
the analytics workbook aggregates. Any future identifiable export must ask for
that key.

**The rollout, so nobody loses access.** Migration 20261030090000 gives every
ACTIVE administrator with NO active grant three presets, platform-wide:
Administrator + Moderator and Editor + Support -- together exactly what the
legacy rule gave them, less exports.identifiable, which no route asks for (a
pure test asserts the equality). The brief named the Administrator preset;
Administrator alone would have taken moderation, publishing and support away
from them, so all three are given (DECIDED HERE; revoke any of them on Staff
permissions). `granted_by` is the administrator themself (the convention the
Super Admin bootstrap already uses), reason "Kept their powers when presets
became binding (2026-10-30)", each with a `staff.permission_granted` audit row
by `system`. Idempotent. Apply it BEFORE or WITH the code: under the old code
the rows change nothing.

**Who it changes (INFERRED from the staff list in the brief; the database was
not read):** Achiro Aldo and Programme Admin (admin, no grant) each receive the
three presets. Okech Aldo (Super Admin grant) and the demo administrators
(each holding a preset already) are left as they are, so Demo Moderator now
holds moderation only, Demo Support support only, Demo Administrator the
Administrator preset only. Read-only Viewer and the supervisors are not
touched: the legacy rule never gave them anything, so they keep exactly what
their role gives today (the registry, scoped to their state).

## Arabic for the email side (2026-10-29)

Branch `feat/arabic-remaining-screens` (lane-arabic). No migration. Follows
"Arabic coverage (2026-10-29)", which listed these areas as English only.

- **Translated** (OBSERVED by the pure scan `tests/arabic-email-side-scan.test.ts`
  and by type check): the email sign-in (`LoginForm`, buyer audience) and its
  two-step code step; the email sign-up (`BuyerRegister` and the shared
  `ProcurementFields`), including the code step and the terms box; the buyer
  shell, dashboard and shortcut hub, profile (with blocked accounts and delete
  account), notifications with announcements and notification settings; the
  buyer's organisations, advice, messages, public-profile and posts pages
  (those components were already bilingual and were pinned to English); and
  the public organisation page `/organisations/:id`.
- **Where the language comes from (INFERRED design, following the farmer
  side):** one choice per browser, the existing `farmer_lang` cookie and local
  storage (`lib/i18n/client.ts`), read on the server for the first paint. In
  the buyer shell the account's `buyer.preferred_language` wins once on
  arrival; the switch (rail foot and the profile's Language card) changes the
  screen and saves the account's language through `PATCH /api/buyer/profile`
  (`preferred_language`, Zod in packages/shared, audited as `buyer.updated`
  with the changed field name only -- no new audit key). The staff sign-in
  stays English and never turns the page right-to-left.
- **RTL:** each of these pages sets `<html lang dir>` while shown and restores
  it on the way out, as the farmer shell does; the portal shell CSS is logical
  properties throughout, so the rail moves to the right.
- **Reports:** the report dialogs ordinary users see (`ReportPost`, used for
  buying requests, services and public profiles) were already bilingual; no
  screen lists a user's own reports (OBSERVED: none in the code). The product
  and market report queues are the staff portal's and stay English.
- **Left in English, on purpose:** sentences the server sends (validation
  reasons, notification titles and bodies, API errors), the staff portal, and
  the buyer marketplace, cart and purchase-request screens (not in this brief).
- **Test:** `lib/i18n/i18n.test.ts` checks that every English key has a
  non-empty Arabic string with the same placeholders; the new keys are in
  Arabic script; `lib/buyer/labels.test.ts` holds the i18n English of the
  buyer labels to the staff tables word for word.

## One icon per destination on a phone (2026-10-31)

The owner: "in mobile view, there's duplicate icons on the dashboards".

- **What was seen (OBSERVED, production at 390 and 360 px, demo accounts,
  screenshots in qa-evidence-2026-10-31/icons/before):** the buyer and
  organisation menu drew a briefcase for five rows, a bar chart for three, a
  pencil, a chat bubble and a magnifier for two each, and the dashboard grid
  for "Sell produce"; the staff menu drew the briefcase for seven rows and
  repeated the marketplace, desk, mail, chart and document glyphs; the phone
  account's home showed "Buy" twice (shortcut hub and account tiles, same cart
  glyph, same page), "Post produce" beside the hub's "Sell produce" (same
  page), Marketplace and AgriOne AI tiles above the bottom bar's identical
  tabs, and a house for both "Organisations" and "Your farm". The staff
  overview, officer desk and adviser pages showed no duplicate.
- **Fix:** every menu row gets its own glyph (new icons in
  `components/ui/icons.tsx`; `IconKey` gains eleven keys); the buyer top bar's
  notifications icon is a bell, as in the menu, instead of an envelope; the
  home's "Post produce" and "Buy" tiles are removed because the hub above offers
  the same pages; the Marketplace and AgriOne AI tiles are hidden only at the
  width where the bottom bar shows them; the hub's Organisations tile draws a
  building. No destination was removed: every page is still one tap away.
  Labels and aria-labels are unchanged.
- **Guard:** `apps/web/tests/duplicate-icons-scan.test.ts` (pure).

## Only organisations are verified (2026-10-31) — amends "Listings: no verification gate" (2026-10-19) and "Buy from any product page" (2026-10-21)

The owner, 2026-10-31, in writing: **"remove verification from accounts. only
organization needs to be verified by admin and superadmin not individual."**
Branch `feat/organisation-only-verification`; migration
`20261031090000_organisation_verification`, written, NOT applied.

1. **Individual accounts are never verified (DOCUMENTED: the owner's words).**
   A phone account (farmer record) or an individual email account (buyer,
   `account_type = 'individual'`) shows no verified, pending or not-verified
   status to its holder or the public, carries no badge and meets no gate.
   - Removed: the "Verified farmer" badge (`VerifiedFarmerBadge`, deleted) on
     market cards, product pages, the market table and services; the buyer
     marketplace's `supplier.verified` and its "Verified farmer" stamp;
     `farmer_verified` and `seller_verification_status` from the public
     listing reads; the farmer's verification KPI and the "Not verified yet" /
     "Not verified" banners on the farmer overview; the status block on
     `/farmer/account/verification`, which is now "Your record" (number,
     name, payam, joined; the path is kept for old links); the farmer's
     "Verified" profile badge; the individual buyer's "Active" standing stamp.
   - Gates (OBSERVED in the code): listing, buying requests, services,
     messaging, advice and profile publication already had no verification
     gate (2026-10-19, 2026-10-21, 2026-10-22). The one left was a buyer
     organisation's **declined** verification (`rejected`), which closed the
     marketplace; it now withholds the badge only (`buyerCapabilities`).
     Suspension -- account standing, not verification -- still closes it.
   - An individual buyer can no longer be put in `rejected` at all
     (`STANDINGS_FOR.individual` = active or suspended). The database CHECK
     still admits the value for an old row; nothing writes it.
2. **Organisations are verified by staff, as a badge only.**
   - New staff permission `organization.verify`, in the **Administrator** and
     **Super Admin** presets only (packages/shared/src/staff-permissions.ts).
     Organisational administrators cannot hold it (team permissions are a
     separate list; a test asserts it).
   - **Buyer organisations of the business kind** keep their review
     (`buyer_organization.verification_status`): verify, ask for more
     information (`under_review`, the clarification branch, with a note the
     buyer sees), or decline (`rejected`); a verified organisation's badge can
     be withdrawn (`verified -> rejected`) and given again. Verification
     decisions now need `organization.verify`; suspend and restore keep
     `content.moderate`. The list (`GET /api/admin/buyers`) admits either.
     Labels and notices reworded: "Verified organisation", "Not verified",
     "Being checked"; no sentence says buying waits on it.
   - **Organisational profiles** (`organization`, team access) gain
     `verification_status` ('unverified' | 'verified'), `verified_at`,
     `verified_by` (a staff user), `verification_note` (migration above,
     additive, CHECKs: status values; verified implies when and by whom; note
     at most 300). `POST /api/admin/organizations/:id/verification`
     (`{ verified, note }`; a note is required to remove the mark), refused
     on a closed organisation or when nothing changes, audited as
     **`organization.verified`** / **`organization.verification_removed`**.
     Admin → Organisations shows each organisation's verification and the
     Verify / Remove control to holders of the permission.
   - **The badge** "Verified organisation" (`VerifiedOrganisationBadge`, i18n
     `market.verifiedOrganisation`) shows on the public organisation page,
     on buying requests and services posted for an organisation (or by a
     verified business buyer), and on a business buyer's public profile.
     Nothing filters on it.
3. **The extension programme's field record stays (INFERRED reading -- OWNER
   CONFIRMATION NEEDED).** An officer's check of a farmer they registered
   (`verification_event`, `farmer.verification_status`, the view
   `farmer_verified_v`) is kept as an internal programme record, because
   CLAUDE.md's Reporting law says "Reach figures read the verified-only view"
   and the contracted reach reports depend on it. It is shown only on officer
   and staff screens (register, review queue, dossier, reports, the
   communications farmer picker) and is never presented to the person or the
   public as an account verification, nor used to gate anything for them.
   The INFERENCE is that the owner's instruction is about account
   verification as users and the public see it, not the programme's reach
   counting; it rests on one instance (the wording "verified by admin and
   superadmin", which describes staff action on accounts, while the field
   record is an officer's). **Owner to confirm** whether reach reports
   should keep counting only officer-checked farmers.
4. **Admin console.** The accounts list and account page no longer print a
   farmer's field-record status as the account's "verification": a person
   shows their phone confirmation (contact verification, which the
   specification keeps separate) and, for a business buyer, the buyer
   organisation's verification; an individual shows none; an organisational
   profile shows "Verified organisation" / "Organisation not verified".
5. **Owner confirmations.** (a) the reach-report reading in 3; (b) whether a
   state-scoped Administrator grant should verify organisations in its states
   (built: platform-wide grants only); (c) whether "declined" should exist for
   a buyer organisation at all now that it gates nothing (kept: it records
   that CORWADO looked and did not verify).

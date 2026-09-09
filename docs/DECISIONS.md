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

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

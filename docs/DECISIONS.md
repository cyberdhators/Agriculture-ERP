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
one project. Its reference is `xmmxbrxmfgodhpwolrvk`. Its name is
`agri-production`. Everything this repository calls staging — `.env.local`, the
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
migration history, and its credentials have twice left the vault: once in
`.env.local.bak-b2`, recorded above, in a repository that is public, and once
when an account-wide Supabase personal access token was pasted into a chat
session. A database with that history should not be the one holding farmer
records. Production should be born clean.

**Also decided:** rotate that project's database password, and revoke the
personal access token. Both are cheap now and get dearer with every unit.

**What was not built.** Making `scripts/db-reset.mjs` verify the project's
_name_ was considered and rejected. The script holds connection strings, not
names, so the check would need a Management API call and a token — more
credential surface inside a destructive script, to defend a distinction that
disappears once production is simply not on the same account. The protection is
structural instead: production is not created until B11, and its credentials
never go in `.env.local`.

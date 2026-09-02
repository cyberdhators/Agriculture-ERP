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

## B1.6 — Why this file exists

`docs/PROJECT-STATE.md` had grown to 332 lines across six units. It is read at
the start of every session, and a document that long stops being read.

The split: PROJECT-STATE holds what is **true now and must be acted on** and
stays under two pages. This file holds **why**, and may grow without limit
because nobody has to read it to start work.

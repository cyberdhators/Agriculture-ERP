# THE SCRATCH PROJECT — WHAT IT CLOSES, AND WHAT IT NEEDS

Preparation only. **Nothing here has been created and nothing has been signed up
for.** The owner creates the project and places the credentials by his own hand;
no session holds them.

One throwaway Supabase project with PostGIS closes two standing holes that have
no other answer:

1. **Fresh-database migration replay.** The strongest proof available today is
   reading every migration that rebuilds a constraint and comparing key sets by
   eye. That method cannot show the migrations apply cleanly at all — only that
   their text converges. It has already been wrong once in this project's
   history, in exactly the way reading cannot catch.
2. **The C-11.7 restore drill**, which has never run. That claim rests on
   `docs/UNITS.md` and `docs/HANDOFF.md`, not on a query; no query can show the
   absence of a drill.

**The three questions the first draft left open are now decided**, 2026-10-01,
by the owner:

| Decision                                                                | Where     |
| ----------------------------------------------------------------------- | --------- |
| Ownership follows the data in the backup, not the project restored into | section 3 |
| The drill proves our runbook, not the vendor's feature                  | section 4 |
| What the scratch project buys, and what it does not                     | section 5 |

One uncertainty is deliberately left standing and marked as such: Supabase's
current free-tier limits have not been consulted, and no session should claim
them from memory.

---

## 1. WHAT `.env` WOULD NEED — BY VARIABLE NAME ONLY

No values appear here, and none should ever be pasted into a session, a commit or
a chat. Described by shape in words.

`prisma/schema.prisma` reads exactly two connection variables:

| Variable       | What it must point at                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | The scratch project's **transaction pooler**. A PostgreSQL URI. The test configuration appends its own connection and pool timeouts, so none need be written by hand. |
| `DIRECT_URL`   | The scratch project's **session pooler**. A PostgreSQL URI. Migrations and anything needing a session use this one.                                                   |

Shape, in words: both are PostgreSQL URIs — a scheme, a role, a secret, a host
belonging to the scratch project, a port, and the database name. The two differ
in host and port, because they address different poolers of the same project. The
secret segment is the project's database password and belongs only in the
untracked local env file.

**The guards will refuse the scratch project, and that is correct.** Three places
assert that both connection strings identify the _staging_ project reference:
`scripts/db-reset.mjs`, `tests/helpers/principals.ts`, and the staging-only
fixture script. The reference is a committed literal, deliberately, so that a
guard reading its expected value from the same file it is checking cannot approve
whatever it is pointed at.

> Written when each of the three carried its own copy. #108 replaces the three
> copies with one frozen list, `NON_PRODUCTION_PROJECT_REFS`. The property this
> paragraph relies on is unchanged and stronger: the list is closed and written in
> the file, and a second reference can only be added by editing it.

So a replay against the scratch project **must not** be performed by running the
test suite. It is `prisma migrate deploy` against an empty database and nothing
more. Making those guards accept a second reference is a change to three safety
files and is not part of this.

Also required for the **drill** but not for the replay:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — the drill's verify step reads the bucket, and the
restore entry is written through the application.

---

## 2. THE MIGRATION REPLAY

### Sequence

1. Owner creates the scratch project. Region is irrelevant; latency only costs
   minutes here.
2. Enable PostGIS. The first migration is
   `20260902090000_enable_postgis`, which runs
   `CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions`, so the
   `extensions` schema must exist and the role must be allowed to create an
   extension in it. On Supabase both hold by default; on a bare PostgreSQL they
   do not, which is why a local cluster cannot stand in.
3. Point an **untracked** env file at the scratch project — the two variables
   above, nothing else.
4. `pnpm db:migrate` — this is `prisma migrate deploy` under
   `scripts/with-env.mjs`. Thirty-two migrations today.
5. `pnpm schema:check` — compares `prisma/schema.prisma` against the live
   database.
6. Read the audit CHECK from `pg_constraint` and compare its key set against
   `AUDIT_ACTIONS`. `tests/audit-actions-constraint.test.ts` is that comparison,
   but it is inside the suite and the suite will refuse a non-staging reference,
   so for this purpose it is one query.

### What a pass would prove

- Every migration applies, in order, on an empty database — which no amount of
  reading can establish.
- The schema that results matches the model file.
- The final audit CHECK carries every key the code can write. **This is the hole
  that matters**: a CHECK can only be replaced, never extended, so a later
  migration rebuilding it from a stale list silently drops keys. It has happened
  twice. On staging it is invisible, because staging accumulated the keys
  incrementally and the end state looks correct either way.

### What a pass would not prove

- Nothing about staging. A green replay and a healthy staging database are
  independent facts; the two have already diverged once.
- Nothing about data. An empty database exercises no row, so a migration that
  would fail against existing rows passes here.
- Nothing about the restore path, the bucket, or attachment correction.
- Nothing about RLS behaviour under a non-owner role: these migrations enable RLS
  with no policies, and a replay connects as the owner, which bypasses it.

---

## 3. THE RESTORE DRILL (C-11.7)

`docs/RUNBOOK-restore.md` section 4 is the procedure and is authoritative. In
summary: take a manifest of staging, restore a staging backup into the scratch
project, point the env at it, run the verify and correction steps, and record the
date and result in `docs/PROJECT-STATE.md` under B11. It has passed when the
final line reads `verified` and a `system.restored` entry exists in the scratch
project's audit log.

### What a pass would prove

- A backup of this project can actually be restored into a fresh project by
  someone following the runbook, with no session present — which is C-11.8's
  whole point.
- The manifest comparison detects what it claims to.
- Attachment correction works: a restored database refers to objects the bucket
  may not hold, and arrived attachments whose files are absent are marked
  `lost_on_restore`.

### What a pass would not prove

- Anything about a **production** backup. The drill's value is in the procedure,
  not the data.
- Recovery time at production scale. Staging holds a handful of rows.
- That the bucket survives. A database backup does not include it; section 3 of
  the runbook covers that separately and the drill does not test it.

### The ownership distinction, which matters and is easy to lose

**A drill that restores a _production_ backup must run on a project CORWADO
owns.** That is C-11.7's "under CORWADO's name", and the reason is the data: a
production backup carries real farmer records, and those may not land in a
project held in anyone else's account, however temporarily.

**A migration replay against seed or invented data has no such requirement.** It
touches no real record. If the only goal is proving that thirty-two migrations
apply cleanly to an empty database, any throwaway project will do and it can be
deleted the same hour.

**DECIDED 2026-10-01, and it is the owner's reading, recorded as his.**

> **Ownership follows the data in the backup, not the project it is restored
> into.**

C-11.7's "under CORWADO's name" is a rule about where real farmer records may
come to rest. It is satisfied or broken by what is inside the backup, and a
project is not made production-grade by being on the right account nor exempt by
being throwaway. So:

- A drill restoring a **production** backup must run on a project CORWADO owns.
  Non-negotiable, and nothing about the scratch project changes it.
- A drill restoring **staging**, which holds invented data only, may run on a
  throwaway project. The procedure exercised is still C-11.7's; the criterion it
  satisfies is the procedure's, not the production-data one.

This closes the question the earlier draft left open rather than deciding it.
There is no middle case to reason about each time: read the backup, and the
answer follows.

---

## 4. IS THE FREE TIER ENOUGH

**Marked: I cannot answer this from the repository, and I have not consulted
Supabase's current limits.** What the repository establishes:

- `docs/PROJECT-STATE.md` records that the plan's point-in-time recovery is an
  open question and that the free tier takes none of it.
- The same file records that a bucket copy to a second project is recommended and
  not covered by a database backup.
- The database is small: thirty-two migrations, and staging currently holds
  four farmers, two farms, four visits and no attachments.

What follows, with the uncertainty named:

- **For the migration replay, the free tier is almost certainly sufficient.** It
  needs an empty database, PostGIS, and the ability to run DDL. Nothing about
  size, retention or recovery windows is involved.
- **For the restore drill, it depends on the restore mechanism** — and the
  decision below settles which mechanism the drill uses, which settles this. A
  restore from a plain SQL export needs no paid feature. Had the drill been meant
  to exercise the platform's own backup or point-in-time restore, the free tier
  would not offer either and a paid plan would have been required.
- **Free projects pause after a period of inactivity.** If the drill spans days,
  it may need waking. Not a blocker, but it will look like a failure if it is not
  expected.

**DECIDED 2026-10-01.**

> **The drill proves our runbook, not the vendor's feature.**

What C-11.7 exists to establish is that a person holding `docs/RUNBOOK-restore.md`
and a backup file can rebuild this system without a session present, and that the
manifest comparison detects what it claims to. Both of those are **ours**. That
the platform's point-in-time restore works is the platform's claim about its own
product, and running it would test their engineering, not our procedure.

What follows, and each of these is now settled rather than open:

- **A plain SQL export exercises everything the drill is for.** The runbook's
  steps, the manifest comparison, the attachment correction, the `verified` line,
  the `system.restored` audit entry — a restore from an export reaches all of it.
- **The free tier is therefore sufficient for both proofs.** The replay needs an
  empty database with PostGIS; the drill needs the ability to load an export.
  Neither needs retention, recovery windows, or a paid plan.
- **Point-in-time restore is reclassified.** It is no longer a question about how
  the drill should be run. It is a **production-plan** question — whether
  CORWADO's production project carries a plan that offers it, and what recovery
  window the client is buying — and it belongs with the other production-plan
  items in B11, not here.
- **Project pausing still applies.** A free project pauses after inactivity. If
  the drill spans days it may need waking, and that will look like a failure to
  anyone not expecting it.

---

## 5. WHAT THE SCRATCH PROJECT BUYS, AND WHAT IT DOES NOT

**DECIDED 2026-10-01.** Stated plainly, so that nobody later expects more of it
than it can give.

**It can prove that `prisma migrate deploy` applies all thirty-two migrations
cleanly to an empty database.** That is a real hole closed. The strongest proof
available today is reading the migrations that rebuild a constraint and comparing
key sets by eye, and that method has already been wrong once in this project's
history, in exactly the way reading cannot catch. A replay either succeeds or
stops on a line number.

**It cannot run the test suite, and this is by design rather than a limitation to
work around.** `tests/helpers/principals.ts` calls `assertStaging()` inside both
`sweep()` and principal creation, and that guard admits only the staging project
by name — a closed allowlist of committed literals. A scratch project is not on
it and will not be put on it: the helper creates and **deletes** authentication
accounts, and the list exists precisely so that it can only ever do so in one
known place. Pointing the live suite at a scratch project would mean widening the
guard, which is the one thing the guard is for.

So the division is:

| Proof                                           | Where it runs             |
| ----------------------------------------------- | ------------------------- |
| Migrations apply cleanly to an empty database   | the scratch project       |
| The runbook restores a backup without a session | the scratch project       |
| Every behavioural and contract test             | staging, and only staging |
| The pure suite                                  | no database at all        |

**What this means in practice:** a green replay says the schema can be built from
nothing. It says nothing whatever about whether the application behaves. Those
are different questions answered in different places, and a scratch project
answers exactly one of them.

---

## 6. WHAT THIS DOCUMENT DOES NOT DO

It creates nothing. It signs up for nothing. It contains no value, no example
connection string, and no password-shaped segment. The owner creates the project
and places the credentials by his own hand; no session should ever hold them, and
a session that is offered them should decline.

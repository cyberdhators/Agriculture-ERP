# RUNBOOK — BACKUP, RESTORE AND VERIFY (C-11)

For a CORWADO administrator. No engineering session needs to be present. Every
command below is a script in this repository that reads its connection strings
from `.env.local` and from nothing else. Nothing here prints a farmer's data.

Read the whole page before starting. Section 2 is the one you read in an
emergency; sections 0 and 1 are what you do before one.

---

## 0. THE NUMBERS, READ THESE FIRST

**The recovery point** — how much recent work a restore can lose:

| Plan                                   | Recovery point | What that means in the field                    |
| -------------------------------------- | -------------- | ----------------------------------------------- |
| Free tier (as of 2026-09-09)           | **unbounded**  | no backup exists; a lost database is lost       |
| Pro, daily backups                     | up to 24 hours | every visit, registration and boundary uploaded |
|                                        |                | since the last backup is gone, from everywhere  |
| Pro with point-in-time recovery add-on | about 2 min    | at most a few minutes of uploads                |

**Why "from everywhere".** An officer's phone deletes a record the moment the
server acknowledges it. A record acknowledged after the recovery point is gone
from the server by the restore and was already gone from the phone. Nothing
re-sends it. The recovery point is the only lever (C-11.6).

**Production is never on the free tier.** A free project pauses after a week
without traffic, and takes no backups (C-11.9).

**Storage is not in a database backup** (C-11.3). Photographs and recordings
live in the bucket `visit-attachments`. A database restore does not restore
them. Section 2, step 5 corrects the records that point at files which did not
survive; section 3 says how the bucket itself is protected.

---

## 1. BEFORE A BACKUP — TAKE A MANIFEST

Do this on a schedule matching the backup's, and always before a planned
restore. The manifest is a small JSON file of counts and identifiers — no
farmer data — that the verification compares against later.

```
pnpm backup:manifest ~/manifests/production-YYYY-MM-DD.json production
```

Keep manifests somewhere under CORWADO's control. They never go into the
repository, a chat, or a CI artifact (C-11.10).

The platform's backups (Pro plan) are taken by Supabase; see the project's
Database → Backups page. If the plan has no backups, there is nothing to
restore from, and section 2 does not apply: the recovery point is unbounded.

---

## 2. RESTORING — STEP BY STEP

You will need: the manifest from before the backup (section 1); the backup's
identity (its date and time on the Backups page, or the point-in-time you
choose); your own name.

**1. Decide the recovery point.** On the Backups page, pick the backup or the
moment. Write down its date and time exactly, as ISO 8601 — for example
`2026-09-09T02:00:00Z`. This is the recovery point.

**2. Restore, on the dashboard.** Supabase → the project → Database → Backups
→ Restore. Follow the platform's steps. For a drill (section 4), restore into
the scratch project, never into production. Wait until the platform reports
the restore complete.

**3. Point `.env.local` at the restored database.** Copy the connection strings
of the restored project from its dashboard (Settings → Database). The
verification and correction scripts act on whatever `.env.local` points at —
check it twice before step 4.

**4. Verify — reporting only, nothing written yet.**

```
pnpm restore:verify --before ~/manifests/production-YYYY-MM-DD.json
```

Every line is a difference between the manifest and the restored database.
`explained` means the recovery point accounts for it (fewer rows, an earlier
last audit entry). `UNEXPLAINED` means it does not: a missing migration, more
rows than before, a bucket that differs. Do not continue past an unexplained
line without understanding it. Migrations must match exactly: a restored
database with fewer migrations than the manifest was restored from too far
back; one with more was not the database you think.

**5. Correct attachments whose files did not survive** (C-11.3). This marks
every attachment recorded as arrived whose file is absent from the bucket as
failed, `lost_on_restore`, so the visit shows "This file was lost when the
system was restored. Take it again if it still matters." instead of calling a
missing photo safe. One audit entry per corrected attachment, the system's.

```
pnpm restore:verify --before ~/manifests/production-YYYY-MM-DD.json --correct-attachments
```

**6. Record the restore** (C-11.4). This is the one event that removes entries
from the audit log, and it must leave a note saying so. The script writes the
note first and prints `verified` only after the note is in the database.

```
pnpm restore:verify \
  --before ~/manifests/production-YYYY-MM-DD.json \
  --backup "Daily backup 2026-09-09 02:00 UTC" \
  --recovery-point 2026-09-09T02:00:00Z \
  --by "Your Name" \
  --record
```

The note carries the backup identity, the recovery point, your name, the last
audit entry before the gap and the first after it. Anyone reading the audit
log later sees exactly where history was lost and why.

**7. Re-apply what a backup does not carry** — the production checklist in
`docs/PROJECT-STATE.md`, "B11 CHECKLIST": role settings, connection strings in
Vercel, Auth settings, the bucket. A restore of the database restores none of
those.

**8. Tell the officers.** Every record acknowledged between the recovery point
and the restore is gone from the server and from their phones. They will need
to visit again. The export log (`GET /api/reports/exports`) and the audit log
before the gap will tell you what the system knew that it no longer knows.

---

## 3. THE BUCKET

A database backup does not include the bucket. Two things protect the
photographs and recordings:

- **Correction on restore** (section 2, step 5): the record never claims a
  file that is not there. Built.
- **Copying the bucket** to a second private bucket in another CORWADO
  project, or an object store under CORWADO's name, on a schedule matching
  the recovery point. Recommended before production goes live, because a
  field photograph cannot be taken again after the moment has passed. Not yet
  built: it needs a destination account CORWADO must create (no account is
  ever ours) and a scheduled job. Cost: about half a day of script and one
  workflow edit, plus the account.

---

## 4. THE DRILL (C-11.7)

Before any real data exists, once, and again after any change to this runbook:

1. Create a scratch project under CORWADO's name.
2. Take a manifest of staging (section 1).
3. Take a backup of staging (or export it) and restore it into the scratch
   project (section 2, steps 1–2).
4. Point `.env.local` at the scratch project and run steps 4, 5 and 6.
5. The drill has passed when the final line reads `verified` and the
   `system.restored` entry exists in the scratch project's audit log.
6. Record the date and the result in `docs/PROJECT-STATE.md`, B11.
7. Delete the scratch project, or keep it for the next drill; it holds
   invented data only.

Production receives its first migration only after the drill has passed.

---

## 5. IF SOMETHING IN THIS PAGE IS WRONG

Every command here is proved by `tests/backup.test.ts` against staging. If a
command's output does not match this page, the page is out of date, not the
command: open an issue quoting the command and the output, and do not
improvise a restore.

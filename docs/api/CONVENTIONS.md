# API CONVENTIONS

Every API route in this project follows this document. It is written to be
sufficient on its own: a person or session who has never seen the
implementation must be able to write tests against a route from this document
alone. If a rule here is ambiguous, that is a defect in this document — say so
rather than guessing.

`CLAUDE.md` is the law. This document is how the law is applied at the HTTP
boundary.

---

## 1. ROUTE NAMING

- `/api/<resource>`, plural nouns: `/api/farmers`, `/api/cooperatives`.
- Multi-word resources are kebab-case: `/api/extension-visits`.
- Nested resources sit under their parent: `/api/farmers/:id/farms`.
- Actions that are not CRUD are a POST to a verb under the resource:
  `POST /api/farmers/:id/verify`.

---

## 2. HOW A SESSION IS PRESENTED

> **B6.5.** When the sign-in service cannot be consulted — unreachable, a
> deadline of ten seconds, a 5xx or 429 — the answer is `503 auth_unavailable`,
> never `401`. A 401 says the session is bad and sends an officer to re-enter
> credentials that were never wrong; a 503 says try again. The service's own
> 400, 401, 403 and 404 mean the token is not a session and remain `401`.

| Client                       | Credential                             |
| ---------------------------- | -------------------------------------- |
| Web portal                   | Supabase Auth session cookie           |
| Officer mobile app (Flutter) | `Authorization: Bearer <access token>` |

Both resolve to the same Supabase Auth user. **Every route accepts either.** A
route must never require one form specifically.

`requireRole` (built in B3) is the **only** place a session is read. No route
parses a cookie or an `Authorization` header itself. `requireRole` runs before
any data access, in every route, without exception.

**There is no exception.** `/api/_dev/*` carried one while
`/api/_dev/validate-phone` and `/api/_dev/throw` existed; both were deleted in
B3 and the exception went with them, rather than being left standing with
nothing under it.

### 2.1 How an officer's phone becomes a session

An extension officer signs in with a phone number and a password (C-3.7). They
never see or type anything else.

Underneath, the phone is turned into an authentication identifier by a single
function, `officerAuthIdentifier` in `packages/shared`. **Do not "fix" this by
enabling Supabase's Phone provider.** It was verified refusing phone sign-in on
this project, and the decision stands. Its original reason no longer holds:
Supabase's list excluded Africa's Talking, and as of 2026-09-14 our SMS provider
is Bird, which Supabase supports as MessageBird. **The decision is unchanged and
revisiting it is a deliberate act with account migration planned, not a
tidy-up** -- see `docs/DECISIONS.md`, where the changed premise is recorded.

The identifier is never displayed, never typed, and never appears in an error
message. The officer row stores the real E.164 phone.

### 2.2 Test principals

`tests/helpers/principals.ts` creates a real account and row for each role
against staging, signs it in, and returns its tokens; `tests/helpers/request.ts`
calls a route as that principal. Every future test session should use them
rather than inventing its own.

They **create and delete authentication accounts**, so they refuse to run unless
the Supabase URL and the database URL both identify the staging project — the
same guard, for the same reason, as `scripts/db-reset.mjs`. Everything they
create is prefixed `zztest` and swept before and after each run, so a crashed
run leaves residue the next run clears rather than trips over.

---

## 3. SUCCESS SHAPE

Single object:

```json
{ "data": { "id": "...", "name": "..." } }
```

List:

```json
{ "data": [ ... ], "page": { "cursor": "...", "hasMore": true } }
```

Created: **201**, with the created object in `data`.

Never return a bare array. Never return a bare string. `data` is always
present on a success, and is always an object or an array.

---

### 3.2 Warnings sit beside `data`, never inside an error

**Unparked in B5.** A write can succeed and still have something to say. That
is a **warning**, and a warning is not an error: the status is `200` or `201`,
`data` is the record, and `warnings` sits beside it.

```json
{ "data": { "id": "..." }, "warnings": { "duplicates": ["<uuid>", "<uuid>"] } }
```

- `warnings` is present **only when it has something in it**. An empty warning
  is omitted, not sent as `{}` or `[]`.
- It never appears in an error body. A response with `error` has no `warnings`.
- Every key inside it is documented here, with its exact shape. Nothing else
  may appear.

| Key          | Shape                 | Emitted by                                    | Meaning                                                                                                                         |
| ------------ | --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `duplicates` | array of farmer `id`s | `POST /api/farmers`, `PATCH /api/farmers/:id` | Existing farmers that match by phone, or by name and payam (C-5.6). **Ids only.** The caller looks them up. The save succeeded. |

> A warning carries no person. `duplicates` is a list of identifiers, never a
> name, a phone number or a national ID — the same standing rule as errors,
> for the same reason.

### 3.1 Every response is JSON

Every response carries `Content-Type: application/json`, **including every
error**. A caller may parse any response body as JSON without inspecting the
status first.

The two exceptions have no body at all to type, and are described in section
5.3: `OPTIONS` returns `204 No Content`, and a `HEAD` response never carries a
body.

---

## 4. ERROR SHAPE

```json
{ "error": { "code": "...", "message": "...", "fields": { ... } } }
```

- **`code`** — a stable, machine-readable string. Clients branch on this, never
  on `message`. The complete set is in section 5.
- **`message`** — one plain-English sentence. Assume it is shown to an
  extension officer on a phone, in a field, with no support to hand. No stack
  traces, no SQL, no internal identifiers, no class or table names.
- **`fields`** — present **only** on validation errors (`invalid_input`). Maps
  each failing field to a plain-English reason:

```json
{ "phone": "Enter a South Sudan mobile number starting +211." }
```

Every other error omits the `fields` key entirely. It is never present and
empty.

### 4.1 Field keys in `fields`

Dot notation, from the root of the request body.

| Case            | Key              |
| --------------- | ---------------- |
| Top-level field | `"phone"`        |
| Nested object   | `"farm.area"`    |
| Array element   | `"plots.0.name"` |

If one field fails more than one rule, report the first failure only. One field,
one sentence.

### 4.2 Failures against the body as a whole

Some failures belong to no single field — a body that is a string rather than an
object, for example. These are reported under the reserved key `"body"`:

```json
{
  "error": {
    "code": "invalid_input",
    "message": "Some of the information sent was not valid.",
    "fields": { "body": "..." }
  }
}
```

`"body"` is reserved. No request may define a field of its own called `body` at
the top level.

---

## 5. STATUS CODES

Exact. No discretion.

| Status | Code                     | When                                                                                                                     | Emitted today? |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 400    | `invalid_input`          | Input failed validation. Carries `fields`.                                                                               | Yes            |
| 400    | `invalid_json`           | The body could not be parsed as JSON.                                                                                    | Yes            |
| 400    | `invalid_cursor`         | The pagination cursor is unreadable.                                                                                     | Yes            |
| 401    | `unauthenticated`        | No session, expired session, or invalid session.                                                                         | Yes            |
| 403    | `forbidden`              | Authenticated, but this role may not do this.                                                                            | Yes            |
| 404    | `not_found`              | Not found, soft-deleted, **or** outside the caller's scope.                                                              | Yes            |
| 405    | `method_not_allowed`     | The route exists, but does not accept `GET`, `PUT`, `PATCH` or `DELETE`. `OPTIONS` and `HEAD` are different — see 5.3.   | Yes            |
| 409    | `conflict`               | The same client id with a different body (C-9.2); a boundary recorded at the same moment; an attachment not yet arrived. | Yes            |
| 413    | `payload_too_large`      | Body exceeds 1 MB.                                                                                                       | Yes            |
| 415    | `unsupported_media_type` | A request with a body did not send `application/json`.                                                                   | Yes            |
| 422    | `unprocessable`          | Input was valid but violates a business rule.                                                                            | Yes            |
| 500    | `internal_error`         | Unexpected.                                                                                                              | Yes            |
| 503    | `auth_unavailable`       | The sign-in service could not be consulted, so nothing is known about the session. Not a session failure.                | Yes            |

**The "Emitted today?" column is part of the contract.** A code marked _No_ is
documented, agreed and deliberately unreachable — no route can currently produce
it, so no test can currently make it happen. It is parked, not dead, and the
unit named against it is the one that must make it reachable. Every parked code
is also listed in the outstanding items section of `docs/PROJECT-STATE.md`.

### 5.1 Why 404 covers three different situations

An extension officer in Yei who requests a farmer in Juba receives **exactly**
the same response as for a farmer id that has never existed: `404`,
`not_found`, identical message, identical body.

This is deliberate. Returning `403` for "this exists but is not yours" tells
the caller the record exists. Repeated against guessed ids, that reveals which
farmers are registered and roughly how many — a data leak achieved without ever
reading a record.

So the three cases are indistinguishable from outside:

1. The id never existed.
2. The record exists but is soft-deleted.
3. The record exists and is not in the caller's scope.

**Do not "fix" this.** A future session will see 404 where 403 looks more
accurate and be tempted to change it. This is the rule, and this is why.

`403` is for a role that may not perform an **action at all** — an officer
attempting a supervisor-only endpoint. It is never used to signal the existence
of a specific record.

### 5.2 Every message, exactly

Message text is part of the contract, not decoration. A test may assert it
character for character.

| Code                     | Exact message                                                               |
| ------------------------ | --------------------------------------------------------------------------- |
| `invalid_input`          | Some of the information sent was not valid.                                 |
| `invalid_json`           | The request body could not be read.                                         |
| `invalid_cursor`         | The page you asked for could not be found. Start again from the first page. |
| `unauthenticated`        | Sign in to continue.                                                        |
| `forbidden`              | You do not have permission to do this.                                      |
| `not_found`              | That record could not be found.                                             |
| `method_not_allowed`     | That action is not available on this address.                               |
| `conflict`               | That record has already been sent with different details.                   |
| `payload_too_large`      | That request is too large to send.                                          |
| `unsupported_media_type` | Send the request as application/json.                                       |
| `internal_error`         | Something went wrong. Please try again.                                     |
| `auth_unavailable`       | The sign-in service could not be reached. Try again in a moment.            |

None of these is templated. Nothing is interpolated into any of them.

**`unprocessable` (422) is the one exception, and has no entry above.** Its
sentence is written by the business rule that rejected the request, because a
generic sentence would tell an officer nothing they could act on. Each rule
states its own exact sentence in its own unit's documentation when it is built.
B5 emits it: see 5.2.1.

#### 5.2.1 Business-rule sentences (409 and 422)

Section 5.2 says 422 has no generic sentence and each rule states its own. These
are B3's, and they are pinned the same way: a test may assert them character for
character.

| Rule                               | Exact message                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `phone_already_registered`         | That phone number is already registered to another officer.                                                                   |
| `account_already_exists`           | An account already exists for that address.                                                                                   |
| `last_admin_cannot_be_removed`     | This is the only administrator account. Create another administrator before removing this one.                                |
| `last_admin_cannot_be_demoted`     | This is the only administrator account. Create another administrator before changing this one.                                |
| `cannot_remove_own_account`        | You cannot remove your own account.                                                                                           |
| `cannot_change_own_role`           | You cannot change your own role.                                                                                              |
| `payam_not_found`                  | That payam could not be found.                                                                                                |
| `state_not_found`                  | That state could not be found.                                                                                                |
| `consent_required`                 | Consent must be recorded before a farmer can be registered.                                                                   |
| `farmer_already_exists`            | A farmer with that identifier has already been registered with different details. Open it and compare before sending again.   |
| `registering_officer_required`     | Name the extension officer who registered this farmer.                                                                        |
| `registering_officer_not_found`    | The registering officer could not be found in that payam.                                                                     |
| `transition_not_allowed`           | That decision is not available for this record in its current state.                                                          |
| `reason_required`                  | A rejection must carry a reason.                                                                                              |
| `merge_target_not_found`           | The farmer named as the original could not be found.                                                                          |
| `merge_target_not_eligible`        | The farmer named as the original cannot receive a merge.                                                                      |
| `merge_across_states`              | A farmer cannot be merged into a record in another state.                                                                     |
| `boundary_not_closed`              | The boundary does not close: the last point must be the first point again. Go back to where you started and finish the shape. |
| `boundary_crosses_itself`          | The boundary crosses itself. Walk the edge of the plot in one direction without cutting across it.                            |
| `boundary_too_few_points`          | A boundary needs at least four corners. Keep walking to the next corner before you finish.                                    |
| `farm_already_exists`              | A farm with that identifier has already been recorded with different details. Open it and compare before sending again.       |
| `boundary_already_exists`          | A boundary with that identifier has already been recorded with different details. Open it and compare before sending again.   |
| `boundary_recorded_concurrently`   | Another boundary was recorded for this farm and season at the same moment. Load the farm again before re-mapping.             |
| `visit_already_exists`             | A visit with that identifier has already been recorded with different details. Open it and compare before sending again.      |
| `follow_up_not_found`              | The earlier visit could not be found for this farmer. Choose it from this farmer's visits, or leave the link out.             |
| `follow_up_cycle`                  | That earlier visit already follows this one. Choose a visit from before it, or leave the link out.                            |
| `correction_window_closed`         | A day has passed since this visit was received. Ask an administrator to make the correction.                                  |
| `attachment_already_exists`        | An attachment with that identifier has already been declared.                                                                 |
| `attachment_not_arrived`           | The file has not reached the server yet. Keep the phone on with signal and try again in a moment.                             |
| `attachment_already_failed`        | This attachment did not send. Open the visit and send it again.                                                               |
| `attachment_mismatch`              | The file that arrived is not the one declared. Open the visit and send it again.                                              |
| `attachment_grant_expired`         | The upload took too long. Open the visit and send it again.                                                                   |
| `attachment_not_received`          | This attachment has not been received, so there is nothing to open yet.                                                       |
| `reassign_officer_not_found`       | No active officer with that identifier works in this farmer's payam. Choose one who does.                                     |
| `reassign_same_officer`            | This farmer is already with that officer. Nothing to change.                                                                  |
| `resource_file_already_registered` | A learning resource is already registered for that file.                                                                      |

**A route names a rule; it never writes a sentence.** `conflict()` and
`unprocessable()` take a key from this registry, not a string. That is how the
standing rule — never interpolate a farmer's name, phone number or national ID
into an error — stops being a discipline and becomes structural: there is
nowhere for interpolation to go, because the function does not accept text.

Adding a rule means adding a line here and a line in the registry, which a
reviewer sees, rather than a template literal inside a route nobody reads again.

#### 5.2.2 Audit action keys

Every create, update and deactivation appends an `audit_event` row (B4, C-4).
The `action` column takes a **fixed key, never a sentence** (C-4.7). This table
is the complete set; the database's `CHECK` constraint is generated from the
same list, so a key that is not here is refused at the database. Adding one
means editing `AUDIT_ACTIONS` in `packages/shared` and this table in the same
change.

| Action key                       |
| -------------------------------- |
| `user.created`                   |
| `user.updated`                   |
| `user.password_set`              |
| `user.soft_deleted`              |
| `officer.created`                |
| `officer.updated`                |
| `officer.status_changed`         |
| `officer.password_set`           |
| `officer.soft_deleted`           |
| `auth.disabled`                  |
| `auth.disable_failed`            |
| `auth.account_orphaned`          |
| `location.created`               |
| `location.renamed`               |
| `location.soft_deleted`          |
| `farmer.created`                 |
| `farmer.updated`                 |
| `farmer.soft_deleted`            |
| `consent.recorded`               |
| `farmer.verified`                |
| `farmer.rejected`                |
| `farmer.merged`                  |
| `farmer.resubmitted`             |
| `farmer.reassigned`              |
| `farm.created`                   |
| `farm.boundary_added`            |
| `farm.boundary_superseded`       |
| `farm.crops_declared`            |
| `farm.soft_deleted`              |
| `visit.recorded`                 |
| `visit.corrected`                |
| `visit.soft_deleted`             |
| `visit.attachment_declared`      |
| `visit.attachment_arrived`       |
| `visit.attachment_failed`        |
| `visit.attachment_link_issued`   |
| `farm.repointed`                 |
| `visit.repointed`                |
| `report.exported`                |
| `system.restored`                |
| `directory_entry.created`        |
| `directory_entry.updated`        |
| `directory_entry.soft_deleted`   |
| `learning_resource.created`      |
| `learning_resource.updated`      |
| `learning_resource.published`    |
| `learning_resource.soft_deleted` |
| `weather_location.created`       |
| `weather_location.updated`       |
| `weather_location.soft_deleted`  |

`before` and `after` hold **changed fields only**, never whole rows, and never a
password, token, authentication identifier, national id, phone, email, given
name or family name — those are stripped before the row is written, whatever a
caller passes (C-4.6, C-4.7).

#### 5.2.3 Reasons inside `fields`

The `fields` map carries a reason per failing field, not the message above.
These are also exact.

| Situation                               | Exact reason                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A field the request may not send        | This field is not recognised.                                                                   |
| The body is not an object at all        | The request was not sent in the expected form.                                                  |
| Page marker: not text                   | The page marker must be text.                                                                   |
| Phone: nothing entered, or not text     | Enter a mobile number.                                                                          |
| Phone: contains a letter                | A mobile number contains digits only.                                                           |
| Phone: disallowed punctuation           | A mobile number may contain only digits, spaces and hyphens, and may begin with +.              |
| Phone: wrong or missing country code    | Enter a South Sudan mobile number starting +211.                                                |
| Phone: too short                        | A South Sudan mobile number has nine digits after +211. This one has too few.                   |
| Phone: too long                         | A South Sudan mobile number has nine digits after +211. This one has too many.                  |
| Page size: not a number, or blank       | The page size must be a number.                                                                 |
| Page size: has a decimal point          | The page size must be a whole number.                                                           |
| Page size: below one                    | The page size must be at least 1.                                                               |
| Farmer id: missing                      | A registration must carry its identifier.                                                       |
| Farmer id: not a UUID                   | The identifier is not in the expected form.                                                     |
| Given name: missing or blank            | Enter the given name.                                                                           |
| Family name: missing or blank           | Enter the family name.                                                                          |
| Name: over 100 characters               | A name can be at most 100 characters.                                                           |
| Name: digits, symbols or emoji          | A name contains letters, spaces, apostrophes and hyphens only.                                  |
| Sex: not f or m                         | Choose f or m.                                                                                  |
| Year of birth: not a whole number       | The year of birth must be a whole number.                                                       |
| Year of birth: after this year          | The year of birth cannot be in the future.                                                      |
| Year of birth: over 120 years back      | The year of birth cannot be more than 120 years ago.                                            |
| National ID: wrong shape                | A national ID is 6 to 20 characters: digits and capital letters only.                           |
| Payam: missing                          | Choose a payam.                                                                                 |
| Registering officer: not a UUID         | The registering officer is not in the expected form.                                            |
| Consent: not an object                  | Consent must be recorded as an object.                                                          |
| Consent text version: missing           | Record which consent text was read.                                                             |
| Consent text version: over 32 chars     | The consent text version can be at most 32 characters.                                          |
| Consent language: not en or ar-juba     | Choose en or ar-juba for the consent language.                                                  |
| Consent granted: not true or false      | Say whether consent was granted, true or false.                                                 |
| Filter: verification status unknown     | Choose pending, verified or rejected.                                                           |
| Filter: date not ISO 8601               | Give the date as an ISO 8601 timestamp.                                                         |
| Filter: duplicate flag not true/false   | Choose true or false.                                                                           |
| Filter: date range inverted             | The end of the date range is before its start.                                                  |
| Rejection reason: not on the list       | Choose a reason: duplicate, wrong_location, incomplete, not_a_farmer, consent_missing or other. |
| Note: not text                          | The note must be text.                                                                          |
| Note: over 280 characters               | A note can be at most 280 characters.                                                           |
| Note: control characters                | A note contains printable text only.                                                            |
| Merge target: missing                   | Name the farmer this record is a duplicate of.                                                  |
| Merge target: not a UUID                | The target is not in the expected form.                                                         |
| Queue filter: escalated not true/false  | Choose true or false.                                                                           |
| Farm id: missing                        | A farm must carry its identifier.                                                               |
| Farm id: not a UUID                     | The farm identifier is not in the expected form.                                                |
| Season: wrong shape                     | Give the season as a year and a name: 2026-main or 2026-second.                                 |
| GPS accuracy: missing                   | Record the GPS accuracy in metres at capture.                                                   |
| GPS accuracy: not a number of metres    | GPS accuracy is a number of metres, zero or more.                                               |
| Boundary: not a one-ring Polygon        | Send the boundary as a GeoJSON Polygon with one ring.                                           |
| Boundary point: not a pair              | Each boundary point is a pair: longitude, then latitude.                                        |
| Boundary point: out of range            | Longitude is between -180 and 180; latitude between -90 and 90.                                 |
| Boundary: over 2000 points              | A boundary can have at most 2000 points.                                                        |
| Crop: not on the list                   | Choose a crop from the list: sorghum, groundnut, sesame, maize or cowpea.                       |
| Crops: repeated                         | Each crop once per season.                                                                      |
| Crops: not a list                       | Send the crops as a list.                                                                       |
| Visit: no identifier                    | A visit must carry its identifier.                                                              |
| Visit: identifier malformed             | The visit identifier is not in the expected form.                                               |
| Advice: missing or blank                | Write the advice you gave. A visit with no advice is not a visit.                               |
| Advice: over 4000 characters            | The advice is too long to save. Shorten it to about six hundred words.                          |
| Observation: over 4000 characters       | The observation is too long to save. Shorten it to about six hundred words.                     |
| Observation: sent but blank             | Leave the observation out, or write something in it.                                            |
| Topics: none ticked                     | Tick at least one topic the visit covered.                                                      |
| Topic: not on the list                  | Choose the topics from the list.                                                                |
| Topics: repeated                        | Each topic once.                                                                                |
| Duration: not whole minutes 1–1440      | Give the duration as whole minutes, up to a day.                                                |
| Attendance: not a whole number 1–10000  | Give the attendance as a whole number of people.                                                |
| Visited at: not a date and time         | Record when the visit happened as a date and time.                                              |
| Position: not a GeoJSON Point           | Send the position as a GeoJSON Point: longitude, then latitude.                                 |
| Position: out of range                  | Longitude is between -180 and 180; latitude between -90 and 90.                                 |
| GPS accuracy: missing                   | Record the GPS accuracy in metres at capture.                                                   |
| GPS accuracy: negative or absurd        | GPS accuracy is a number of metres, zero or more.                                               |
| Follow-up: identifier malformed         | The earlier visit is not in the expected form.                                                  |
| Correction: changes nothing             | Change at least one thing, or leave the visit as it is.                                         |
| Attachment: identifier malformed        | The attachment identifier is not in the expected form.                                          |
| Attachment: kind not photo or audio     | An attachment is a photo or an audio recording.                                                 |
| Attachment: type not accepted           | Save the photo as JPEG, PNG or WebP, or the recording as M4A, AAC, MP3, OGG or WebM.            |
| Attachment: type does not match kind    | The file type does not match the kind of attachment.                                            |
| Attachment: size not whole bytes        | The file size must be a whole number of bytes.                                                  |
| Photo: over 15 MB                       | This photo is too large to send. Set the camera to a smaller picture size and take it again.    |
| Audio: over 25 MB                       | This recording is too long to send. Record it again in shorter pieces.                          |
| Captured at: not a date and time        | Record when the attachment was captured as a date and time.                                     |
| Visit filter: date malformed            | Give the date as a full date and time with its offset.                                          |
| Visit filter: officer malformed         | The officer identifier is not in the expected form.                                             |
| Reassign: no officer named              | Name the officer who will now work with this farmer.                                            |
| Reassign: officer identifier malformed  | The officer identifier is not in the expected form.                                             |
| Device header malformed                 | The device identifier is 8 to 64 letters, digits, dots, hyphens or underscores.                 |
| Farmer captured at: not a date and time | Record when the registration was captured as a date and time.                                   |
| Farm captured at: not a date and time   | Record when the farm was captured as a date and time.                                           |
| Boundary: identifier malformed          | The boundary identifier is not in the expected form.                                            |
| Report cut-off: not a date              | Give the data cut-off as a date: YYYY-MM-DD.                                                    |
| Report cut-off: in the future           | The data cut-off cannot be after today.                                                         |
| Report period: malformed                | Give the period start and end as full dates and times with their offset.                        |
| Report period: ends before it starts    | The period ends before it starts.                                                               |
| Report season: malformed                | Give the season as a year and a name: 2026-main or 2026-second.                                 |
| Report type: unknown                    | Choose a report: summary or farmers.                                                            |

The key beside each reason is the field name, per section 4.1. An unrecognised
field named `nickname` therefore produces `{ "nickname": "This field is not
recognised." }`.

**No reason is ever generated by the validation library.** Zod's own wording for
such a failure — "Invalid input: expected object, received string" — names
concepts a caller has no use for, and section 4 forbids that register. Every
reason above is written by us and pinned here. A reason that appears in a
response but is not in this table is a defect.

### 5.3 `OPTIONS` and `HEAD` are not covered by the 405 rule

Two methods do not behave as the 405 row describes, because they are not ours to
decide: `OPTIONS` is answered by the framework before our code runs, and `HEAD`
is routed by the framework to the `GET` handler.

| Method    | Returns                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `OPTIONS` | `204 No Content`, with an `Allow` header. No body.                              |
| `HEAD`    | `405`, from the `GET` handler, with no body — `HEAD` responses never carry one. |

The `Allow` header lists the methods the route exports, plus `HEAD` and
`OPTIONS`, which the framework adds. For `/api/_dev/validate-phone`, which
exports all five, the value sent is exactly:

```
Allow: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
```

A route exporting fewer handlers sends a shorter list. Assert against what the
route exports, not against this literal string.

Neither carries the error shape. A test asserts the status, and for `OPTIONS` the
`Allow` header, rather than a JSON payload.

### 5.4 The 500 message is fixed

Exactly this sentence, every time, with no variation:

> Something went wrong. Please try again.

Nothing is interpolated into it. A 500 message that varies with the failure
leaks internal detail eventually — a table name, a constraint, a file path. A
fixed sentence cannot. Diagnostic detail goes to the server log and to Sentry,
never to the client.

---

## 6. LISTS

**Unparked in B3.** `GET /api/users` and `GET /api/officers` are the first list
routes, and every rule below is now exercised by
`tests/scope-and-lifecycle.test.ts`: cursor paging, an unreadable cursor
refused rather than treated as page one, `page` present with `cursor: null` on
the last page, and the `deleted_at` filter through the `_active` views.

- **Cursor pagination on every list endpoint.** No offset pagination anywhere.
- Default page size **50**. Maximum **100**.
- A request for more than 100 is **clamped to 100, not rejected**. Asking for
  too much is not an error.
- A `limit` below 1 is rejected: `400`, `invalid_input`.
- An unreadable cursor is rejected: `400`, `invalid_cursor`. It is **not**
  silently treated as page one — a client whose cursor has been corrupted
  should find out, not silently re-read the first page forever.

  > **Parked until B3, and currently unreachable.** No cursor format exists
  > yet — no route returns a list, so nothing issues a cursor and nothing can
  > judge one unreadable. `paginationSchema` accepts any string today. **A test
  > cannot make `invalid_cursor` happen.** B3 defines the cursor format and must
  > make this code reachable and testable in the same unit. Listed in the
  > outstanding items section of `docs/PROJECT-STATE.md`.

- Every list filters `deleted_at IS NULL`. Soft-deleted rows appear in no list,
  count, export or report.
- Every list is scoped to the caller. An officer sees their own caseload; a
  supervisor sees their assigned state; neither sees beyond it. Scope
  resolution arrives in B3, but the rule is fixed now.

### 6.1 `page` is always present on a list

Including on the last page:

```json
{ "data": [ ... ], "page": { "cursor": null, "hasMore": false } }
```

The `page` key is never omitted. `cursor` is `null` on the last page — never an
empty string, never absent.

### 6.2 Every list has a deterministic sort

Default: **`created_at` descending, then `id` descending** as tiebreak.

An endpoint that sorts differently states its order explicitly in its own
documentation.

> **Why this is a rule and not a preference.** Cursor pagination over an
> undefined order silently skips and repeats rows: two records sharing a
> `created_at` can swap places between requests, so one is returned twice and
> another never. Nothing errors. The result is a farmer missing from a donor
> reach figure, and a number nobody can explain months later.

---

## 7. FORMATS

**Timestamps.** ISO 8601 UTC, with milliseconds, always with a `Z` suffix, in
every request and every response:

```
2026-09-02T13:37:00.000Z
```

Never an offset such as `+03:00`. Never without milliseconds. Never a local
time.

**Unparked in B3.** `created_at` and `last_login_at` on the user and officer
lists are the first timestamps any response carries, and a test asserts the
exact form — four digits, `T`, milliseconds, `Z` — rather than merely that a
date is present.

**Phone numbers.** E.164 in every request and every response:
`+211912345678`. Local format is accepted at the edge and normalised
immediately. A local-format number is never stored and never returned.

Accepted written forms, all normalising to `+211912345678`: `+211912345678`,
`211912345678`, `0912345678`, and any of those written with spaces or hyphens
between the digits. Surrounding whitespace is ignored.

> **Nine bare digits with no country marker are refused**, so `912345678` is an
> error rather than a number. Such a string is either a local number missing its
> leading zero or an international one missing its country code, and accepting it
> would mean guessing which — so the officer is asked to write it in full
> instead.

> Every phone number in this document is fabricated.

**Farmer numbers.** `CE-JUB-000123`: the county code, a hyphen, six digits.
Allocated by the server at registration from a per-county counter, stored as
text, never changed, never re-derived from the county code and never reused
(C-5.4). It is the number on a printed card, so it must survive a county code
being renamed under the I-07 boundary list — which is why it is stored rather
than computed.

**National IDs.** Optional. 6 to 20 characters, digits and capital letters only,
no spaces: `^[0-9A-Z]{6,20}$`.

> **Reserved, and provisional.** No official format for a South Sudan national
> ID is documented anywhere available to this project. This shape is wide
> enough not to refuse a real one and narrow enough to catch a phone number or
> a name typed into the wrong box. It is corrected the day CORWADO supplies the
> format, in `packages/shared` and here, in one change. Returned only to
> administrators and to the officer who registered the farmer; absent, not
> masked, for everyone else (C-5.8).

**Money.** Minor units as integers, with an explicit currency field — never a
float, never a bare number.

```json
{ "amount": 15000, "currency": "SSP" }
```

> **Reserved, and untested.** No route in the project uses money until the
> market information and commodity price modules. This rule is fixed now so
> that nobody invents a second way later. Until those modules exist, no test
> covers it and it is a reservation rather than a verified convention.

---

## 8. VALIDATION

**The API is the single source of validation truth.** Every request body, query
string and route parameter is validated server-side by a Zod schema in
`packages/shared` before it reaches any database call — regardless of what any
client did or claims to have done.

The Flutter officer app implements its own field checks in Dart, so that an
officer with no signal gets immediate feedback instead of discovering a bad
phone number on upload hours later. Those checks are a **convenience, never a
guarantee**. They are not the same code and cannot be: Dart cannot import
TypeScript.

Where the two disagree, **the server wins**, and the client shows the server's
message rather than its own.

> **This alignment is a manual, ongoing obligation.** Nothing enforces that the
> Dart rules and the Zod rules agree. When a rule in `packages/shared` changes,
> the corresponding Dart check must be changed deliberately, in the same unit of
> work. The phone rules are the first case: `phoneSchema` in `packages/shared`
> and the Dart phone check must accept and reject exactly the same strings.

### 8.1 Unknown fields are rejected

A body containing a field the schema does not define is rejected: `400`,
`invalid_input`, with the unknown field named in `fields`. Unknown fields are
**not** stripped.

> **Why rejection rather than stripping.** Stripping is the usual default, and
> it is wrong here. A stripped field means an officer fills something in, the
> request succeeds, and the value silently never saves. That is the one class of
> failure an officer in the field cannot detect: there is no error, and the
> screen says it worked. Rejecting is noisy and correct.
>
> **B9 revisits this for the sync endpoint specifically.** A phone running an
> older app version sending a field the server has since removed is a real case
> there, and rejecting an entire offline batch over it has a very different cost
> from rejecting one interactive form. That decision belongs to B9 and applies
> to the sync endpoint only.

---

## 9. REQUEST BODIES

A request carrying a body is checked in this order, and the first failure is the
one returned:

1. **What it claims to be** — section 9.1, `415`
2. **How big it claims to be** — section 9.2, `413`
3. **Whether it can be read** — `400`, `invalid_json`
4. **Whether it is valid** — `400`, `invalid_input`

The order is fixed so that a request which is wrong in two ways always fails the
same way.

### 9.1 Content type

A request with a body must send `Content-Type: application/json`. Anything else,
or no `Content-Type` header at all, returns `415` with code
`unsupported_media_type` and the message **"Send the request as
application/json."**

Parameters are allowed and ignored, so `application/json; charset=utf-8` is
accepted. The media type is compared case-insensitively.

**A request that sends no body at all is treated the same way.** A bare `POST`
with neither a body nor a `Content-Type` header returns `415`, not `400` — the
header is checked before anything tries to read a body, so a request that never
says what it is fails on that alone. A `POST` that sends
`Content-Type: application/json` but no body gets past this check and fails at
the next one: `400`, `invalid_json`.

### 9.2 Size

Request bodies are capped at **1 MB** across every route in this unit. Over
that: `413`, `payload_too_large`.

> **How the cap is judged, honestly.** It is read from the `Content-Length`
> header — what the request _claims_ its size to be. A request that declines to
> declare a length, such as a chunked upload, is **not** caught by this check and
> will be read in full. This is a known limitation of the B1.4 implementation,
> not an oversight, and it is stated here so nobody tests for a protection that
> is not there.
>
> **B9 replaces this with a real streaming limit** for offline sync batches,
> which must enforce a size while reading rather than trusting a header. B9 also
> sets the sync batch limit separately, and it will be a different number. This
> 1 MB figure does not govern it.

---

## 10. AUDIT

**Every route that creates, updates or deactivates a record writes its audit
row inside the same transaction as the change**, through `audited()` and
`writeAudit()` in `apps/web/lib/api/audit.ts`. `writeAudit` refuses anything
except the client `audited()` hands out — at compile time and at runtime — so a
row cannot be written outside the transaction of its change (C-4.4).

The two exceptions are calls to Supabase Auth, which have no transaction: their
row records the **outcome after the call returns** — `auth.disabled` or
`auth.disable_failed` — in a transaction of its own.

**A deactivation is its own row** (`*.soft_deleted`, `officer.status_changed`),
never folded into an `*.updated`. **A delete writes two rows**: the soft delete
and the auth outcome. **A password change records that it happened, and nothing
else** — `before` and `after` are null.

### 10.1 `GET /api/audit`

Administrators only (C-4.8). Every other role, and no session, is refused with
the documented `403` / `401`.

Filters, all optional, all validated before any query (C-4.9):

| Query parameter   | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `entity_type`     | the kind of record, e.g. `user`, `officer`, `payam` |
| `entity_id`       | one record's id or code                             |
| `actor_id`        | who did it                                          |
| `from`, `to`      | ISO 8601 bounds on `occurred_at`, inclusive         |
| `limit`, `cursor` | per section 6                                       |

Sorted `occurred_at` descending, then `id` descending; cursor-paginated per
section 6. Rows for a soft-deleted record remain readable here after the record
has left every list (C-4.5).

---

## 11. FARMERS

`POST /api/farmers`, `GET /api/farmers`, `GET|PATCH|DELETE /api/farmers/:id`
(C-5, unit B5). Every list rule in section 6 applies. Default sort:
`created_at` descending, `id` descending.

**Who may do what.**

| Route                     | admin                                                            | supervisor | read_only | officer                                                                 |
| ------------------------- | ---------------------------------------------------------------- | ---------- | --------- | ----------------------------------------------------------------------- |
| `POST /api/farmers`       | yes — must name `registered_by`, an active officer in that payam | no         | no        | yes — own payam only; registered as themselves                          |
| `GET /api/farmers`        | all                                                              | own state  | own state | own registrations only                                                  |
| `GET /api/farmers/:id`    | all                                                              | own state  | own state | own registrations; anything else is `404`                               |
| `PATCH /api/farmers/:id`  | yes                                                              | no         | no        | own registrations while `pending`; otherwise `403`; not theirs is `404` |
| `DELETE /api/farmers/:id` | yes                                                              | no         | no        | no                                                                      |

**List filters**, all optional, all in the query string: `verification_status`
(`pending`, `verified`, `rejected`), `payam`, `county`, `sex` (`f`, `m`),
`registered_from` and `registered_to` (ISO 8601, inclusive), `duplicate_flag`
(`true`, `false`), plus `limit` and `cursor`.

**Consent** is sent with the registration as `consent: { text_version,
language, granted }`. Missing, or `granted: false`, is `422 consent_required`:
the input was valid, the rule was not met.

**The client identifier** `id` is mandatory on a registration and is the
farmer's id thereafter. Sending the same `id` twice is `409
farmer_already_exists` — the first registration stands, no second row exists.

**`national_id`** is present in a response only for an administrator and for
the officer who registered that farmer. For anyone else the key is absent.

**Caseload (C-8R, unit B8.5).** A farmer carries two officers:
`registered_by`, the officer who registered them, immutable (C-5.9); and
`caseload_officer_id`, the officer who works them today, set to the
registering officer at creation and moved by `POST /api/farmers/:id/reassign`
(administrator only; body `{ officer_id }`; the new officer active and in the
farmer's payam; the same officer refused as a no-op). Every caseload scope —
farmers, farms, boundaries, crops, visits, the national ID's visibility —
reads `caseload_officer_id`. Farms and visits follow the farmer. When an
officer is set inactive the response carries `unassigned_farmers`, the number
of farmers now without a working officer.

---

## 12. VERIFICATION

`POST /api/farmers/:id/verify`, `/reject`, `/merge`, `/resubmit`;
`GET /api/verification/queue` (C-6, unit B6).

**Who may do what.** Verify, reject and merge: administrator, or a supervisor
of the farmer's state; a farmer outside the supervisor's state is `404`.
Resubmit: the registering officer only, from `rejected` only; anyone else's
farmer is `404`. The queue: administrator (all), supervisor and read_only
(own state). read_only changes nothing.

**The state machine** lives in one module. A decision the record cannot take
in its state is `409 transition_not_allowed`, whatever the route.

**Reject** takes `{ reason_code, note? }`. `reason_code` is one of
`duplicate`, `wrong_location`, `incomplete`, `not_a_farmer`,
`consent_missing`, `other`; missing is `422 reason_required`. `note` is at
most 280 printable characters. **The note is data, not a message**: it is
returned only inside the farmer record, as `rejection: { reason_code, note,
decided_at }`, while the record is rejected; it is never in an error, a
warning, the audit log or error reporting.

**Merge** takes `{ target_id, note? }`. The target must be found in the
caller's scope (`422 merge_target_not_found`), must not be the source, merged,
rejected or soft-deleted (`409 merge_target_not_eligible`), and must be in the
source's state, for every role (`409 merge_across_states`). The source keeps
its row with `merged_into` set and stays readable by id.

**The queue** returns pending farmers oldest first by `pending_since`, each
with `days_waiting`, `escalated` (more than seven days), and `duplicates`, the
matched farmer records the caller may see. Filters: `escalated`, `payam`,
`county`, plus `limit` and `cursor`.

**`pending_since`** is set at registration, reset on resubmission, and never
editable through any route. `days_waiting` is derived from it.

---

## 13. FARMS

`POST|GET /api/farmers/:id/farms`, `GET|DELETE /api/farms/:id`,
`POST|GET /api/farms/:id/boundaries`, `PUT /api/farms/:id/crops`,
`GET /api/farms/geojson` (C-7, unit B7).

**Who may do what.** Create a farm, add or supersede a boundary, declare
crops: an officer with the farmer in their caseload, and nobody else — the
mapping officer column references the officer table, so an administrator
cannot be recorded as a mapper. Read: everyone within scope. Remove:
administrator, softly. The map (`geojson`): administrator and supervisor,
scoped.

**Creating a farm is mapping it**: the body carries the first boundary and
the GPS accuracy at capture. A boundary is a GeoJSON Polygon with one ring;
the shape is judged by the shared schema, and closure, vertex count and
self-crossing by the geometry module, each refusal a pinned sentence above.
Winding is normalised on insert.

**Grades**: good at 10 m or better, poor over 10 to 30, unusable over 30 —
constants in `packages/shared`, the database CHECK generated from them.
Unusable boundaries are saved and excluded from every area total and from
the map.

**History**: a new boundary for a season becomes current and the previous is
kept; `GET …/boundaries` is the history; one current per farm per season is
a database fact, and a race on it is `409 boundary_recorded_concurrently`.

**Visibility** (C-7.8): `boundary`, `centroid` and `gps_accuracy_m` appear
only for administrators and the boundary's mapping officer; for supervisors
and read_only those keys are absent. `area_ha`, `grade`, `season`, crops and
the farmer link are for everyone in scope. The map route is the exception,
by purpose: it is the state's map for supervisors and administrators.

**Seasons**: `YYYY-main` or `YYYY-second`, ours until CORWADO confirms local
names.

---

## 14. MESSAGES FOR A FIELD

The reference for every message an officer will read standing in a field,
from B7 onward: B8's visit validation, B9's sync failures, and whatever
follows. The standard is B7's three boundary refusals:

- "The boundary does not close: the last point must be the first point
  again. Go back to where you started and finish the shape."
- "The boundary crosses itself. Walk the edge of the plot in one direction
  without cutting across it."
- "A boundary needs at least four corners. Keep walking to the next corner
  before you finish."

**The rule.** Name the physical action, never the fault, never the
database's words. Each sentence says what the world looks like and what to
do with the body: walk, go back, keep going. None says "invalid",
"constraint", "polygon", "geometry" or "error". A message that a person
cannot act on where they are standing is not finished. Every such sentence
is a pinned rule key (§5.2.1), so a route names it and never writes it.

---

## 15. VISITS

`POST|GET /api/farmers/:id/visits`, `GET /api/visits`, `GET|PATCH|DELETE
/api/visits/:id`, `GET /api/visits/:id/chain`, `POST|GET
/api/visits/:id/attachments`, `POST …/attachments/:aid/confirm`, `POST
…/attachments/:aid/fail`, `GET …/attachments/:aid/link` (C-8, unit B8).

**Who may do what.** Record a visit, declare, confirm or fail an attachment:
the visit's officer, with the farmer in their caseload, and nobody else —
the officer column references the officer table, so an administrator cannot
be recorded as having visited. Correct: the visit's officer within
twenty-four hours of the SERVER's moment, an administrator at any time.
Remove: administrator, softly. Read, including a read link: everyone within
scope. Any non-removed farmer may be visited, whatever their verification
status.

**Two moments** on every visit: `visited_at` is the device's, `received_at`
the server's. Lists sort and page on `received_at`; the `from`/`to` filters
apply to it; coverage counts it; the correction window runs from it. Both
appear wherever a date appears.

**The substance** — `observation` and `advice` — travels inside the visit
record to everyone in scope, and nowhere else: never in an error, warning or
message; never in the audit log, which records that the advice changed and
not what it said; redacted by the scrubber; covered by the scan.

**Position** (C-8.4): a GeoJSON Point and `gps_accuracy_m`, stored and shown,
not graded. Visible to administrators and the visit's own officer; absent
for supervisors and read_only, as a boundary is (C-7.8).

**Follow-ups** (C-8.3): `follow_up_of` names an earlier visit of the same
farmer that is not removed and does not, followed back, reach this visit.
Each refusal is a sentence in 5.2.1; the database refuses too. `GET …/chain`
returns `earlier` (root first), `visit`, `follow_ups`; a removed earlier
visit is `{ id, removed: true }`.

**Attachments** (C-8.6–C-8.8) are separate records that travel separately.
Declare first: `POST …/attachments` with the id, kind, type, size and capture
moment. The size and type are judged before any grant is issued (photo ≤ 15
MB as JPEG, PNG or WebP; audio ≤ 25 MB as M4A, AAC, MP3, OGG or WebM), so a
file over the ceiling is refused before a byte travels, with a sentence
naming the action. The response carries `upload: { url, token, expires_at }`
— a grant for one object path, ours to expire in fifteen minutes. The phone
uploads to Storage, then `POST …/confirm`; the server checks the object
exists and matches the declared size and type. A mismatch or a late arrival
removes the object and fails the row. Declaring the same id again is "send
it again": a waiting or failed attachment gets a fresh grant; an arrived one
is returned unchanged with no grant. `POST …/fail` is the phone giving up.
Every attachment carries `status` (`waiting`, `arrived`, `failed`) and a
`message` — one fixed sentence per state, naming the action (C-8.7). Failure
codes: `size_mismatch`, `type_mismatch`, `grant_expired`, `device_gave_up`,
and since B11 `lost_on_restore` — the file did not survive a restore of the
database, set by the restore verification, never by a route (C-11.3).
`GET …/link` returns a read link that expires in five minutes, for an
arrived attachment only, and its issuing is audited —
`visit.attachment_link_issued`: who asked, for which attachment, when; never
the link — the one read this system records, because the link outlives the
request. The bucket is private; one server module touches Storage.

**Coverage** is the view `extension_coverage_v`: by state, county, payam and
month of `received_at`, visits to verified farmers and the farmers they
reached, with visits to farmers in any other state counted beside them and
never folded in. Removed visits are in no figure.

---

## 16. SYNC

The server side of offline sync (C-9, unit B9). The officer app is built
against this section and `packages/shared/src/sync.ts`.

**Client ids on every create.** Farmer, farm, boundary (`boundary_id` on the
create-farm body, `id` on add-boundary), visit and attachment declaration all
carry the client's id, required by the shared schema; the route always
sends it. The column's server default remains for writers that predate B9.

**True idempotency (C-9.2).** A retried create whose body matches the stored
record — the fields the client sent, after the schema's normalisation, never
the fields the server set — is `200` with the record. `409` only when the id
matches and the body does not, or the record is outside the caller's scope:
a real conflict, terminal. The 409 sentences say "with different details".

**Seven outcomes (C-9.4, C-9.15)**, in `SYNC_OUTCOME_SPECS`, each with a
device action and a sentence: `retry_later` (5xx, 503; `Retry-After: 60`),
`sign_in_again` (401), `not_yet` (409 `attachment_not_arrived`;
`Retry-After: 10`), `waiting_for_parent` (the device's own hold — never a
server response), `refused` (400, 413, 422; the rule's own sentence),
`left_caseload` (404 on a record the device had acknowledged), `conflict`
(409). `syncOutcomeFor(status, code)` is the mapping. A terminal outcome
never carries `Retry-After`.

**Parent-first (C-9.5).** Farmer → farms, visits; farm → boundaries, crops;
earlier visit → follow-up; visit → attachment row → bytes → confirm. A child
is held on the device until its parent is acknowledged by id.

**The device header (C-9.8).** `x-device-id`, an opaque installation
identifier (8–64 of `[A-Za-z0-9._-]`), on every request from the officer
app. The wrapper validates it (malformed: `400` with the header as the field)
and every audit row written in that request carries it. Rows before B9 carry
null and always will.

**Download (C-9.9).** `GET /api/farmers`, `GET /api/farms` and `GET
/api/visits` take `updated_since` (ISO 8601, the server's moment of last
change, kept current by a trigger for every writer). `GET /api/sync/caseload`
(officers only) returns `as_of` — the server's clock, for the next
`updated_since` — and the ids of every farmer, farm and visit currently in
the caseload; a record the device holds that is absent has left it, and the
device removes it and everything under it, keeping nothing.

**Captured-at (C-9.10).** `captured_at` on farmer and farm: the device's
moment, optional, shown beside `created_at`; null reads "not recorded".

---

## 17. REPORTS

`GET /api/reports/summary`, `POST|GET /api/reports/exports` (C-10, unit B10).

**One builder, two callers (C-10.9).** The dashboard figure and the export run
the same SQL from the same filters — `cutoff` (a date; every "as of" count is
bounded by the server's moment at the end of that day), `from`/`to` (the period
for reach and visits, by the server's moment of receipt), `season` (the land
figures'; the latest present if omitted), `state`, `county`, `payam`
(narrowing within scope, never beyond it).

**What the figures are.** `farmers` by status — verified, pending, rejected,
merged — never folded (C-10.3). `reach.farmers_reached`: distinct verified
farmers with at least one visit in the period, computed from visits, never
summed from the monthly view (C-10.2, C-10.7); `visits` beside it;
`other_farmers_visited` for the rest. `land`: mapped farms and hectares of
current, usable boundaries in the season, read through the farmer, located by
the **farm's** payam; people are located by the farmer's (C-10.4's note).
`by`: sex, age band, state, county, payam — verified and reached — and crop,
a farmer once per crop with at least one farm declaring it (C-10.6). `notes`
carry the three sentences a report must show (verified-only, age approximate,
crop rows do not sum).

**Scope (C-10.10).** Officer: caseload. Supervisor and read_only: state.
Administrator: all.

**Exports (C-10.8).** `POST /api/reports/exports` with `report_type`
(`summary` or `farmers`) and `filters` runs the report and logs it in
`report_export`: who, the SQL as it ran with its parameters inlined, the
filters, the scope, the cut-off, the row count; audited as `report.exported`.
Administrators and supervisors; a read-only user reads the dashboard and
creates no record (C-3.9). The farmer list carries farmer numbers only, never
a name, phone or national ID (C-10.11). `GET /api/reports/exports` is the
log, newest first: an administrator sees all, a supervisor their state's.

**A merge moves the land and the visits.** Since B10 a merge repoints the
source's farms and visits to the survivor inside the merge transaction, one
audit entry per moved record (`farm.repointed`, `visit.repointed`), and the
merge's own entry names both payams when they differ. A farm keeps its own
payam: that is where the plot is.

## 18. WEATHER (C-16)

The tile only: current conditions and a short daily forecast for the locations a
caller may see. The agreed shape is `docs/api/weather-contract.md`; this section
records what a session building against the routes must know that the contract
does not say.

**One route, no parameters.** `GET /api/weather`. What a caller sees is decided
by role and scope alone: admin every location; supervisor and read_only their
state; **an officer their own county** — weather is about where an officer
works, and locations are county-level to start (C-16.13), so payam scoping
would show most officers nothing.

**Empty is a success.** A caller with no locations receives `200` and
`"data": []`. Never `404`, never an error. On the day this ships that is true
for nine of ten states.

**No route ever fetches (C-16.6).** Reads read the cache. `pnpm weather:fetch`
fills it, paced under the free plan's 60 calls per minute, one fetch per active
location per day, skipping any location fetched within the last hour
(C-16.7's floor). A retried fetch upserts on `(location, forecast_for)` and
`(location, fetched_on)`, so it produces no duplicate rows.

**Stale is served, with the real time (C-16.7).** `fetched_at` is always the
fetch's own moment, never `now()`. A row older than 26 hours is served with
`stale: true` rather than withheld: a tile that vanishes when the provider is
down is worse than one that says when it last knew something.

**Forecasts are numbers (C-16.1).** Daily rows are aggregated in the location's
own timezone from the provider's three-hour slots, starting tomorrow, by
`aggregateDaily` in `packages/shared/src/weather.ts`: max and min temperature,
rain summed, probability as the day's maximum, humidity averaged, wind as the
day's maximum in km/h, conditions as the most frequent description, the icon
from the slot nearest local midday. The slots themselves are kept in `raw`.

**Attribution is in the payload (C-16.10).** `attribution` is always present
with the same shape, so the server owns the wording of a licence condition and a
screen cannot quietly drop it.

**Audit (C-16.11).** Creating, updating or soft-deleting a `weather_location`
appends `weather_location.created`, `.updated` or `.soft_deleted`. **A fetch
does not audit.** It is a scheduled read of a third party, not a person's action
on a record, and one row per location per day would bury the log it belongs to.

**Three tables, not two.** C-16.1 said two, from §8's shape. Current conditions
have a different shape from a daily forecast and a fetch must not look like an
edit to a location, so they live in `weather_observation` — one row per
location per day, upserted — rather than as columns on the location row or as a
forecast row for today. Recorded as a divergence from the criterion's count, not
its substance.

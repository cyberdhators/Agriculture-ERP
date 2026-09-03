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
enabling Supabase's Phone provider**: it requires an SMS provider from a fixed
list that does not include Africa's Talking, our contracted provider, and it was
verified refusing phone sign-in on this project. Full reasoning, and the rules
the identifier comes with, are in `docs/DECISIONS.md`.

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

| Status | Code                     | When                                                                                                                   | Emitted today? |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------- |
| 400    | `invalid_input`          | Input failed validation. Carries `fields`.                                                                             | Yes            |
| 400    | `invalid_json`           | The body could not be parsed as JSON.                                                                                  | Yes            |
| 400    | `invalid_cursor`         | The pagination cursor is unreadable.                                                                                   | Yes            |
| 401    | `unauthenticated`        | No session, expired session, or invalid session.                                                                       | Yes            |
| 403    | `forbidden`              | Authenticated, but this role may not do this.                                                                          | Yes            |
| 404    | `not_found`              | Not found, soft-deleted, **or** outside the caller's scope.                                                            | Yes            |
| 405    | `method_not_allowed`     | The route exists, but does not accept `GET`, `PUT`, `PATCH` or `DELETE`. `OPTIONS` and `HEAD` are different — see 5.3. | Yes            |
| 409    | `conflict`               | E.g. the same client UUID submitted with a different payload.                                                          | **No — B2**    |
| 413    | `payload_too_large`      | Body exceeds 1 MB.                                                                                                     | Yes            |
| 415    | `unsupported_media_type` | A request with a body did not send `application/json`.                                                                 | Yes            |
| 422    | `unprocessable`          | Input was valid but violates a business rule.                                                                          | Yes            |
| 500    | `internal_error`         | Unexpected.                                                                                                            | Yes            |

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

None of these is templated. Nothing is interpolated into any of them.

**`unprocessable` (422) is the one exception, and has no entry above.** Its
sentence is written by the business rule that rejected the request, because a
generic sentence would tell an officer nothing they could act on. Each rule
states its own exact sentence in its own unit's documentation when it is built.
No route emits 422 today.

#### 5.2.1 Business-rule sentences (409 and 422)

Section 5.2 says 422 has no generic sentence and each rule states its own. These
are B3's, and they are pinned the same way: a test may assert them character for
character.

| Rule                           | Exact message                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `phone_already_registered`     | That phone number is already registered to another officer.                                    |
| `account_already_exists`       | An account already exists for that address.                                                    |
| `last_admin_cannot_be_removed` | This is the only administrator account. Create another administrator before removing this one. |
| `last_admin_cannot_be_demoted` | This is the only administrator account. Create another administrator before changing this one. |
| `cannot_remove_own_account`    | You cannot remove your own account.                                                            |
| `cannot_change_own_role`       | You cannot change your own role.                                                               |
| `payam_not_found`              | That payam could not be found.                                                                 |
| `state_not_found`              | That state could not be found.                                                                 |

**A route names a rule; it never writes a sentence.** `conflict()` and
`unprocessable()` take a key from this registry, not a string. That is how the
standing rule — never interpolate a farmer's name, phone number or national ID
into an error — stops being a discipline and becomes structural: there is
nowhere for interpolation to go, because the function does not accept text.

Adding a rule means adding a line here and a line in the registry, which a
reviewer sees, rather than a template literal inside a route nobody reads again.

#### 5.2.2 Reasons inside `fields`

The `fields` map carries a reason per failing field, not the message above.
These are also exact.

| Situation                            | Exact reason                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| A field the request may not send     | This field is not recognised.                                                      |
| The body is not an object at all     | The request was not sent in the expected form.                                     |
| Page marker: not text                | The page marker must be text.                                                      |
| Phone: nothing entered, or not text  | Enter a mobile number.                                                             |
| Phone: contains a letter             | A mobile number contains digits only.                                              |
| Phone: disallowed punctuation        | A mobile number may contain only digits, spaces and hyphens, and may begin with +. |
| Phone: wrong or missing country code | Enter a South Sudan mobile number starting +211.                                   |
| Phone: too short                     | A South Sudan mobile number has nine digits after +211. This one has too few.      |
| Phone: too long                      | A South Sudan mobile number has nine digits after +211. This one has too many.     |
| Page size: not a number, or blank    | The page size must be a number.                                                    |
| Page size: has a decimal point       | The page size must be a whole number.                                              |
| Page size: below one                 | The page size must be at least 1.                                                  |

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

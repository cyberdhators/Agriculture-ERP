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

> **One temporary exception, enumerated.** Routes under `/api/_dev/*` are
> unauthenticated scaffolding that exist to prove wiring before `requireRole`
> exists. Every such route is listed in the outstanding items section of
> `docs/PROJECT-STATE.md` and is deleted in B3. When that list is empty this
> exception is removed from this document. No route outside `/api/_dev/*` may
> use this exception, and no new `_dev` route may be added without being added
> to that list in the same change.

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

---

## 5. STATUS CODES

Exact. No discretion.

| Status | Code                 | When                                                          |
| ------ | -------------------- | ------------------------------------------------------------- |
| 400    | `invalid_input`      | Input failed validation. Carries `fields`.                    |
| 400    | `invalid_json`       | The body could not be parsed as JSON.                         |
| 400    | `invalid_cursor`     | The pagination cursor is unreadable.                          |
| 401    | `unauthenticated`    | No session, expired session, or invalid session.              |
| 403    | `forbidden`          | Authenticated, but this role may not do this.                 |
| 404    | `not_found`          | Not found, soft-deleted, **or** outside the caller's scope.   |
| 405    | `method_not_allowed` | The route exists; this HTTP method does not.                  |
| 409    | `conflict`           | E.g. the same client UUID submitted with a different payload. |
| 413    | `payload_too_large`  | Body exceeds 1 MB.                                            |
| 422    | `unprocessable`      | Input was valid but violates a business rule.                 |
| 500    | `internal_error`     | Unexpected.                                                   |

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

### 5.2 The 500 message is fixed

Exactly this sentence, every time, with no variation:

> Something went wrong. Please try again.

Nothing is interpolated into it. A 500 message that varies with the failure
leaks internal detail eventually — a table name, a constraint, a file path. A
fixed sentence cannot. Diagnostic detail goes to the server log and to Sentry,
never to the client.

---

## 6. LISTS

- **Cursor pagination on every list endpoint.** No offset pagination anywhere.
- Default page size **50**. Maximum **100**.
- A request for more than 100 is **clamped to 100, not rejected**. Asking for
  too much is not an error.
- A `limit` below 1 is rejected: `400`, `invalid_input`.
- An unreadable cursor is rejected: `400`, `invalid_cursor`. It is **not**
  silently treated as page one — a client whose cursor has been corrupted
  should find out, not silently re-read the first page forever.
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

**Phone numbers.** E.164 in every request and every response:
`+211915562087`. Local format is accepted at the edge and normalised
immediately. A local-format number is never stored and never returned.

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

## 9. REQUEST LIMITS

Request bodies are capped at **1 MB** across every route in this unit. Over
that: `413`, `payload_too_large`.

> B9 sets the offline sync batch limit separately, and it will be a different
> number. This 1 MB figure does not govern it.

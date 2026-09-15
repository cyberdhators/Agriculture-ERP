# The contact-request route contract — proposed before either half exists

**For Monkon / Lane 1, from Alieu / Lane 2. The screens are built against
this; Lane 1 builds the routes to it, or says in `docs/HANDOFF.md` what is
wrong with it first.** Proposed 2026-09-15. Not yet agreed by the owner or
by Lane 1; nothing below is an assumption either side may act on until it is.

**Why it exists.** Deliverable (g), buyer–seller matching, is defined by the
Inception Report as an introduction recorded by staff. Buyers hold no account
(DECISIONS, 2026-09-09). The scope's marketplace amendment chose option 2 for
how a buyer reaches a farmer: a contact request the programme passes on, so
the farmer's phone never leaves it. This is that request, as data.

---

## 1. The three routes

```
POST  /api/listings/:id/contact-requests      a buyer, NO session
GET   /api/contact-requests                    staff, scoped
PATCH /api/contact-requests/:id                officer or admin
```

### POST /api/listings/:id/contact-requests — the buyer asks

The first unauthenticated write in this system. That is deliberate and the
part most worth Lane 1's disagreement.

Body, validated by a Zod schema in `packages/shared` that the form already
mirrors (`apps/web/lib/contact/validate.ts`):

```json
{
  "buyer_name": "Deng Majok",
  "buyer_phone": "+211926004400",
  "quantity": "3 bags",
  "message": "Can collect Saturday"
}
```

- `buyer_name`: 2–80 characters, trimmed.
- `buyer_phone`: a South Sudan mobile, E.164 (`phoneSchema`).
- `quantity`: optional, ≤ 40 characters. Free text on purpose: "3 bags",
  "20 litres a week".
- `message`: optional, ≤ 300 characters.

Response `201`:

```json
{ "data": { "id": "…", "status": "new", "created_at": "2026-09-15T09:40:00Z" } }
```

Nothing about the farmer comes back. Not a name, not a phone, not the
farmer id. The buyer learns the outcome from the officer's call.

Refusals: `404` if the listing is not `listed` (a buyer must not learn that a
withdrawn listing exists); `422` on the schema; `429` on rate limit. **Rate
limiting is Lane 1's to design**: something like ten requests per phone per
day and thirty per IP per hour. A buyer who is refused sees the fixed sentence.

### GET /api/contact-requests — staff read

Scoped exactly as the farmer routes are: an officer sees requests for the
farmers in their caseload (`caseload_officer_id`), a supervisor or read-only
user their state, an admin all. Query: `status` (default `new`), `cursor`,
`limit`. Sorted newest first.

Each row:

```json
{
  "id": "…",
  "listing_id": "…",
  "farmer_id": "…",
  "buyer_name": "Deng Majok",
  "buyer_phone": "+211926004400",
  "quantity": "3 bags",
  "message": "Can collect Saturday",
  "status": "new",
  "note": null,
  "created_at": "…",
  "handled_at": null,
  "handled_by": null
}
```

The farmer's own details are not on the row: the screen joins them from the
farmer routes the caller may already read.

### PATCH /api/contact-requests/:id — the officer records the outcome

Body: `{ "status": "introduced" | "declined" | "no_answer", "note"?: string }`.
Only from `new`. Sets `handled_at` and `handled_by` (the principal). Audited
as `contact_request.handled` with before/after status. An officer may handle
only their caseload's; an admin any.

---

## 2. The table

`contact_request`: `id`, `listing_id` (FK), `farmer_id` (FK, denormalised from
the listing at insert so a reassignment or a listing edit does not orphan the
row), `buyer_name`, `buyer_phone`, `quantity`, `message`, `status` (enum
`new | introduced | declined | no_answer`), `note`, `created_at`,
`handled_at`, `handled_by` (FK officer or user, nullable), `deleted_at`.
Soft delete only. The buyer's phone is personal data: it is scrubbed from
logs like a farmer's, and it is never exported (C-10.11 applies).

This needs the `produce_listing` table, which does not exist yet. The order
is therefore: listing table and routes → this. The screens hold a preview
store until then.

---

## 3. What the farmer sees, later

The farmer's Home shows their requests and each one's status. That read
needs the farmer principal (audit, root cause 1). Until it exists the Home
reads the preview store; the shape above is what the farmer route serves.

---

## 4. Three things the routes will never do

- **Never return the farmer's phone to a buyer.** Not on create, not on any
  public read. There is no public read.
- **Never notify anyone by themselves.** When deliverable (n) exists, a new
  request sends the officer an SMS and the outcome sends the buyer one. That
  is (n)'s to add; these routes only write rows.
- **Never let a buyer see whether a farmer declined.** The buyer's side of
  the outcome is the officer's call, in words, not a status.

---

## 5. Open questions for Lane 1 and the owner

1. Is an unauthenticated POST acceptable, with rate limiting, or must a buyer
   first pass a challenge? The scope says buyers hold no account; it does
   not say they hold no friction.
2. Should a request expire (say 14 days unhandled → `expired`), so the
   officer's queue cannot grow without bound?
3. Does the officer's queue need the farmer's phone on the row (saves a
   click) or is the join enough?

If any answer changes the shape, change this file first and the screens
follow.

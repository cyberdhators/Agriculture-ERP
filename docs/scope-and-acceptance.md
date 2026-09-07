# SCOPE AND ACCEPTANCE

Derived from the approved Inception Report, section 5, which is the contractual
scope baseline for this assignment. That report is the contract; this file makes
it testable.

**Where this file and the Inception Report disagree, the report wins and this
file is corrected.** Nothing may be added here that is not traceable to a
deliverable in section 5, or to a matter confirmed in section 4, or to an input
in section 6.

## How to read this file

Criteria are grouped by contracted deliverable, using the Terms of Reference
lettering, (a) to (t). Each criterion is one testable statement naming an actor,
an action, and where relevant what is forbidden.

Some criteria groups are **supporting components** rather than deliverables:
infrastructure that a deliverable requires but that the contract does not name
separately. These are marked as such and advance no deliverable on their own. A
session must not report them as contract progress.

---

## THE TWENTY CONTRACTED DELIVERABLES

Recorded here so any session can see the whole obligation without reading the
Inception Report.

| Ref | Deliverable | Classification |
| --- | --- | --- |
| (a) | Web-based administration portal | Included |
| (b) | Android mobile application | Included |
| (c) | Farmer registration and profiling | Included |
| (d) | Extension services | Included |
| (e) | Climate information and weather advisory | Included |
| (f) | Market information system | Included |
| (g) | Buyer–seller matching | Included |
| (h) | Commodity price information | Included |
| (i) | Agro-dealer directory | Included as directory |
| (j) | Input supplier directory | Included as directory |
| (k) | Financial services and digital finance | Included as directory |
| (l) | Cooperative and producer group management | Included |
| (m) | Digital learning resource centre | Included as library |
| (n) | SMS notification system | Included |
| (o) | WhatsApp integration | **Conditional** — Meta business verification |
| (p) | Interactive user dashboard | Included |
| (q) | Reporting and analytics dashboard | Included |
| (r) | User administration | Included |
| (s) | System security features | Included |
| (t) | Backup and disaster recovery | Included |

**Included as directory / as library** means maintained reference information,
not a transactional system. (k) holds, transfers and lends nothing. (m) is a
repository, not a course or examination system.

## Not in this phase

From Inception Report section 5.1. Do not build these, and stop and ask if a
requirement appears to need them.

- A farmer-facing mobile application. The Android app is the extension
  officers' tool; farmers are reached by SMS (F-05).
- Mobile money transaction integration.
- Automated market price feeds. Prices are entered manually by CORWADO's
  System Administrator (F-01).
- Voice and audio advisories.
- Additional interface languages beyond what CORWADO supplies as translated
  text.

---

## C-2 — LOCATION HIERARCHY

**Supporting component. Advances no deliverable on its own.**

Required by (c), because every farmer, farm and visit is located within an
administrative area, and by (p), (q) and (r), which filter and scope by it.

Source: Inception Report input I-07, "administrative boundary lists for project
areas", due from CORWADO on day 12. Inception Report section 2 requires that an
extension officer can register a farmer in the field without a network
connection, which is why the hierarchy must be present on the device.

Until I-07 arrives, seed data is placeholder and must be visibly marked as such.

C-2.1  The hierarchy has exactly three levels, state, county and payam, in that
       order of containment, matching the administrative boundary lists CORWADO
       supplies under I-07.

C-2.2  The complete hierarchy is available on an officer's device so that
       registering a farmer and selecting their location never requires a
       network connection.

C-2.3  Every payam belongs to exactly one county, and every county to exactly
       one state. A payam also carries its state directly, and that value always
       equals the state of its county. The database enforces this; it is not
       left to the application to remember.

C-2.4  The complete hierarchy is available as a single file carrying a version
       identifier that changes when, and only when, the content changes.

C-2.5  A device holding a version identifier can determine whether the
       hierarchy has changed without downloading the file.

C-2.6  Reseeding from an updated source adds locations that are new and updates
       names that have changed, without altering any row that has not changed.

C-2.7  Reseeding refuses to remove any location that other records depend on. On
       refusal it changes nothing and names what it refused and why.

C-2.8  Location names are stored and returned exactly as supplied, including
       non-Latin characters.

### Notes for the builder

Codes are the primary keys, not generated identifiers. Location codes appear in
donor exports, where CE-JUB is meaningful and a UUID is not.

Removal under C-2.7 is soft deletion, consistent with the deletion law in
CLAUDE.md §4. A consequence to accept deliberately: a location code can never be
reused, because the soft-deleted row still holds it.

C-2.5 requires a route, and no route may exist before requireRole (B3). B2 may
mark C-2.4 partially met and C-2.5 not met, and record both as B3 opening tasks.

---

## C-3 — IDENTITY, ROLES AND PERMISSIONS

Deliverables: (r) user administration, (s) system security features

C-3.1  CORWADO administrators create, modify and deactivate staff accounts and
       extension officer accounts. There is no self-signup.

C-3.2  Every account holds exactly one role: admin, supervisor, read_only, or
       extension officer.

C-3.3  Every request is authenticated and its role checked on the server before
       any data is read or written.

C-3.4  A supervisor or read_only user sees only records within their assigned
       state. An extension officer sees only their own caseload.

C-3.5  A request for a record outside the caller's scope is indistinguishable
       from a request for a record that does not exist.

C-3.6  Deactivating an account ends its access immediately, including any
       session already open. An account is deactivated either by an
       administrator setting its status to inactive, or by soft deletion. Both
       end access immediately and by the same mechanism; there are not two
       kinds of not-active.

C-3.7  Extension officers authenticate by phone number and password and remain
       authenticated across periods without network coverage.

C-3.8  Farmers do not authenticate. No farmer account exists in this phase.

C-3.9  A read_only user cannot write anything. It is a reporting role: it reads
       within its assigned state, and every route that writes rejects it.

### Notes for the builder

**A null scope must never mean "everything".** A supervisor or read_only account
must have an assigned state, and an admin must not; the database enforces this
rather than the application remembering it. An account with no state sees
nothing, never everything.

**An officer's caseload is the records they registered**, not every record in
their payam. The payam in an officer's scope exists so that they can only create
records in their own payam — it is not a reading permission.

**Passwords.** An administrator sets any account's password. Any account may
change its own. No account may change another's, except an administrator.

**The last administrator cannot be removed or demoted**, by anyone including
themselves. Locking CORWADO out of their own system is not something this team
can recover for them.
## C-4 — AUDIT LOG

Deliverable: (s) system security features

Inception Report wording: "Authentication, role based access, encryption of
personal data, non editable audit log."

C-4.1  Every create, update and deactivation of a record is recorded, with what
       changed, who did it, and when.

C-4.2  A recorded entry cannot be altered or removed by the application through
       any code path.

C-4.3  An entry identifies its actor, including where the actor is an automated
       process rather than a person.

C-4.4  A change and its audit entry succeed or fail together. A failed change
       leaves no entry, and a recorded entry always corresponds to a change
       that happened.

       Note: two writes in this system are calls to an external authentication
       service and have no transaction. For those, the entry records the
       outcome after the call returns, and a separate action key records
       failure.

C-4.5  Deactivating a record does not remove its history. History remains
       readable after the record has left every list.

C-4.6  Entries never contain a password, a token, or an authentication
       identifier.

C-4.7  Entries never contain a farmer's name, phone number or national ID in
       free text. Actions are recorded as fixed keys.

C-4.8  Only administrators can read the audit log.

C-4.9  The log can be filtered by record, by actor and by date range.

---

## C-5 — FARMER REGISTRATION AND PROFILING

Deliverable: (c) farmer registration and profiling. Unit B5.

Inception Report wording, section 5 (c): farmer registration and profiling.
Shapes from `docs/data-model.md` section 1 (`farmer`, `consent`), section 3
*Conflicts and duplicates*, and `docs/data-model-extension.md` §1.3, §1.4 and
§10. Farmers are reached by SMS and do not use the system themselves (F-05;
section 5.1 excludes a farmer-facing application).

**Scoped to exclude farm boundary mapping**, which is part of deliverable (c)
but has its own section, C-7, and its own unit, B7. Verification, approval,
rejection and merging are C-6. Nothing here is farmer-facing.

This is the first section under which real personal data enters the system.
The people it describes did not choose to be in a database and cannot ask us
to correct it.

C-5.1  An extension officer registers a farmer in the officer's own payam, and
       that farmer is in the officer's caseload. An administrator registers a
       farmer by naming the registering officer, who must be an active officer
       in that payam. No other role creates a farmer. Farmers do not register
       themselves.

C-5.2  A farmer's profile is given name, family name, sex, year of birth,
       phone number, an optional national ID, and payam. Each is validated by
       one definition in `packages/shared`, so a value the API refuses the
       officer's app refuses too. The year of birth is not in the future and
       not more than 120 years past. The phone number is a South Sudan mobile
       number, stored and returned in one form. Names are stored exactly as
       supplied (C-2.8).

C-5.3  A farmer record cannot exist without a consent record that says consent
       was granted, which text the farmer agreed to, and in which language.
       The two are written together or not at all, and the database enforces
       it rather than the application remembering. A registration without
       consent is refused as a business rule not met, not as invalid input.

C-5.4  Every farmer receives, at creation, a unique human-readable farmer
       number derived from state, county and a sequence, of the form
       `CE-JUB-000123`. It is stored as written, is never changed, never
       re-derived and never reused, and two farmers can never receive the same
       number however many are created at the same moment. It is the number on
       a printed card.

C-5.5  Every farmer carries a payam, and directly a county and a state, and the
       state always equals the payam's state. The database enforces this as it
       does for payam and county (C-2.3).

C-5.6  At registration, and whenever a farmer's phone number or name changes,
       the system looks for an existing farmer with the same phone number, or
       with the same given and family name in the same payam. Names are
       compared ignoring case, surrounding space and Unicode form; the stored
       value is untouched. A match sets the farmer's duplicate flag and records
       which existing farmers matched. **It warns. It never blocks the save.**
       The warning carries the matched farmers' ids and nothing else about
       them. Deciding what a duplicate is, is C-6.

C-5.7  An officer reads the farmers they registered and no others. A supervisor
       or read_only user reads the farmers in their assigned state. An
       administrator reads all. A farmer outside the caller's scope is
       indistinguishable from one that does not exist (C-3.5). Lists can be
       filtered by verification status, payam, county, sex, registration date
       range and duplicate flag, and are paged in a fixed order.

C-5.8  A farmer's national ID is returned only to administrators and to the
       officer who registered that farmer. To a supervisor or read_only user it
       is absent from the response, not masked, because a masked field still
       says one exists. This is data model open question 2, unanswered by
       CORWADO; the narrower reading is our decision, recorded in
       `docs/DECISIONS.md`, and can be widened on request.

C-5.9  An officer may change a farmer they registered while that farmer's
       verification is pending or rejected. An administrator may change any
       farmer at any time. Nobody else changes a farmer. The farmer number and
       the registering officer are never changed by anyone.
       (Amended by B6: the original said pending only. A rejected record must
       be correctable before it can be resubmitted, C-6.5, so the original was
       wrong.)

C-5.10 Only an administrator removes a farmer, and removal is soft deletion. A
       removed farmer appears in no list, count, export or report, and their
       history remains readable in the audit log (C-4.5). Consent records are
       never removed.

C-5.11 Every registration, change and removal appends an audit event in the
       same transaction as the change (C-4.4). Audit entries carry no name,
       phone number or national ID (C-4.7).

C-5.12 A registration carries a client-supplied identifier. A repeat of the
       same identifier creates no second farmer and is answered as a conflict,
       so a retried upload is never a second row. Synchronisation itself is
       C-9.

C-5.13 Every error response in this deliverable — 400, 403, 404, 409, 422,
       500 — is free of any farmer's name, phone number or national ID.
       Success responses carry personal data only inside the farmer record or
       records that were requested, and never in a message, a warning, or a
       field description. A test proves both halves for every error path in
       the unit, rather than a reading of the code.

C-5.14 Every farmer in staging, in tests and in seed data is invented. No real
       farmer exists anywhere but production.

### Notes for the builder

**Uniqueness of the farmer number** is a per-county counter row updated with a
row lock inside the insert transaction, with a UNIQUE constraint as backstop.
Concurrent registrations in one county serialise on that row. The number is
text, stored at insert, never derived from the current county code — a
county code changing under the I-07 boundary list leaves printed cards valid.

**Verification status** starts at `pending`. Every transition is C-6; this
section only creates records in that state.

**`registration_source`** keeps the value `self` from the data model. No route
produces it. It is a value, not a permission.

**The placeholder payam codes.** Until I-07 arrives, every farmer references a
placeholder payam. What that costs if the codes are replaced rather than
renamed is stated in `docs/PROJECT-STATE.md` when B5 lands.

---

## C-6 — VERIFICATION, REJECTION, MERGING AND ESCALATION

Deliverable: (c) farmer registration and profiling. Unit B6. The verified view
this section creates is what (q) reporting reads.

Source: `docs/data-model.md` section 1 (`verification_event`), section 3 (*Where
a record can stall*, *Conflicts and duplicates*) and section 4 (the
`verification_status` state machine). B5 created records and every one is
pending; nothing counts toward a reach figure until a named person decides it
is real, on a stated date. This is the section that makes a reach number
defensible, and it is where the duplicate warning of C-5.6 gets its answer.

C-6.1  A farmer record is in exactly one of four states: pending, verified,
       rejected or merged. The only transitions are pending to verified,
       pending to rejected, rejected to pending on resubmission, and any state
       to merged. Every other transition is refused, and one module decides
       that, not each route separately. A test proves each refusal.

C-6.2  A supervisor of the farmer's state, or an administrator, verifies,
       rejects or merges a farmer. Nobody else does. A supervisor's decisions
       are confined to their state; a farmer outside it is indistinguishable
       from one that does not exist (C-3.5). An officer never verifies,
       including their own registrations. A read_only user reads the queue and
       changes nothing (C-3.9).

C-6.3  A rejection carries a reason code from a fixed list and may carry a
       note of at most 280 characters. A rejection without a code is refused
       as a business rule not met. The code and the note are returned to the
       registering officer with the record so the correction can be made; the
       note appears nowhere else — not in any error, warning or message, not in
       the audit log. Its field name, `note`, is on the error scrubber's key
       list, and a test in the shape of B1.5's proves an event carrying it
       leaves without it. A test proves both halves.

C-6.4  A merge names a target and sets the source's pointer to it. The source
       row is kept and remains readable by id; neither row is ever deleted. A
       target that is the source itself, is merged, is rejected or is
       soft-deleted is refused. A source and target in different states are
       refused, for every role including an administrator: a merge across
       states would move a farmer between supervisors' scopes and between two
       donor reach figures, and if CORWADO needs that it is their decision,
       not a default.

C-6.5  The registering officer, and nobody else, resubmits a rejected record
       after correcting it (C-5.9 as amended). Resubmission returns the record
       to pending and restarts the escalation clock. Resubmission from any
       state but rejected is refused.

C-6.6  Every transition writes a verification event naming the decider, the
       decision, the reason code where there is one, the days the record had
       waited, and the moment; and an audit event; both in the same
       transaction as the status change, so a decision and its record succeed
       or fail together (C-4.4).

C-6.7  A record still pending after more than seven days is escalated. The
       queue shows pending farmers oldest first with their days waiting, can
       be filtered to escalated ones, and shows each farmer's duplicate matches
       expanded beside it so the reviewer sees both records. Days waiting is
       counted from registration, or from the latest resubmission. The clock
       is not editable through any route, by any role.

C-6.8  Reach figures read the verified-only view and nothing else. Pending,
       rejected and merged records are counted separately and never folded
       into a reach total. The view excludes soft-deleted records as well.

C-6.9  A merged source appears in no queue, no count and no reach figure, but
       is readable by id, with its pointer. The same proof B5 gave for
       soft-deleted farmers is given for merged ones.

C-6.10 No response in this deliverable carries a farmer's name, phone number,
       national ID or rejection note outside the record it was asked for. The
       C-5.13 scan is extended to cover the note, not duplicated.

### Notes for the builder

**The rejection note is data, not a message.** The reviewer writes about the
record, not the person — a standing rule in `docs/DECISIONS.md` that will
govern every free-text field this system gets. The code carries the meaning;
the note carries the detail; the note travels only inside the verification
record to the parties entitled to it.

**The clock** is a `pending_since` column: set at registration, reset on
resubmission, never editable. Days waiting is derived from it wherever shown.

**The reason codes** — `duplicate`, `wrong_location`, `incomplete`,
`not_a_farmer`, `consent_missing`, `other` — live in `packages/shared`, and
the database CHECK is generated from that list, the same pattern as
`AUDIT_ACTIONS` in B4, so the code and the database cannot drift.

**Additive corrections to the data model**, recorded in B6: `merged` joins the
verification status enum, with `merged_into` as the pointer; `resubmitted`
joins the verification-event decision enum so every transition has an event.

**A pending record can always be decided.** Verification, rejection and
merging need only a supervisor of the state or an administrator, never the
registering officer, so a record whose officer has since left is not stuck in
the queue. Only resubmission needs the officer; a rejected record whose
officer is gone stays rejected — out of the queue, counted as rejected —
until an administrator reassigns it, which is a later decision, not this
section's.

---

## C-7 — FARM BOUNDARY MAPPING

Deliverable: (c) farmer registration and profiling. Unit B7.

Source: `docs/data-model.md` section 1 (`farm`, `crop_declaration`) and
`docs/data-model-extension.md` §10. A boundary is the one record in this
system that can only be created by physical presence: a name, a crop and a
verification decision can be typed at a desk; a polygon cannot. The record
tells "someone walked this" from "someone drew this" by shape — the mapping
officer column references the officer table — not by a flag.

C-7.1  A farm belongs to exactly one farmer and records the season it was
       mapped for. A farmer may hold more than one farm.

C-7.2  A boundary is a closed shape of at least four distinct points, the
       closing repeat not counted. A shape that is not closed, or crosses
       itself, or has fewer points, is refused with a message an officer can
       act on standing in a field — never the database's words.

C-7.3  The area is calculated from the boundary and stored in hectares. It is
       never entered by hand.

C-7.4  Every boundary records the GPS accuracy at capture, and is marked good
       (10 metres or better), poor (over 10 to 30) or unusable (over 30) from
       it. Unusable boundaries are saved but excluded from every area total.

C-7.5  A re-mapped boundary is recorded alongside the previous one, not in
       place of it, within a season as well as across seasons. Each boundary
       names its farm, season, mapped-at moment and mapping officer; exactly
       one is current per farm per season, and that is a database fact. Area
       totals read current boundaries only and name the season they cover.
       (Data model open question 6, unanswered by CORWADO; the reversible
       reading is our decision and can be narrowed on request —
       `docs/DECISIONS.md`.)

C-7.6  An officer maps farms only for farmers in their own caseload, and only
       an officer maps. A supervisor and a read_only user see farms in their
       state. Out of scope is indistinguishable from not found. An
       administrator reads everything and removes; an administrator never
       creates, re-maps or re-grades, and cannot be recorded as a mapper.

C-7.7  Crop declarations are recorded per farm per season, from the fixed crop
       list, one declaration per crop per season, by the mapping officer.

C-7.8  A farm's boundary, centroid and GPS accuracy are returned only to
       administrators and the mapping officer, per the same reading as C-5.8.
       To a supervisor or read_only user those keys are absent, not masked;
       they receive the area, the grade, the season, the crops and the farmer.

C-7.9  Removal is soft, by an administrator. A removed farm appears in no
       list, count, area total or map, and its history remains readable.

C-7.10 No response carries a farmer's name, phone or national ID outside the
       record asked for. The C-5.13 scan extends to cover farm routes and the
       geometry keys join the error scrubber's list.

### Notes for the builder

**Accuracy thresholds** are ours, taken because no threshold exists in any
document, to be corrected when CORWADO or the field says otherwise. A consumer
GPS under tree cover routinely reports 15 to 20 metres, so "poor" will be
common; the unusable threshold is the one that matters.

**Four distinct vertices**: a three-sided plot exists in reality, but a
three-point capture is far more likely an officer who stopped walking early.

**Seasons** are a four-digit year, a hyphen, and a name from a fixed list —
`main`, `second` — ours until CORWADO confirms local names. A season the
system cannot compare is a season reporting cannot report on.

**Winding order** is normalised on insert; whichever way the officer walked
the plot, the stored ring is counter-clockwise and the area is positive.

---

## C-8 — EXTENSION VISITS AND ATTACHMENTS

Deliverable: (d) extension services. Unit B8.

Source: `docs/data-model-extension.md` §2 (`visit_note`, `visit_attachment`).
Written by the owner on 2026-09-07 after B7 merged. The visit is the second
record in this system that requires physical presence, and the first whose
substance is prose: what an officer saw and what they advised is the
deliverable CORWADO reports to the donor.

C-8.1  An extension officer records a visit to a farmer in their caseload,
       capturing where and when it happened, what was observed, and what advice
       was given. Advice is required: a visit with no advice is not a visit,
       and extension coverage is what CORWADO reports to the donor.
C-8.2  A visit records the topics it covered from a fixed list, and may record
       its duration and how many people attended.
C-8.3  A visit may be a follow-up to an earlier visit, and the chain is readable
       in order. The earlier visit belongs to the same farmer, is not removed,
       and following it back never reaches this visit — a retried sync could
       produce the cycle an officer never would.
C-8.4  A visit records the position at which it was captured and its accuracy in
       metres. The value is stored and shown; it is not graded. The boundary
       grades were set for a walked polygon where error compounds across every
       vertex, and a single standing point is a different measurement. A grade
       is added if the field asks for one.
C-8.5  A visit records both the moment the officer's device reported and the
       moment the server received it. Coverage figures are computed from the
       server's moment, never the device's, because a phone offline for a week
       may be wrong by days. Both are shown wherever a date is shown.
C-8.6  A visit may carry photographs or audio. An attachment is a separate
       record that travels separately: a failed or pending attachment never
       blocks the visit it belongs to, and a visit is complete without them.
C-8.7  For any visit, its officer can tell whether each attachment has arrived,
       is still waiting, or has failed, and what to do about it. The message
       names the action, not the fault (§14).
C-8.8  Attachment files are private. Access is granted per request, expires, and
       is refused outside the caller's scope.
C-8.9  An officer records and reads visits for farmers in their caseload. A
       supervisor and a read-only user read visits in their state. Out of scope
       is indistinguishable from not found.
C-8.10 An officer may correct their own visit within twenty-four hours of
       recording it. After that only an administrator may. An administrator
       never records a visit, as with boundaries — a visit is a journey.
C-8.11 Removal is soft, administrator only. A removed visit appears in no list,
       count or coverage figure, and its history remains readable.
C-8.12 Every visit, attachment and correction writes an audit entry in the same
       transaction as the change.
C-8.13 Observation and advice are free text and are the substance of this
       deliverable, not an aside. The B6 rule holds — the officer writes about
       the visit, not the person — but it cannot be enforced by a closed list,
       because no list can say what to do about armyworm in a particular field.
       It is enforced by where the text travels: inside the visit record only,
       to the parties entitled to it; never in an error, a warning or a message;
       never in the audit log; redacted by the scrubber; covered by the scan.
C-8.14 Every visit and attachment in staging, in tests and in seed data is
       invented.

### Notes for the builder

**Decided with the owner, 2026-09-07, before the build.** Bytes never pass
through a route: the API issues a signed upload grant for one attachment id,
the phone uploads to Storage, and the API confirms arrival against the
declared size and type; reading is a signed link per request. The grant
expires in minutes; the confirm step verifies existence, size and type; the
bucket is private with no public policy, and one server module touches
Storage. Any non-removed farmer may be visited, whatever their verification
status; coverage counts visits to verified farmers, with the rest beside and
never folded in. The twenty-four hours run from the server's moment. A
correction may change what was observed, advised, covered, how long and how
many, and the follow-up link; never the farmer, the officer, the position or
either moment — those five make the record evidence rather than a note.

**Topics** are nine, from `docs/data-model-extension.md` §2: land
preparation, planting, weeding, pest, disease, harvest, storage, market,
other. Short on purpose: a list an officer scrolls past is a list they tick
the first item on.

**Ceilings** with room: photos to 15 MB (a mid-range Android's JPEG is 3 to 6,
a 48-megapixel one up to 10) as JPEG, PNG or WebP; audio to 25 MB (about ten
minutes of AAC is 10) as M4A, AAC, MP3, OGG or WebM. A file over the ceiling
is refused at declaration, before any byte travels, with a sentence naming
the action.

**The upload grant's life** is a provider fact: Supabase's upload token lives
two hours and cannot be shortened. Ours is fifteen minutes, recorded on the
row and enforced at confirm; an object that arrives after it is removed and
the row fails.

---

## C-8R — CASELOAD REASSIGNMENT

Deliverable: (c) farmer registration and profiling. Unit B8.5.

Source: `docs/UNITS.md`, B8.5, decided 2026-09-05. These criteria restate a
decision already made, written by the assistant on the owner's instruction
(2026-09-07). The section is lettered R rather than numbered 8.5 because
"C-8.5" is already the criterion about device and server moments in C-8, and
two things with the same name in a document a session reads without asking
is a known way to be bitten.

C-8R.1 A farmer carries a caseload officer, set to the registering officer at
       creation. The registering officer never changes (C-5.9).
C-8R.2 An administrator reassigns a farmer to another officer, who is active
       and in the farmer's payam. Nobody else can. Reassigning to the officer
       who already holds the farmer is refused, so the log never records a
       move that was not one.
C-8R.3 After reassignment the new officer reads, resubmits, maps and visits
       the farmer; the old officer is told not found on all of it. When an
       administrator sets an officer inactive, the response says how many
       farmers are now without a working officer; nothing is refused.
C-8R.4 Farms, boundaries, crops and visits follow the farmer without being
       touched: they reach the caseload through the farmer.
C-8R.5 Reassignment writes an audit entry carrying the old and new officer, in
       the same transaction.
C-8R.6 A farmer's response shows both officers.
C-8R.7 Every caseload check in the system reads the caseload officer. One
       helper, not five copies.

### Notes for the builder

**The new officer's payam** is registration's rule for registration's reason:
an officer who is not where the farmer is cannot visit them. Widening to the
county is one condition in one query, to be made if CORWADO says payam
coverage is thinner than assumed — a field fact we do not have.

**Attachments** keep checking the visit's own officer, not the caseload,
because an attachment is uploaded by the phone that took it. In plain terms:
a reassigned farmer's waiting attachments are completable only by the phone
that took them, and if that officer has left, those attachments never
arrive. The visit stands without them, which is what C-8.6 is for.

**The national ID** (C-5.8) goes to the caseload officer. C-5.8 said "the
officer who registered" because that officer did the work; after a
reassignment the new officer does it.
## C-9 — OFFLINE SYNCHRONISATION

Deliverable: (b) offline-first data capture. Unit B9.

Source: the owner's eight decisions of 2026-09-08, taken after the sync
contract in `docs/data-model.md` §3 was read against what the routes built in
B5 through B8.5 actually do. That section was written before any of them
existed and is corrected as part of this unit (C-9.13). B9 is the server side
of sync: the routes, the codes, the contract and the shared constants the
officer app is built against. The app itself is a later surface.

C-9.1  Every record an officer creates in the field carries a client-generated
       identifier: farmer, farm, boundary, crop declaration, visit, attachment.
       A boundary gains one — today its id is the server's, so a retried
       add-boundary after a lost acknowledgement recorded a second boundary
       that superseded the first: a supersession that never happened in the
       field, a false record and not merely a duplicate.
C-9.2  A retried create is idempotent in fact, not by documentation: when the
       identifier matches a stored record and the body matches what was
       stored, the response is 200 with the record. 409 only when the
       identifier matches and the body does not — a real conflict, terminal,
       and the officer is told. Farmer, farm, boundary, visit and attachment
       declaration all behave so; the attachment route already did. A phone
       that must read back to learn whether its own write landed is a phone
       that will re-send.
C-9.3  One transaction per record; a server row is never partially written; a
       record is removed from the device only when the server has acknowledged
       it by identifier.
C-9.4  Seven outcomes, each a code with a sentence for the officer (§14) and a
       device action: **retry_later** (no network, 500, and 503 — the sign-in
       service could not be reached; never a prompt to re-enter credentials);
       **sign_in_again** (401); **not_yet** (an attachment confirmed before its
       bytes arrived; retry soon); **waiting_for_parent** (the record's parent
       has not been acknowledged; hold, do not retry on a timer);
       **refused** (400, 413, 422 — a rule refused it; will not succeed on
       retry; show the rule's own sentence); **left_caseload** (404 on a farmer
       the device holds — reassigned while offline; keep it, show the officer,
       never retry); **conflict** (409 with a differing body; terminal; show
       the officer). The data model's five codes are replaced by these.
C-9.5  Parent-first release. A farmer before its farms and visits; a farm
       before its boundaries and crops; an earlier visit before its follow-up;
       a visit before its attachment rows; a row before its bytes; bytes before
       confirm. A child is held until its parent is acknowledged by identifier.
       When a parent is terminally refused, its children are not retryable:
       they are marked stuck with the parent's identifier and reason, and the
       officer can see which parent and why.
C-9.6  Attachments have their own lifecycle, distinct from record sync states:
       declared, uploading, confirmed, failed. A grant that expired on confirm
       means re-declare with the same identifier, not give up. A device that
       gives up says so, so the visit shows "did not send" rather than
       "waiting" for ever (C-8.7).
C-9.7  The entities that sync are farmer, farm, farm boundary, crop
       declaration, visit and visit attachment. Nothing else — "ai question"
       is on the do-not-build list and leaves the model.
C-9.8  Every request from the officer app carries a device identifier in a
       header; the route wrapper reads it and every audit entry written in that
       request records it. Audit rows written before this unit carry no device
       and never will; the record says so.
C-9.9  Download. The caseload lists — farmers, farms, visits — accept an
       updated-since filter on the server's moment of last change, so a device
       learns verification decisions and their reasons, merges, corrections and
       new records without re-downloading its caseload. A caseload endpoint
       returns the identifiers currently in the officer's caseload; a farmer
       the device holds that is absent from it has left the caseload, and the
       device removes that farmer and everything under them, keeping nothing:
       the officer has no right to that data any more.
C-9.10 A farmer and a farm carry the device's moment of capture beside the
       server's moment of receipt, as a visit does (C-8.5). A farmer registered
       on Monday in a village and uploaded on Friday in town was registered on
       Monday. The server's moment stays authoritative for reporting; the
       field's date is no longer discarded. Both are shown wherever a date is
       shown.
C-9.11 No sync response, success or failure, carries a farmer's name, phone,
       national ID, note, observation, advice or position outside `data`
       (C-5.13, C-8.13). The shared scan covers every sync route.
C-9.12 Every sync payload is validated by the same shared schema on the device
       and on the server, so the two cannot disagree about what is valid.
C-9.13 `docs/data-model.md` §3 is corrected to state what the routes do: the
       entity list, the codes, the order, the attachment lifecycle, the device
       header, the download direction, and true idempotency.
C-9.14 Every record used to prove this unit, in staging and in tests, is
       invented.
C-9.15 The device can act on every code in C-9.4 without a follow-up read.
       For each, the response carries enough for the phone to decide keep,
       retry or show the officer, and to know when to retry if it should: a
       retryable outcome carries a Retry-After; a refusal carries the rule's
       own sentence; a conflict names the identifier. A code that requires the
       device to ask a second question before it knows what to do is a code
       that will be handled wrong on a phone with no signal. One code is not a
       server response at all — see the note.

### Notes for the builder

**"The body matches"** means: the fields the client sent, after the shared
schema's normalisation (trimmed strings, a phone in canonical form, a
polygon's ring compared point by point in stored winding), equal what was
stored; fields the server sets — moments of receipt, numbers it allocated,
denormalised location — are not compared. A retry from a phone is byte-for-
byte the same request, so the comparison exists to catch the other case: a
different record wearing a reused identifier.

**The device identifier** is an opaque installation identifier the app
generates once, not the handset's hardware identity. It names a device, and
through the session an officer; it is staff data, not a farmer's.

**Boundaries' client id** is a schema change: `farm_boundary.id` stops
defaulting on the server and the create-farm body carries a `boundary_id`
beside the farm's. Migration in this unit, additive to the body, not to the
table's shape.

**Captured-at** on farmer and farm is a schema change: two nullable columns,
so records that predate the unit read "not recorded" rather than a guess.

**The seven codes against C-9.15, checked before the build.** Six pass on the
response alone: retry_later (500 and 503 carry `Retry-After`), sign_in_again
(401), not_yet (409 `attachment_not_arrived` carries `Retry-After`), refused
(the rule's sentence is in the body), left_caseload (404 on a farmer the
device had acknowledged: keep, show, never retry), conflict (409 naming the
identifier; the device holds its own copy and the next download brings the
server's). **waiting_for_parent is never a server response.** The server
cannot tell "parent not landed yet" from "parent not yours": both are 404 by
design (§5.1). It is the device's own hold, decided from one local fact —
whether the parent has been acknowledged — and a child is never sent before
that fact is true (C-9.5). If a child is sent anyway, the server's 404 is
read as left_caseload only when the parent was acknowledged, and as a device
fault otherwise. A local fact is not a follow-up read; the code passes
C-9.15 on that basis, and the officer app must implement the hold, not
infer it from the server.

**The seventh silent gate.** The audit law required the device on every
entry, the column existed since B4, nothing sent it and no test asked; every
audit row since B4 has a null device. Found 2026-09-08 by reading a design
document against the code, the first of the class found that way. Recorded in
`docs/PROJECT-STATE.md`.

---

## C-13 — DIRECTORIES AND LEARNING LIBRARY

**Deliverables (i), (j), (k) and (m). Unit P1.**

Built out of the numbered order in `CLAUDE.md` §2 (group 4 before group 3),
deliberately: these tables hold no field data and depend on nothing but the
location hierarchy, so a second person can build them while the spine is
built. The deviation is recorded in `docs/DECISIONS.md`.

Source: Inception Report section 5, items (i), (j), (k), (m), and the scope
note above — *"maintained reference information, not a transactional system.
(k) holds, transfers and lends nothing. (m) is a repository, not a course or
examination system."* Shapes from `docs/data-model-extension.md` §3 and §4.

An administrator maintains these lists. Everyone else looks them up.

C-13.1  Agro-dealers, input suppliers and financial services are one kind of
        record, a directory entry, distinguished by type. An entry has a name,
        at least one South Sudan mobile number, an optional email, address and
        map point, and a list of the services it offers.

C-13.2  Every entry is located in exactly one payam and carries its state
        directly, and that state always equals the payam's state. The database
        enforces this as it does for payam and county in C-2.3.

C-13.3  A financial service says what kind it is — bank, microfinance, mobile
        money, cooperative or SACCO, or other — and no other kind of entry
        does. The database refuses both a financial service without a kind and
        a dealer with one.

C-13.4  Every entry records the date it was last checked, and that date is
        never in the future. An entry can be marked inactive without being
        removed. Removal is soft deletion, and a removed entry appears in no
        list, count or export.

C-13.5  The same validation rules run in the web form and in the API, from one
        definition in `packages/shared`. A phone number the farmer record would
        refuse, the directory refuses too.

C-13.6  A learning resource is a catalogue card for a file held in Supabase
        Storage: title, topic, optional crop, language (English or Arabi
        Juba), format (PDF, image, audio, video), size in bytes and an
        optional description. The file itself never enters the database.

C-13.7  Exactly one live card exists per stored file. Removing a card is soft
        deletion, and it releases the file's path so the file can be
        registered again.

C-13.8  A card starts unpublished. Officers see published cards only;
        administrators see all. The size is shown beside every download.

C-13.9  Reads and writes go through API routes that check role on the server
        (C-3). Only an administrator creates, changes or removes an entry or a
        card. Every such write appends an audit event (C-4). A supervisor's and
        an officer's directory reads are scoped to their state.

### Notes for the builder

C-13.1 to C-13.8 are met by the database, the shared validation and the tests
in unit P1. **C-13.9 requires B3 and B4 and is NOT DONE until they exist.** The
routes are specified in `docs/HANDOFF.md`, *Continue from here*.

Nothing in this section is an account. If a field starts to look like a
balance, a loan, a repayment, an enrolment or a score, stop and ask.

**One open question for CORWADO, not blocking:** may an extension officer
propose a new directory entry from the field (a shop they found), for an
administrator to approve? The contract says the administrator maintains the
list. If yes, the officer role gets a write route and entries gain a
`pending` state. Until answered, officers read only.

---

## SECTIONS NOT YET WRITTEN

Written one unit ahead of the build, not all at once, so that criteria reflect
what the preceding unit actually produced.

- C-10 — dashboards, reporting and export — (p), (q)
- C-11 — backup and disaster recovery — (t)
- C-12 — cooperatives — (l)
- C-14 — market prices, produce listings, buyer matching — (f), (g), (h)
- C-15 — SMS notifications — (n)
- C-16 — weather advisories — (e)
- C-17 — WhatsApp — (o), conditional on Meta verification

---

## OPEN AGAINST THE CONTRACT

Recorded here rather than resolved silently. Each needs a written answer from
CORWADO before the affected deliverable is built.

1. **(g) and (h) assume actors who cannot log in.** The contract says buyers
   post requirements and farmers and cooperatives respond. F-05 says farmers are
   reached by SMS and have no application. There is no buyer role. Either buyers
   receive accounts, or CORWADO staff enter listings and requirements on behalf
   of both parties and the matching is an introduction recorded by staff. The
   second reading is consistent with "introduction and contact record only" and
   is far cheaper. It needs confirming before C-14 is written.

2. **The interface designs show a farmer-facing application.** Section 5.1
   excludes one from this phase. Either the designs are for a later phase or the
   baseline changed. Not to be built until answered.

3. **"Ask AI" appears in the designs and in no deliverable.** Not to be built
   until answered.

4. **Arabi Juba script.** Section 4 records that this must be settled before
   translation begins: Arabic script requires right-to-left mirroring, and
   non-Latin scripts occupy fewer characters per SMS, so one message may be
   charged as two or three. Affects C-15 and the mobile interface.

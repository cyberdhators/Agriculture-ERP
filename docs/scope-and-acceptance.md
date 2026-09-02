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

- C-3 — identity, roles and permissions — deliverables (r), (s)
- C-4 — audit log — deliverable (s)
- C-5 — farmer registration, profiling, farmer number, duplicate warning — (c)
- C-6 — verification and approval workflow — (c)
- C-7 — farm boundary mapping — (c)
- C-8 — extension visit recording — (d)
- C-9 — offline synchronisation — (b)
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

# DATA MODEL — EXTENSION

Companion to `docs/data-model.md`. That document covers the spine: farmer, farm,
crop_declaration, officer, payam, cooperative, verification_event, sync_record,
audit_event, consent, ai_question, user, report_export.

This document defines everything the remaining contracted deliverables need and
that the spine document does not yet contain. Conventions, enum values and
relationship style follow the original.

Nothing here changes an existing entity except where section 1 says so
explicitly.

---

## 1. THREE GAPS IN THE EXISTING MODEL

These block the spine itself, not the later modules. Fix them first.

### 1.1 `visit_note` is referenced but never defined

`sync_record.entity_type` includes `visit_note`. No such entity exists.
Deliverable (d) is the second-largest module in the contract. Defined in
section 2 below.

### 1.2 `county` and `state` do not exist

`payam` carries `county_id` and a denormalised `state_id`. Neither target
entity is defined, and every dashboard filter, every report disaggregation and
every supervisor scope check depends on this hierarchy.

```
state
  id           code, e.g. CE
  name         text
  active       boolean

county
  id           code
  name         text
  state_id     fk → state
  active       boolean
```

Bundled on every device with `payam`, as one file. Location lists must never
wait on the network.

### 1.3 There is no soft-delete column anywhere

CLAUDE.md requires soft delete on everything and forbids deleted rows from
appearing in any list, count or export. The spine model has no mechanism for
it — `farmer` has `merged_into`, `officer` has `status`, and nothing else has
anything.

Add to every entity in both documents except `audit_event`, `sync_record`,
`verification_event` and `consent`, which are records of events and are never
deleted:

```
  deleted_at   timestamp, nullable
  deleted_by   fk → user, nullable
```

One rule, stated once so Prompt D can check it as a single question: **every
list, count, export and report filters `deleted_at IS NULL`.** Prefer a
`_active` view per entity so a forgotten filter is impossible rather than
merely discouraged.

### 1.4 Scope columns

Every entity a supervisor can be scoped to must carry `state_id`, denormalised,
even where it is derivable through `payam`. Without it every permission check
becomes a join, and the officer-in-Yei-reads-Juba finding in your attack prompt
becomes a query-shaped bug rather than a missing-column bug.

---

## 2. DELIVERABLE (d) — EXTENSION SERVICES

The largest missing module. Visit recording with location and timestamp, advice
given, follow-up.

```
visit_note
  id                    uuid, client-generated
  farmer_id             fk → farmer
  farm_id               fk → farm, nullable
  officer_id            fk → officer
  visit_type            enum routine | follow_up | request | group
  topics                enum[] land_prep | planting | weeding | pest |
                        disease | harvest | storage | market | other
  observation           text
  advice_given          text, required
  gps                   geopoint, at capture
  gps_accuracy_m        decimal
  visited_at            timestamp, device clock
  recorded_at           timestamp, device clock
  duration_minutes      int, nullable
  follow_up_required    boolean
  follow_up_due         date, nullable
  follow_up_of          fk → visit_note, nullable
  attendee_count        int, nullable, group visits only
  payam_id              fk → payam, denormalised from farmer
  state_id              fk → state, denormalised
  deleted_at            timestamp, nullable
```

```
visit_attachment
  id            uuid
  visit_note_id fk → visit_note
  storage_path  text, Supabase Storage
  kind          enum photo | audio
  captured_at   timestamp
  uploaded_at   timestamp, nullable
  byte_size     int
```

**Relationships.** `farmer 1 ── n visit_note`. `visit_note 0..1 ── visit_note`
via `follow_up_of`, so a follow-up chain is traceable. `officer 1 ── n
visit_note`.

**Notes that matter for the build.**

`visited_at` comes from the device clock, which on a cheap Android handset that
has been offline for a week may be wrong by hours or days. Store the device
clock as given, and store the server receipt time separately in `sync_record`.
Never compute a reporting period from a device clock alone.

Attachments are the reason this module is dangerous offline. A photo is one to
three megabytes; a `visit_note` is two kilobytes. They must upload as separate
sync records, note first, so a failed photo never blocks the advisory record it
belongs to. `payload_too_large` already exists in your reason codes — this is
the entity that will produce it.

`advice_given` is required because deliverable (d) is what CORWADO reports to
the donor as extension coverage. A visit with no advice is not a visit.

---

## 3. DELIVERABLES (i), (j), (k) — THE THREE DIRECTORIES

Agro-dealer, input supplier, financial services. One entity, typed. Build once.

```
directory_entry
  id              uuid
  entry_type      enum agro_dealer | input_supplier | financial_service
  name            text
  description     text, nullable
  services        text[]  e.g. seeds, fertiliser, savings, microloan
  contact_name    text, nullable
  phone           text, E.164
  alt_phone       text, nullable
  email           text, nullable
  physical_address text, nullable
  location        geopoint, nullable
  payam_id        fk → payam
  state_id        fk → state, denormalised
  provider_class  enum bank | microfinance | mobile_money | cooperative_sacco |
                  other, nullable — financial_service only
  last_verified_at date
  verified_by     fk → user
  active          boolean
  deleted_at      timestamp, nullable
```

`last_verified_at` exists because a directory is worth exactly as much as its
freshness. Show it on screen next to each entry and let staff filter by it.
Six months stale is a farmer travelling to a dealer who closed.

Deliverable (k) is a directory and nothing else. No balances, no transfers, no
loan applications, no repayment schedules. If a field on this entity starts to
look like an account, stop and ask.

---

## 4. DELIVERABLE (m) — LEARNING RESOURCE CENTRE

A repository, not a course system. No enrolment, progress, quizzes or
certificates — those are in the client's application document and not in the
contract.

```
learning_resource
  id            uuid
  title         text
  topic         enum crop_production | livestock | pest_disease | post_harvest |
                marketing | cooperative | climate | other
  crop          enum sorghum | groundnut | sesame | maize | cowpea, nullable
  language      enum en | ar-juba
  format        enum pdf | image | audio | video
  storage_path  text
  byte_size     int
  description   text, nullable
  published     boolean
  uploaded_by   fk → user
  uploaded_at   timestamp
  deleted_at    timestamp, nullable
```

`byte_size` is on screen next to every download. An officer on a metered phone
in Yei deserves to know a file is 40 MB before tapping it.

---

## 5. DELIVERABLES (f) AND (h) — PRICES

Two separate things that are easy to conflate. (f) is CORWADO publishing
reference prices. (h) is a farmer or cooperative offering produce for sale.

```
market_price
  id              uuid
  market_name     text
  payam_id        fk → payam
  state_id        fk → state, denormalised
  commodity       enum sorghum | groundnut | sesame | maize | cowpea
  unit            enum kg | 50kg_bag | 90kg_bag | malwa | tin
  price           decimal
  currency        enum SSP | USD
  collected_on    date
  source_note     text, nullable, e.g. "Konyokonyo market survey"
  entered_by      fk → user
  entered_at      timestamp
  superseded_by   fk → market_price, nullable
  deleted_at      timestamp, nullable
```

Prices are never edited. A correction writes a new row and sets
`superseded_by` on the old one, so a farmer who acted on a number can be shown
the number they saw. Display must always show `collected_on` and the market
name, never a bare figure.

```
produce_listing
  id              uuid
  seller_type     enum farmer | cooperative
  farmer_id       fk → farmer, nullable — must be verified
  cooperative_id  fk → cooperative, nullable
  commodity       enum ...
  quantity        decimal
  unit            enum kg | 50kg_bag | 90kg_bag
  asking_price    decimal, nullable
  currency        enum SSP | USD
  available_from  date
  status          enum open | matched | withdrawn | expired
  expires_on      date
  payam_id        fk → payam
  state_id        fk → state
  listed_by       fk → user or officer
  deleted_at      timestamp, nullable
```

Exactly one of `farmer_id` and `cooperative_id` is set — a check constraint,
not a convention. Listings expire; a six-month-old offer of sorghum that was
sold in March is worse than no listing. Default `expires_on` to 60 days and let
staff extend it.

---

## 6. DELIVERABLE (g) — BUYER–SELLER MATCHING

The contract is explicit: introduction and contact record only. Transactions
happen between the parties. Nothing here holds money or tracks fulfilment.

```
buyer
  id              uuid
  name            text
  organisation    text, nullable
  buyer_type      enum trader | processor | institution | ngo | other
  phone           text, E.164
  email           text, nullable
  operating_areas fk[] → county
  commodities     enum[]
  registered_by   fk → user
  active          boolean
  deleted_at      timestamp, nullable
```

```
buyer_requirement
  id            uuid
  buyer_id      fk → buyer
  commodity     enum ...
  quantity      decimal
  unit          enum ...
  offer_price   decimal, nullable
  currency      enum SSP | USD
  needed_by     date
  counties      fk[] → county
  status        enum open | closed | expired
  posted_by     fk → user
  posted_at     timestamp
  expires_on    date
  deleted_at    timestamp, nullable
```

```
introduction
  id                 uuid
  buyer_requirement_id fk → buyer_requirement, nullable
  produce_listing_id fk → produce_listing, nullable
  buyer_id           fk → buyer
  seller_type        enum farmer | cooperative
  farmer_id          fk → farmer, nullable
  cooperative_id     fk → cooperative, nullable
  made_by            fk → user
  made_at            timestamp
  channel            enum sms | phone | in_person
  outcome            enum unknown | contact_made | no_response | declined
  outcome_note       text, nullable
  outcome_recorded_at timestamp, nullable
```

`introduction` is the deliverable. It is the record that CORWADO connected a
buyer to a seller, which is what the donor is buying. `outcome` is deliberately
weak — CORWADO records what it learns, and `unknown` is an honest answer the
system must be able to hold. Do not build fulfilment tracking behind it.

**The unresolved question this exposes.** `buyer` has no login and the `user`
table has three roles: admin, supervisor, read_only. As modelled, a buyer
cannot post a requirement and a farmer cannot respond to one — CORWADO staff
do both on their behalf, and matching is a phone number handed over by an
officer. That is consistent with F-05, consistent with "introduction and
contact record only", and cheap. It is also almost certainly not what the
client pictures when they read "buyers post requirements, farmers and
cooperatives respond".

This needs a written answer before (g) is built. Giving buyers accounts is a
new role, a new authentication path, a new attack surface and an approval
workflow — a week of work, not a field.

---

## 7. DELIVERABLE (n) — SMS NOTIFICATIONS

CORWADO pays per message and will ask what was delivered. Delivery status per
recipient is the point of this module, not an extra.

```
sms_campaign
  id                uuid
  name              text
  purpose           enum advisory | weather_alert | price_notice | training |
                    general
  body              text
  language          enum en | ar-juba
  segment_count     int, computed from body and encoding
  audience_filter   json  e.g. {state, county, payam, crop, verified_only}
  recipient_count   int
  status            enum draft | approved | sending | sent | cancelled
  created_by        fk → user
  approved_by       fk → user, nullable
  scheduled_for     timestamp, nullable
  sent_at           timestamp, nullable
  deleted_at        timestamp, nullable
```

```
sms_message
  id              uuid
  campaign_id     fk → sms_campaign, nullable — null for one-to-one sends
  farmer_id       fk → farmer, nullable
  to_phone        text, E.164
  body            text, as actually sent
  segment_count   int
  provider_message_id text, nullable
  status          enum queued | sent | delivered | failed | rejected
  failure_reason  text, nullable
  queued_at       timestamp
  sent_at         timestamp, nullable
  delivered_at    timestamp, nullable
  cost_estimate   decimal, nullable
```

`segment_count` is on the entity because of the point already raised in the
Inception Report: text in Arabic script encodes as UCS-2, which fits 70
characters per segment instead of 160. A message that looks like one SMS in
English becomes three in Arabi Juba. The composer must show the segment count
and the projected recipient total **before** the send button is enabled, and
`approved_by` must be set before status can leave `draft`. A mistyped audience
filter is a bill.

`body` is stored as sent, not as a template reference, so a message can be
reproduced exactly a year later.

---

## 8. DELIVERABLE (e) — WEATHER AND CLIMATE ADVISORY

Forecast for project areas converted into simple advisories.

```
weather_location
  id            uuid
  payam_id      fk → payam
  latitude      decimal
  longitude     decimal
  active        boolean
```

```
weather_forecast
  id                uuid
  weather_location_id fk → weather_location
  forecast_for      date
  fetched_at        timestamp
  temp_max_c        decimal
  temp_min_c        decimal
  rain_mm           decimal
  rain_probability  decimal
  humidity_pct      decimal
  wind_kph          decimal
  raw               json, provider response as received
```

```
weather_advisory
  id            uuid
  weather_location_id fk → weather_location, nullable — null means all areas
  advisory_type enum rain | dry_spell | flood_risk | heat | general
  severity      enum info | watch | warning
  headline      text, short enough for one SMS segment
  body          text
  language      enum en | ar-juba
  valid_from    date
  valid_to      date
  generated     enum rule | manual
  approved_by   fk → user, nullable
  sms_campaign_id fk → sms_campaign, nullable
  deleted_at    timestamp, nullable
```

Cache forecasts. One fetch per location per day, not one per screen view —
OpenWeather bills on calls and the officer app will otherwise fetch on every
home screen render. The cached row is also what the design's offline weather
card displays, which is why `fetched_at` is shown on screen as "saved this
morning".

A `warning` that goes out by SMS costs money and moves people. Rule-generated
advisories are drafts; `approved_by` must be set before any advisory becomes a
campaign.

### 8.1 Crop calendar — required by the designs, in no scope document

The interface shows a twelve-month farming-year strip and a "growing now" card
telling a farmer to weed sorghum this week. Nothing in the contract or the data
model supports that. If it is kept, the minimum is:

```
crop_stage
  id            uuid
  crop          enum ...
  state_id      fk → state, nullable — null means national
  stage         enum land_prep | planting | growing | weeding | harvest |
                post_harvest
  start_month   int 1-12
  end_month     int 1-12
  guidance      text
  language      enum en | ar-juba
```

Staff-maintained reference data, seeded once per crop per state. Cheap, and it
makes the home screen work. But it is scope that appears in no signed document
— raise it before building it.

---

## 9. DELIVERABLES (p) AND (q) — DASHBOARDS AND REPORTING

No new stored entities beyond `report_export`, which already exists. These are
views, and they must be defined as views so that "verified only" is enforced in
one place rather than in fourteen queries.

```
farmer_verified_v      existing — verification_status = verified,
                       deleted_at IS NULL
farm_mapped_v          farms with accuracy_flag <> unusable
visit_activity_v       visit_note joined to officer and payam, deleted_at IS NULL
extension_coverage_v   verified farmers with at least one visit in a period
directory_current_v    directory_entry, active, last_verified_at within 180 days
sms_delivery_v         per campaign: sent, delivered, failed, cost estimate
```

Every dashboard figure and every export reads a view from this list. A query
that reaches a base table directly is a finding for Prompt D.

Disaggregation for donor reporting is by sex, age band derived from
`year_of_birth`, state, county, payam and crop. Age band is computed at query
time from the data cut-off date, never stored, or every report will disagree
with every other report.

---

## 10. INDEXES

The 50,000-farmer question in your attack prompt is answered here or not at all.

```
farmer            (payam_id, verification_status, deleted_at)
farmer            (phone) — duplicate detection
farmer            (family_name, given_name, payam_id) — duplicate detection
farmer            (registered_by, created_at)
farm              (farmer_id), GIST on boundary, GIST on centroid
visit_note        (farmer_id, visited_at desc)
visit_note        (officer_id, visited_at desc)
visit_note        (payam_id, visited_at) — coverage reporting
sync_record       (device_id, sync_status)
sync_record       (entity_type, entity_id)
audit_event       (entity_type, entity_id, occurred_at desc)
audit_event       (actor_id, occurred_at desc)
market_price      (commodity, payam_id, collected_on desc)
produce_listing   (commodity, status, expires_on)
sms_message       (campaign_id, status)
directory_entry   (entry_type, payam_id, active)
```

Partial indexes on `deleted_at IS NULL` for every entity that lists at scale.

---

## 11. OPEN QUESTIONS

Additional to the six already in `docs/data-model.md`, which remain unanswered.

7. **Can buyers log in?** Section 6. Determines whether (g) is a field or a
   week. Blocking.
8. **Does the crop calendar exist?** Section 8.1. The designs assume it, no
   contract mentions it. Blocking for the home screen.
9. **Who approves an SMS campaign?** The model requires `approved_by` before
   sending. Is that any admin, or a named person? CORWADO pays the bill.
10. **What is the retention period for visit photos?** They are the largest
    storage cost by an order of magnitude and the highest-sensitivity content
    after national IDs.
11. **Are market prices published to farmers by SMS automatically, or only on
    request?** Automatic weekly prices to every farmer is a recurring cost
    CORWADO may not have budgeted.
12. **Is `visited_at` trusted from the device clock for donor reporting?**
    See section 2. Recommend reporting on server receipt date, with the device
    date shown alongside.

# DATA MODEL

The core entities, their relationships, the data flow from field to donor
report, and the two state machines the interface renders everywhere.

Companion: `docs/data-model-extension.md` defines the entities the later
deliverables need, plus three gaps in this document that must be fixed first.

## Three rules the model enforces

1. A record is never deleted from a phone until the server acknowledges it.
2. Reach figures read only rows where `verification_status = verified`.
3. Every write is an append to the audit log, with actor and device.

---

## 1. ENTITIES

### People and places

```
farmer
  id                    uuid, client-generated
  farmer_number         text, unique, CE-JUB-000123 -- B5: stored at insert, never re-derived
  given_name            text
  family_name           text
  sex                   enum f | m
  year_of_birth         int
  phone                 text, +211 stored E.164
  national_id           text, nullable -- returned to admin and registering officer only
  payam_id              fk → payam
  county_id             fk → county, denormalised -- B5: composite key with payam
  state_id              fk → state, denormalised -- B5: composite key with payam
  registered_by         fk → officer, nullable, immutable
  registration_source   enum officer | self -- self is a value, not a permission
  verification_status   enum pending | verified | rejected | merged -- B6: merged is a state
  merged_into           fk → farmer, nullable -- the pointer, set when merged
  pending_since         timestamp -- B6: the escalation clock; reset on resubmission, otherwise immutable
  consent_id            fk → consent, NOT NULL, deferred -- both rows commit together
  duplicate_flag        boolean -- B5
  duplicate_matches     uuid[] -- B5: ids of the farmers that matched
  created_at            timestamp
  updated_at            timestamp
  deleted_at            timestamp, nullable -- extension §1.3
  deleted_by            fk → user, nullable
```

```
officer
  id            uuid
  name          text
  phone         text, login identity
  payam_id      fk → payam
  caseload_count int, derived
  last_sync_at  timestamp, nullable
  status        enum active | inactive
```

```
payam
  id        code
  name      text
  county_id fk → county
  state_id  fk → state, denormalised
```

Bundled on every device so registration never waits on the network.

```
cooperative
  id              uuid
  name            text
  payam_id        fk → payam
  registered_year int
  primary_crop    text
```

```
cooperative_member
  cooperative_id fk → cooperative
  farmer_id      fk → farmer, must be verified
  role           enum member | chair | treasurer | secretary
  joined_at      date
```

```
user
  role            enum admin | supervisor | read_only
  id              uuid
  name            text
  scope_state_id  fk, nullable
  last_login_at   timestamp
```

Office staff. Officers log in through the `officer` table.

### Field capture

```
farm
  id             uuid
  farmer_id      fk → farmer
  boundary       geojson polygon, nullable
  centroid       geopoint
  area_ha        decimal, derived
  point_count    int
  gps_accuracy_m decimal, at capture
  accuracy_flag  enum good | poor | unusable
  mapped_by      fk → officer
  mapped_at      timestamp
  season         text, e.g. 2026-main
```

```
crop_declaration
  id          uuid
  farm_id     fk → farm
  crop        enum sorghum | groundnut | sesame | maize | cowpea
  season      text
  declared_at timestamp
```

```
sync_record
  id               uuid
  entity_type      enum farmer | farm | visit_note | ai_question
  entity_id        uuid
  device_id        text
  officer_id       fk → officer
  sync_status      enum waiting | sending | synced | failed
  reason_code      text, nullable
  attempt_count    int
  acknowledged_at  timestamp, nullable
```

Per record, per device. The offline spine.

### Review and status

```
verification_event
  id              uuid
  farmer_id       fk → farmer
  reviewer_id     fk → user, nullable    -- B6: the staff decider; null on resubmission
  officer_id      fk → officer, nullable -- B6: the registering officer, on resubmission only
  decision        enum verified | merged | rejected | resubmitted -- B6: every transition has an event
  merge_target_id fk → farmer, nullable
  reason_code     text, fixed keys, required on reject -- B6: CHECK generated from packages/shared
  note            text, nullable, ≤ 280 -- B6: data, not a message; never in audit or error reporting
  days_waiting    int, computed at decision from pending_since
  decided_at      timestamp
```

```
audit_event
  id          uuid
  entity_type text
  entity_id   text      -- uuid or a location code; see DECISIONS (B4)
  actor_type  enum admin | supervisor | read_only | officer | system
  actor_id    uuid, nullable -- no foreign key; see DECISIONS (B4)
  action      text, e.g. field_corrected
  before      json, nullable
  after       json, nullable
  device_id   text, nullable
  occurred_at timestamp
```

Append only. Never updated, never deleted.

```
consent
  id           uuid
  farmer_id    fk → farmer
  text_version text, e.g. v1.0-en
  language     enum en | ar-juba
  granted      boolean
  granted_at   timestamp
  withdrawn_at timestamp, nullable
```

Evidence the farmer agreed, and to what.

### Support and reporting

```
report_export
  id               uuid
  exported_by      fk → user
  report_type      text
  filters          json
  data_cutoff_date date
  row_count        int
  exported_at      timestamp
```

Traceability for every donor figure.

```
ai_question
  id                     uuid
  farmer_id              fk → farmer
  question_text          text
  answer_text            text, nullable until answered
  answered_offline_queue boolean
  escalated_to_officer   fk → officer, nullable
  asked_at               timestamp
```

**Not contracted.** Appears in the interface designs and in no deliverable in
the Inception Report. Do not build until CORWADO confirms in writing. Recorded
here because the designs assume it.

---

## 2. RELATIONSHIPS

- `officer 1 ── n farmer` via `registered_by`. Self-registered farmers have it
  null until an officer picks them up.
- `farmer 1 ── n farm ── n crop_declaration`. A farmer may hold several plots;
  each plot declares crops per season.
- `payam 1 ── n farmer`, `1 ── n officer`, `1 ── n cooperative`. State → county
  → payam is the only location hierarchy, bundled on device.
- `farmer n ── n cooperative` via `cooperative_member`. Membership requires
  `verification_status = verified`. Leadership roles live on the join row.
- `farmer 1 ── n verification_event`. A record can be reviewed more than once:
  rejected, corrected, resubmitted, verified.
- `farmer 0..1 ── farmer` via `merged_into`. A merge points a duplicate at its
  survivor. Neither row is deleted.
- `sync_record n ── 1` polymorphic. Sync state belongs to the record on a
  device, not to the farmer.
- `audit_event n ── 1` any entity.
- `farmer 1 ── 1 consent` current, `1 ── n` historic. Consent is versioned by
  text and language, so what was agreed can be proven.

---

## 3. DATA FLOW, FIELD TO DONOR REPORT

The network edge is the only place a record can stall.

**1 · Capture, offline.** Officer registers a farmer or walks a boundary.
Location lists and validation are already on the device. Inserts farmer, farm
and boundary points, and a `sync_record` set to waiting. Stored in device
SQLite. Nothing has left the phone.

**2 · Queue on device.** Records wait as long as needed. The app bar shows
offline and the home screen shows the pending count. Retry with backoff when
signal returns. Retained until acknowledged.

**3 · Upload and acknowledge.** One transaction per record, idempotent on the
client uuid. Failure sets a reason code and keeps the local row. Duplicate check
runs and warns only. Server row created, `audit_event` appended.

**4 · Review and verify.** Supervisor compares against any duplicate and
decides. Pending past 7 days escalates on the dashboard. A `verification_event`
is written and `verification_status` set. Reject reason returns to the phone.
Rejected and merged rows are kept, not deleted.

**5 · Report to donors.** Reach figures read a verified-only view and say so on
screen and in the PDF. Disaggregated by sex, age and payam. `report_export` logs
the query. No new farmer data, only the export record.

### Where a record can stall

Only at the network edge. A failed upload sets `sync_status = failed` with a
reason code, keeps the local row, and schedules a retry. The server row is never
partially written.

Reason codes: `no_network`, `payload_too_large`, `auth_expired`,
`server_error`, `conflict`.

### Conflicts and duplicates

Records are created with a client-side UUID, so a retried upload is idempotent,
never a second row. Duplicate detection runs server-side on phone number, and on
name plus payam, producing a `duplicate_flag`. **It warns the reviewer. It never
blocks the save.**

Resolution: `verify_as_new`, `merge_into(target_id)`, `reject(reason)`.

### What reaches a donor report

Reporting reads a verified-only view. Pending and rejected rows are counted
separately and never folded into reach figures. Every export records the query,
the filters and the data cut-off date, so a number in a PDF can be traced back
to rows.

---

## 4. STATE MACHINES

The two lifecycles the interface renders everywhere. They are independent: a
record can be synced and still pending.

### sync_status — per record, per device

```
waiting → sending → synced
sending ⇄ failed          retry returns it to waiting
```

Transition to `synced` requires a server acknowledgement carrying the record id.
Local rows are retained for 30 days after that, as the officer's proof of work,
then pruned. Nothing is pruned in any other state.

### verification_status — per farmer record, server side

```
pending  → verified
pending  → rejected
rejected → pending      on resubmission after correction (B6)
any      → merged       via merged_into (B6: a state, not only a pointer)
```

A merge sets the source record's `merged_into` and keeps it; it is never
dropped. Rejection requires a written reason, which is sent back to the
officer's device. Re-submission after correction returns the record to pending,
and the escalation clock restarts.

Escalation: a record still pending after 7 days surfaces at the top of the
supervisor dashboard, with days-waiting shown.

---

## 5. OPEN QUESTIONS FOR THE PROGRAMME MANAGER

Unanswered. Three of these change the schema.

1. Is national ID mandatory for verification, or is officer attestation enough
   where farmers have no ID document?
2. Who may see GPS boundaries and national IDs? The model assumes admins and the
   assigned officer only.
3. How long is personal data retained after the LAST Project closes, and what
   does a farmer's removal request delete?
4. Can a farmer belong to more than one cooperative? The model currently allows
   it.
5. Are AI questions and answers stored against the farmer record, and are they
   visible to supervisors? (Moot unless the AI feature is confirmed at all.)
6. Does a re-mapped farm boundary replace the old one, or is the history kept
   for season-on-season comparison?

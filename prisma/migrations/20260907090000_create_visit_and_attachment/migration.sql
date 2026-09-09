-- Migration 15 (B8): visit, visit_attachment. C-8.
--
-- PostGIS through raw SQL, columns SCHEMA-QUALIFIED (extensions schema, as
-- migration 14). Additive.

-- Nine topics, from docs/data-model-extension.md §2 (the report itself names
-- none). Short on purpose: a list an officer scrolls past is a list they tick
-- the first item on. The shared VISIT_TOPICS list is the same nine.
CREATE TYPE "public"."visit_topic" AS ENUM (
    'land_preparation', 'planting', 'weeding', 'pest', 'disease',
    'harvest', 'storage', 'market', 'other'
);
CREATE TYPE "public"."attachment_kind"   AS ENUM ('photo', 'audio');
-- waiting: the row is here, the bytes are not. arrived: confirmed against the
-- declared size and type. failed: gave up, with a code (C-8.7).
CREATE TYPE "public"."attachment_status" AS ENUM ('waiting', 'arrived', 'failed');

-- -----------------------------------------------------------------------------
-- visit: one farmer, one officer, one standing point, two moments (C-8.1–C-8.5).
-- The five columns that make it evidence rather than a note — farmer, officer,
-- position, visited_at, received_at — are never updated (C-8.10); the trigger
-- below refuses.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."visit" (
    -- Client-generated (C-8.6 / B9): a retried upload is the same visit.
    "id"               UUID        NOT NULL,
    "farmer_id"        UUID        NOT NULL,
    -- References officer, never user: an administrator cannot record a visit (C-8.10).
    "officer_id"       UUID        NOT NULL,
    "payam_id"         TEXT        NOT NULL,
    "county_id"        TEXT        NOT NULL,
    "state_id"         TEXT        NOT NULL,
    -- Where the officer stood. A single point, stored and shown, not graded (C-8.4).
    "position"         extensions.geography(Point, 4326) NOT NULL,
    "gps_accuracy_m"   NUMERIC(7, 1) NOT NULL,
    -- The substance (C-8.13). Observation may be empty; advice may not (C-8.1).
    "observation"      TEXT,
    "advice"           TEXT        NOT NULL,
    "topics"           "public"."visit_topic"[] NOT NULL,
    "duration_minutes" INTEGER,
    "attendee_count"   INTEGER,
    "follow_up_of"     UUID,
    -- The device's moment, as given; the server's moment, never the device's,
    -- for every coverage figure (C-8.5).
    "visited_at"       TIMESTAMPTZ NOT NULL,
    "received_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"       TIMESTAMPTZ,
    "deleted_by"       UUID,
    CONSTRAINT "visit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visit_farmer_id_fkey"  FOREIGN KEY ("farmer_id")  REFERENCES "public"."farmer"("id"),
    CONSTRAINT "visit_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "public"."officer"("id"),
    CONSTRAINT "visit_payam_id_fkey"   FOREIGN KEY ("payam_id")   REFERENCES "public"."payam"("id"),
    CONSTRAINT "visit_county_id_fkey"  FOREIGN KEY ("county_id")  REFERENCES "public"."county"("id"),
    CONSTRAINT "visit_state_id_fkey"   FOREIGN KEY ("state_id")   REFERENCES "public"."state"("id"),
    CONSTRAINT "visit_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id") REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "visit_payam_county_consistent_fkey"
        FOREIGN KEY ("payam_id", "county_id") REFERENCES "public"."payam"("id", "county_id"),
    CONSTRAINT "visit_follow_up_of_fkey" FOREIGN KEY ("follow_up_of") REFERENCES "public"."visit"("id"),
    CONSTRAINT "visit_deleted_by_fkey"   FOREIGN KEY ("deleted_by")   REFERENCES "public"."user"("id"),
    CONSTRAINT "visit_accuracy_nonneg"   CHECK ("gps_accuracy_m" >= 0),
    -- Generated from VISIT_LIMITS in packages/shared/src/visit.ts.
    CONSTRAINT "visit_advice_not_blank"  CHECK (btrim("advice") <> ''),
    CONSTRAINT "visit_advice_length"     CHECK (char_length("advice") <= 4000),
    CONSTRAINT "visit_observation_shape" CHECK ("observation" IS NULL OR (btrim("observation") <> '' AND char_length("observation") <= 4000)),
    CONSTRAINT "visit_topics_not_empty"  CHECK (cardinality("topics") >= 1),
    CONSTRAINT "visit_duration_range"    CHECK ("duration_minutes" IS NULL OR ("duration_minutes" >= 1 AND "duration_minutes" <= 1440)),
    CONSTRAINT "visit_attendees_range"   CHECK ("attendee_count" IS NULL OR ("attendee_count" >= 1 AND "attendee_count" <= 10000)),
    CONSTRAINT "visit_not_own_follow_up" CHECK ("follow_up_of" IS NULL OR "follow_up_of" <> "id")
);

CREATE INDEX "visit_farmer_received_idx"  ON "public"."visit" ("farmer_id", "received_at" DESC, "id" DESC);
CREATE INDEX "visit_officer_received_idx" ON "public"."visit" ("officer_id", "received_at" DESC, "id" DESC);
CREATE INDEX "visit_coverage_idx"         ON "public"."visit" ("state_id", "county_id", "payam_id", "received_at") WHERE "deleted_at" IS NULL;
CREATE INDEX "visit_follow_up_of_idx"     ON "public"."visit" ("follow_up_of") WHERE "follow_up_of" IS NOT NULL;
CREATE INDEX "visit_position_gist_idx"    ON "public"."visit" USING GIST ("position");

-- -----------------------------------------------------------------------------
-- Follow-up guard (C-8.3, owner's addition): the target belongs to the same
-- farmer, is not removed, and following it back never reaches this visit. A
-- retried sync could produce the cycle an officer never would. The route
-- says each of these in its own sentence first; this is the backstop.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."visit_follow_up_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    target public.visit%ROWTYPE;
    cyclic boolean;
BEGIN
    IF NEW.follow_up_of IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO target FROM public.visit WHERE id = NEW.follow_up_of;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'visit_follow_up_target_missing' USING ERRCODE = '23503';
    END IF;
    IF target.farmer_id <> NEW.farmer_id THEN
        RAISE EXCEPTION 'visit_follow_up_other_farmer' USING ERRCODE = '23514';
    END IF;
    IF target.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'visit_follow_up_removed' USING ERRCODE = '23514';
    END IF;
    WITH RECURSIVE chain AS (
        SELECT v.id, v.follow_up_of, 1 AS depth FROM public.visit v WHERE v.id = NEW.follow_up_of
        UNION ALL
        SELECT v.id, v.follow_up_of, c.depth + 1 FROM public.visit v JOIN chain c ON v.id = c.follow_up_of
        WHERE c.depth < 10000
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE id = NEW.id) INTO cyclic;
    IF cyclic THEN
        RAISE EXCEPTION 'visit_follow_up_cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER "visit_follow_up_guard_trg"
    BEFORE INSERT OR UPDATE OF "follow_up_of" ON "public"."visit"
    FOR EACH ROW EXECUTE FUNCTION "public"."visit_follow_up_guard"();

-- The five evidence columns are immutable (C-8.10).
CREATE OR REPLACE FUNCTION "public"."visit_evidence_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.farmer_id <> OLD.farmer_id OR NEW.officer_id <> OLD.officer_id
       OR NOT extensions.ST_Equals(NEW.position::extensions.geometry, OLD.position::extensions.geometry)
       OR NEW.gps_accuracy_m <> OLD.gps_accuracy_m
       OR NEW.visited_at <> OLD.visited_at OR NEW.received_at <> OLD.received_at THEN
        RAISE EXCEPTION 'visit_evidence_immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER "visit_evidence_immutable_trg"
    BEFORE UPDATE ON "public"."visit"
    FOR EACH ROW EXECUTE FUNCTION "public"."visit_evidence_immutable"();

-- -----------------------------------------------------------------------------
-- visit_attachment: a separate record that travels separately (C-8.6). The row
-- arrives with the visit; the bytes arrive when the phone can. The status is
-- what the officer, and everyone entitled to the visit, sees (C-8.7).
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."visit_attachment" (
    "id"               UUID        NOT NULL,
    "visit_id"         UUID        NOT NULL,
    "kind"             "public"."attachment_kind"   NOT NULL,
    "status"           "public"."attachment_status" NOT NULL DEFAULT 'waiting',
    -- Chosen by the server from the two ids, never by the client (C-8.8).
    "storage_path"     TEXT        NOT NULL,
    "content_type"     TEXT        NOT NULL,
    "byte_size"        INTEGER     NOT NULL,
    -- The device's moment of capture; the row's arrival is created_at.
    "captured_at"      TIMESTAMPTZ NOT NULL,
    -- Our expiry on the upload grant, in minutes. The provider's token lives
    -- two hours and cannot be shortened; a confirm after this moment removes
    -- the object and fails the row (docs/DECISIONS.md, B8).
    "grant_expires_at" TIMESTAMPTZ NOT NULL,
    "arrived_at"       TIMESTAMPTZ,
    "failed_at"        TIMESTAMPTZ,
    "failure_code"     TEXT,
    "created_by"       UUID        NOT NULL,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "visit_attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visit_attachment_visit_id_fkey"   FOREIGN KEY ("visit_id")   REFERENCES "public"."visit"("id"),
    CONSTRAINT "visit_attachment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."officer"("id"),
    CONSTRAINT "visit_attachment_storage_path_key" UNIQUE ("storage_path"),
    -- Generated from ATTACHMENT_LIMITS and ATTACHMENT_CONTENT_TYPES in packages/shared/src/visit.ts.
    CONSTRAINT "visit_attachment_size_range" CHECK (
        ("kind" = 'photo' AND "byte_size" >= 1 AND "byte_size" <= 15728640) OR
        ("kind" = 'audio' AND "byte_size" >= 1 AND "byte_size" <= 26214400)
    ),
    CONSTRAINT "visit_attachment_type_matches_kind" CHECK (
        ("kind" = 'photo' AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp')) OR
        ("kind" = 'audio' AND "content_type" IN ('audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm'))
    ),
    CONSTRAINT "visit_attachment_status_dates" CHECK (
        ("status" = 'waiting' AND "arrived_at" IS NULL AND "failed_at" IS NULL AND "failure_code" IS NULL) OR
        ("status" = 'arrived' AND "arrived_at" IS NOT NULL AND "failed_at" IS NULL AND "failure_code" IS NULL) OR
        ("status" = 'failed'  AND "arrived_at" IS NULL AND "failed_at" IS NOT NULL AND "failure_code" IS NOT NULL)
    ),
    -- Generated from ATTACHMENT_FAILURE_CODES in packages/shared/src/visit.ts.
    CONSTRAINT "visit_attachment_failure_code_known" CHECK (
        "failure_code" IS NULL OR "failure_code" IN ('size_mismatch', 'type_mismatch', 'grant_expired', 'device_gave_up')
    )
);

CREATE INDEX "visit_attachment_visit_idx" ON "public"."visit_attachment" ("visit_id", "captured_at", "id");

ALTER TABLE "public"."visit"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."visit_attachment" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Views under the B6 rule. visit_active is a filter of visit and carries every
-- column; extension_coverage_v is an aggregate, NOT named after a table.
-- -----------------------------------------------------------------------------
CREATE VIEW "public"."visit_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."visit" WHERE "deleted_at" IS NULL;

-- Coverage (C-8.5, C-8.11, reporting law): by place and by month of the
-- SERVER's moment. Visits to verified farmers are the figure; visits to
-- farmers in any other state are counted beside it and never folded in.
CREATE VIEW "public"."extension_coverage_v" WITH (security_invoker = true) AS
    SELECT v."state_id", v."county_id", v."payam_id",
           date_trunc('month', v."received_at")::date AS "month",
           count(*) FILTER (WHERE f."verification_status" = 'verified')::int AS "verified_visits",
           count(DISTINCT v."farmer_id") FILTER (WHERE f."verification_status" = 'verified')::int AS "verified_farmers_visited",
           count(*) FILTER (WHERE f."verification_status" <> 'verified')::int AS "other_visits",
           count(DISTINCT v."farmer_id") FILTER (WHERE f."verification_status" <> 'verified')::int AS "other_farmers_visited"
    FROM "public"."visit" v
    JOIN "public"."farmer" f ON f."id" = v."farmer_id"
    WHERE v."deleted_at" IS NULL AND f."deleted_at" IS NULL
    GROUP BY v."state_id", v."county_id", v."payam_id", date_trunc('month', v."received_at");

-- -----------------------------------------------------------------------------
-- audit_event: six more action keys, generated from AUDIT_ACTIONS.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted',
    'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
    'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed'
));

-- Migration 23 (C-16): the weather tile. weather_location, weather_observation,
-- weather_forecast, and three audit action keys. Additive.
--
-- THREE TABLES, NOT THE TWO C-16.1 NAMED. Section 8 of the extension document
-- drew location + forecast. Current conditions have a different shape from a
-- daily forecast row, and a fetch must not look like an edit to a location
-- (C-16.11: the fetch is not audited, an edit is). So the observation has its
-- own table rather than living as columns on the location or as a forecast row
-- for today. Recorded in CONVENTIONS section 18 as a divergence from the
-- criterion's count and not its substance.
--
-- THREE CORRECTIONS TO SECTION 8, each a criterion:
--   C-16.3  every scoped row carries state_id, denormalised, with the composite
--           key to payam(id, state_id) that every scoped table has had since
--           migration 6 -- so a scope check is not a join and the hierarchy
--           cannot disagree with itself.
--   C-16.4  deleted_at beside active, as directory_entry has: active is
--           "not in use", deleted_at is "removed", and a removed row appears in
--           no list, count or export.
--   C-16.5  no sms_campaign_id. The table it would reference does not exist
--           until C-15; a foreign key to nothing cannot be written and an
--           unconstrained id stays unconstrained in production.
--
-- COUNTY LEVEL TO START (C-16.13). A location has a county and a state always,
-- and a payam only when it is payam-level. South Sudan has about thirteen
-- working weather stations, so adjacent payams read alike; a county centroid
-- gives nearly the same information for a sixth of the calls. payam_id is
-- therefore nullable, and the composite key to payam is MATCH SIMPLE: not
-- enforced when payam_id is null, enforced when it is not.
--
-- RE-POINTABLE (C-16.14). The location hierarchy is placeholder data (I-07).
-- Nothing here derives a location's identity from anything but its foreign
-- keys, so CORWADO's real list can be loaded and these rows re-pointed, as
-- migration 20 did for reporting.

CREATE TABLE "public"."weather_location" (
    "id"          UUID          NOT NULL DEFAULT gen_random_uuid(),
    "name"        TEXT          NOT NULL,
    -- county | payam. A CHECK, not an enum: two values, and an enum is a type
    -- to migrate if a third ever appears.
    "level"       TEXT          NOT NULL,
    "state_id"    TEXT          NOT NULL,
    "county_id"   TEXT          NOT NULL,
    "payam_id"    TEXT,
    "latitude"    NUMERIC(8, 5) NOT NULL,
    "longitude"   NUMERIC(8, 5) NOT NULL,
    "active"      BOOLEAN       NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "deleted_at"  TIMESTAMPTZ,
    "deleted_by"  UUID,
    CONSTRAINT "weather_location_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weather_location_state_id_fkey"  FOREIGN KEY ("state_id")  REFERENCES "public"."state"("id"),
    CONSTRAINT "weather_location_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "public"."county"("id"),
    CONSTRAINT "weather_location_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id") REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "weather_location_county_state_consistent_fkey"
        FOREIGN KEY ("county_id", "state_id") REFERENCES "public"."county"("id", "state_id"),
    CONSTRAINT "weather_location_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "weather_location_level_known" CHECK ("level" IN ('county', 'payam')),
    -- A payam-level row names its payam; a county-level row has none. Explicit, never a null that means something.
    CONSTRAINT "weather_location_level_payam_pair" CHECK (
        ("level" = 'payam' AND "payam_id" IS NOT NULL) OR ("level" = 'county' AND "payam_id" IS NULL)
    ),
    CONSTRAINT "weather_location_lat_range" CHECK ("latitude"  BETWEEN -90  AND 90),
    CONSTRAINT "weather_location_lon_range" CHECK ("longitude" BETWEEN -180 AND 180)
);
CREATE INDEX "weather_location_state_idx"  ON "public"."weather_location" ("state_id");
CREATE INDEX "weather_location_county_idx" ON "public"."weather_location" ("county_id");

-- Current conditions: one row per location per day, upserted (C-16.6). The
-- observation is the provider's, at its moment; fetched_at is ours.
CREATE TABLE "public"."weather_observation" (
    "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
    "weather_location_id" UUID          NOT NULL,
    "observed_at"         TIMESTAMPTZ   NOT NULL,
    "fetched_at"          TIMESTAMPTZ   NOT NULL,
    -- The fetch's calendar date, so one-per-day is a plain unique key and not
    -- an expression Prisma cannot describe.
    "fetched_on"          DATE          NOT NULL,
    "temp_c"              NUMERIC(5, 1) NOT NULL,
    "humidity_pct"        NUMERIC(5, 1) NOT NULL,
    "wind_kph"            NUMERIC(6, 1) NOT NULL,
    "rain_mm"             NUMERIC(6, 1) NOT NULL DEFAULT 0,
    "conditions"          TEXT          NOT NULL,
    "icon"                TEXT,
    -- The provider's response as received (C-16.1 raw): when the data behind
    -- this improves, it is how anyone reconstructs what we showed and why.
    "raw"                 JSONB         NOT NULL,
    "created_at"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT "weather_observation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weather_observation_location_fkey"
        FOREIGN KEY ("weather_location_id") REFERENCES "public"."weather_location"("id"),
    CONSTRAINT "weather_observation_one_per_day" UNIQUE ("weather_location_id", "fetched_on")
);

-- Daily forecast rows, aggregated in the location's timezone from the provider's
-- three-hour slots, starting tomorrow. Numbers only, never a sentence (C-16.1).
CREATE TABLE "public"."weather_forecast" (
    "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
    "weather_location_id" UUID          NOT NULL,
    "forecast_for"        DATE          NOT NULL,
    "fetched_at"          TIMESTAMPTZ   NOT NULL,
    "temp_max_c"          NUMERIC(5, 1) NOT NULL,
    "temp_min_c"          NUMERIC(5, 1) NOT NULL,
    "rain_mm"             NUMERIC(6, 1) NOT NULL DEFAULT 0,
    "rain_probability"    NUMERIC(3, 2) NOT NULL DEFAULT 0,
    "humidity_pct"        NUMERIC(5, 1) NOT NULL,
    "wind_kph"            NUMERIC(6, 1) NOT NULL,
    "conditions"          TEXT          NOT NULL,
    "icon"                TEXT,
    "raw"                 JSONB         NOT NULL,
    "created_at"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT "weather_forecast_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weather_forecast_location_fkey"
        FOREIGN KEY ("weather_location_id") REFERENCES "public"."weather_location"("id"),
    -- One fetch per location per day is only enforceable with this (C-16.6):
    -- a retried job upserts here and produces no duplicate.
    CONSTRAINT "weather_forecast_one_per_day" UNIQUE ("weather_location_id", "forecast_for"),
    CONSTRAINT "weather_forecast_temps_ordered" CHECK ("temp_min_c" <= "temp_max_c"),
    CONSTRAINT "weather_forecast_probability_range" CHECK ("rain_probability" BETWEEN 0 AND 1)
);
CREATE INDEX "weather_forecast_location_day_idx" ON "public"."weather_forecast" ("weather_location_id", "forecast_for");

-- Deny-by-default backstop, as every table (CLAUDE.md section 4).
ALTER TABLE "public"."weather_location"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."weather_observation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."weather_forecast"    ENABLE ROW LEVEL SECURITY;

-- updated_at moves on every UPDATE, so a device or a reader can tell a changed
-- row from an unchanged one -- the eighth silent-class instance was a column
-- nobody wrote. set_updated_at exists since migration 18.
CREATE TRIGGER "weather_location_set_updated_at" BEFORE UPDATE ON "public"."weather_location"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "weather_forecast_set_updated_at" BEFORE UPDATE ON "public"."weather_forecast"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Under the B6 rule: a filter of the table, every column.
CREATE VIEW "public"."weather_location_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."weather_location" WHERE "deleted_at" IS NULL;

-- Audit actions: three keys, in lockstep with AUDIT_ACTIONS and CONVENTIONS
-- section 5.2.2. The list below is GENERATED from the constant: 50 keys.
-- packages/shared/tests/audit-check-matches-migrations.test.ts fails the build
-- if this list and the constant ever differ.
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
        'user.created',
        'user.updated',
        'user.password_set',
        'user.soft_deleted',
        'officer.created',
        'officer.updated',
        'officer.status_changed',
        'officer.password_set',
        'officer.soft_deleted',
        'auth.disabled',
        'auth.disable_failed',
        'auth.account_orphaned',
        'location.created',
        'location.renamed',
        'location.soft_deleted',
        'farmer.created',
        'farmer.updated',
        'farmer.soft_deleted',
        'consent.recorded',
        'farmer.verified',
        'farmer.rejected',
        'farmer.merged',
        'farmer.resubmitted',
        'farmer.reassigned',
        'farm.created',
        'farm.boundary_added',
        'farm.boundary_superseded',
        'farm.crops_declared',
        'farm.soft_deleted',
        'farm.repointed',
        'visit.recorded',
        'visit.corrected',
        'visit.soft_deleted',
        'visit.attachment_declared',
        'visit.attachment_arrived',
        'visit.attachment_failed',
        'visit.attachment_link_issued',
        'visit.repointed',
        'report.exported',
        'system.restored',
        'directory_entry.created',
        'directory_entry.updated',
        'directory_entry.soft_deleted',
        'learning_resource.created',
        'learning_resource.updated',
        'learning_resource.published',
        'learning_resource.soft_deleted',
        'weather_location.created',
        'weather_location.updated',
        'weather_location.soft_deleted'
    ));

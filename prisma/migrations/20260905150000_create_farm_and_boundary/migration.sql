-- Migration 14 (B7): farm, farm_boundary, crop_declaration. C-7.
--
-- PostGIS through raw SQL, columns SCHEMA-QUALIFIED: PostGIS lives in the
-- "extensions" schema (migration 1) and an unqualified geography fails on
-- the migration connection (P1 learned this). Additive.

CREATE TYPE "public"."accuracy_flag" AS ENUM ('good', 'poor', 'unusable');

-- -----------------------------------------------------------------------------
-- farm: one farmer, one first season, a client-generated id (C-7.1, B9).
-- Denormalised payam/county/state from the farmer, enforced by the same two
-- composite keys farmer carries (C-5.5), so a farm cannot disagree with its
-- farmer's payam about where it is.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."farm" (
    "id"         UUID        NOT NULL,
    "farmer_id"  UUID        NOT NULL,
    "payam_id"   TEXT        NOT NULL,
    "county_id"  TEXT        NOT NULL,
    "state_id"   TEXT        NOT NULL,
    -- The season the farm was first mapped for. Shape: 2026-main / 2026-second
    -- (SEASON_NAMES in packages/shared; the CHECK is generated from it).
    "season"     TEXT        NOT NULL,
    -- The officer who walked it first. References officer, never user: an
    -- administrator cannot be recorded here (C-7.6).
    "created_by" UUID        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,
    CONSTRAINT "farm_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "farm_season_shape" CHECK ("season" ~ '^[0-9]{4}-(main|second)$'),
    CONSTRAINT "farm_farmer_id_fkey" FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "farm_payam_id_fkey" FOREIGN KEY ("payam_id") REFERENCES "public"."payam"("id"),
    CONSTRAINT "farm_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "public"."county"("id"),
    CONSTRAINT "farm_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "farm_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id") REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "farm_payam_county_consistent_fkey"
        FOREIGN KEY ("payam_id", "county_id") REFERENCES "public"."payam"("id", "county_id"),
    CONSTRAINT "farm_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."officer"("id"),
    CONSTRAINT "farm_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
);

-- -----------------------------------------------------------------------------
-- farm_boundary: history kept, never overwritten (C-7.5). One current per farm
-- per season is a database fact: the partial unique index below.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."farm_boundary" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "farm_id"        UUID        NOT NULL,
    "season"         TEXT        NOT NULL,
    -- Stored counter-clockwise whichever way the officer walked (ST_ForcePolygonCCW).
    "boundary"       extensions.geography(Polygon, 4326) NOT NULL,
    "centroid"       extensions.geography(Point, 4326)   NOT NULL,
    -- ST_Area on geography, square metres to hectares, four decimals (C-7.3).
    "area_ha"        NUMERIC(12, 4) NOT NULL,
    -- Distinct vertices, closing repeat not counted (C-7.2).
    "point_count"    INTEGER     NOT NULL,
    "gps_accuracy_m" NUMERIC(7, 1) NOT NULL,
    "accuracy_flag"  "public"."accuracy_flag" NOT NULL,
    -- References officer, never user (C-7.6).
    "mapped_by"      UUID        NOT NULL,
    "mapped_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "is_current"     BOOLEAN     NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "farm_boundary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "farm_boundary_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id"),
    CONSTRAINT "farm_boundary_mapped_by_fkey" FOREIGN KEY ("mapped_by") REFERENCES "public"."officer"("id"),
    CONSTRAINT "farm_boundary_season_shape" CHECK ("season" ~ '^[0-9]{4}-(main|second)$'),
    CONSTRAINT "farm_boundary_area_nonneg" CHECK ("area_ha" >= 0),
    CONSTRAINT "farm_boundary_points_min" CHECK ("point_count" >= 4),
    CONSTRAINT "farm_boundary_accuracy_nonneg" CHECK ("gps_accuracy_m" >= 0),
    -- Generated from ACCURACY_THRESHOLDS in packages/shared/src/farm.ts:
    -- good <= 10, poor > 10 and <= 30, unusable > 30. The same numbers, so the
    -- grade the code assigns and the grade the database accepts cannot drift.
    CONSTRAINT "farm_boundary_grade_matches_accuracy" CHECK (
        ("accuracy_flag" = 'good'     AND "gps_accuracy_m" <= 10) OR
        ("accuracy_flag" = 'poor'     AND "gps_accuracy_m" > 10 AND "gps_accuracy_m" <= 30) OR
        ("accuracy_flag" = 'unusable' AND "gps_accuracy_m" > 30)
    ),
    -- Backstop for the module's own checks (C-7.2); the sentences are the module's.
    CONSTRAINT "farm_boundary_geometry_valid" CHECK (extensions.ST_IsValid("boundary"::extensions.geometry))
);

CREATE UNIQUE INDEX "farm_boundary_one_current_per_season"
    ON "public"."farm_boundary" ("farm_id", "season") WHERE "is_current";
CREATE INDEX "farm_boundary_history_idx"
    ON "public"."farm_boundary" ("farm_id", "season", "mapped_at" DESC);
CREATE INDEX "farm_boundary_boundary_gist_idx"
    ON "public"."farm_boundary" USING GIST ("boundary");
CREATE INDEX "farm_boundary_centroid_gist_idx"
    ON "public"."farm_boundary" USING GIST ("centroid");

-- -----------------------------------------------------------------------------
-- crop_declaration: per farm per season, from the fixed crop list (C-7.7).
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."crop_declaration" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "farm_id"     UUID        NOT NULL,
    "season"      TEXT        NOT NULL,
    "crop"        "public"."crop" NOT NULL,
    "declared_by" UUID        NOT NULL,
    "declared_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "crop_declaration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crop_declaration_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id"),
    CONSTRAINT "crop_declaration_declared_by_fkey" FOREIGN KEY ("declared_by") REFERENCES "public"."officer"("id"),
    CONSTRAINT "crop_declaration_season_shape" CHECK ("season" ~ '^[0-9]{4}-(main|second)$'),
    CONSTRAINT "crop_declaration_one_per_crop_per_season" UNIQUE ("farm_id", "season", "crop")
);

CREATE INDEX "farm_farmer_id_idx" ON "public"."farm" ("farmer_id");
CREATE INDEX "farm_scope_idx" ON "public"."farm" ("state_id", "payam_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "farm_created_idx" ON "public"."farm" ("created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;

ALTER TABLE "public"."farm"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."farm_boundary"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."crop_declaration" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Views under the B6 rule. farm_active and farm_mapped_v are filters of farm
-- and carry every column; area_totals_v is an aggregate and is NOT named
-- after a table.
-- -----------------------------------------------------------------------------
CREATE VIEW "public"."farm_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farm" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."farm_mapped_v" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    WHERE f."deleted_at" IS NULL AND EXISTS (
        SELECT 1 FROM "public"."farm_boundary" b
        WHERE b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    );

-- Area totals: current boundaries only, unusable excluded, season named (C-7.4, C-7.5).
CREATE VIEW "public"."area_totals_v" WITH (security_invoker = true) AS
    SELECT f."state_id", f."county_id", f."payam_id", b."season",
           count(*)::int AS "farms", sum(b."area_ha") AS "hectares"
    FROM "public"."farm" f
    JOIN "public"."farm_boundary" b ON b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    WHERE f."deleted_at" IS NULL
    GROUP BY f."state_id", f."county_id", f."payam_id", b."season";

-- -----------------------------------------------------------------------------
-- audit_event: five more action keys, generated from AUDIT_ACTIONS.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted'
));

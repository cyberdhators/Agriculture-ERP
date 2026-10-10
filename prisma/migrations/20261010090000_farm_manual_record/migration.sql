-- 2026-10-10 -- an officer records a farm by hand. The owner: "forget the GIS
-- mapping for now and add a form the extension officer can use to manually
-- record the farm information; GIS mapping should still be there but will be
-- added as we go along."
--
-- A farm has always been created BY mapping it: the first boundary came with
-- the farm. A farm recorded by hand has no boundary yet; it can be mapped later
-- through the existing POST /api/farms/:id/boundaries, and from then on it is a
-- mapped farm like any other. Every report that reads area reads boundaries
-- (area_totals_v, farm_mapped_v), so a hand-recorded farm adds nothing to a
-- mapped-area figure: the size an officer writes down is what the farmer
-- declared, not a measurement, and is kept in its own columns and unit.
--
-- ADDITIVE ONLY: nullable columns on farm, and farm_active / farm_mapped_v
-- recreated so their SELECT * carries them. No new audit actions -- a farm
-- recorded by hand is `farm.created`, its crops `farm.crops_declared`.

ALTER TABLE "public"."farm"
    ADD COLUMN "name"                TEXT,
    ADD COLUMN "size_value"          DECIMAL(10, 2),
    ADD COLUMN "size_unit"           TEXT,
    ADD COLUMN "tenure"              TEXT,
    ADD COLUMN "village"             TEXT,
    ADD COLUMN "location_note"       TEXT,
    -- One point, taken from the phone standing at the farm, when the officer
    -- chooses to. Not a boundary and never counted as one.
    ADD COLUMN "location"            extensions.geography(Point, 4326),
    ADD COLUMN "location_accuracy_m" DECIMAL(7, 1),
    ADD COLUMN "notes"               TEXT;

-- The lists are LAND_UNITS and LAND_TENURES in packages/shared (the same lists
-- the farmer profile uses, farmer_profile_land_unit / _land_tenure).
ALTER TABLE "public"."farm"
    ADD CONSTRAINT "farm_size_pair"
        CHECK (("size_value" IS NULL) = ("size_unit" IS NULL)),
    ADD CONSTRAINT "farm_size_positive"
        CHECK ("size_value" IS NULL OR "size_value" > 0),
    ADD CONSTRAINT "farm_size_unit"
        CHECK ("size_unit" IS NULL OR "size_unit" IN ('feddan', 'acre', 'hectare')),
    ADD CONSTRAINT "farm_tenure"
        CHECK ("tenure" IS NULL OR "tenure" IN ('owned', 'rented', 'communal', 'other')),
    ADD CONSTRAINT "farm_location_accuracy_pair"
        CHECK ("location_accuracy_m" IS NULL OR "location" IS NOT NULL),
    ADD CONSTRAINT "farm_location_accuracy_range"
        CHECK ("location_accuracy_m" IS NULL OR "location_accuracy_m" BETWEEN 0 AND 9999),
    ADD CONSTRAINT "farm_text_lengths"
        CHECK (coalesce(length("name"), 0) <= 120
           AND coalesce(length("village"), 0) <= 120
           AND coalesce(length("location_note"), 0) <= 500
           AND coalesce(length("notes"), 0) <= 2000);

-- A SELECT * view freezes its column list when it is created; CREATE OR
-- REPLACE may append columns, which is what happened to the table. Both
-- farm-named filter views are recreated with their filters unchanged
-- (20260908150000_reporting_repoint_and_export).
CREATE OR REPLACE VIEW "public"."farm_active" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    JOIN "public"."farmer" fr ON fr."id" = f."farmer_id"
    WHERE f."deleted_at" IS NULL AND fr."deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."farm_mapped_v" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    JOIN "public"."farmer" fr ON fr."id" = f."farmer_id"
    WHERE f."deleted_at" IS NULL AND fr."deleted_at" IS NULL AND EXISTS (
        SELECT 1 FROM "public"."farm_boundary" b
        WHERE b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    );

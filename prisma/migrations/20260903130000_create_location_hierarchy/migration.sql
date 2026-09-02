-- Migration 5 -- unit B2, the location hierarchy
--
-- Criteria C-2.1 to C-2.8 in docs/scope-and-acceptance.md.
-- Shapes from docs/data-model-extension.md 1.2 and 1.3, and docs/data-model.md.
--
-- This is the first migration that creates real tables, so it sets the pattern
-- every later table inherits. Four things are deliberate and should be copied:
--
--   1. RLS enabled in the same migration, with no policies (the rule in
--      migration 2). Deny-by-default against the anon and authenticated keys.
--   2. Views created WITH (security_invoker = true). Without it a view runs as
--      its owner and reads straight past the RLS above, which would make the
--      backstop decorative. Postgres 17.6 here, so it is available.
--   3. deleted_at / deleted_by on every table, per extension 1.3.
--   4. Codes as primary keys, not uuids. Location codes appear in donor
--      exports, where CE-JUB is meaningful and a uuid is not.

-- =============================================================================
-- STATE
-- =============================================================================

CREATE TABLE "public"."state" (
    "id"         TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "active"     BOOLEAN     NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    -- No foreign key yet: the user table does not exist until B3, which adds
    -- the constraint with ALTER TABLE. Carrying the column now keeps its shape
    -- stable, and adding a constraint to a populated table is cheaper and safer
    -- than adding a column to one. See docs/DECISIONS.md.
    "deleted_by" UUID,

    CONSTRAINT "state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "state_id_format" CHECK ("id" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
    CONSTRAINT "state_name_not_blank" CHECK (btrim("name") <> '')
);

-- =============================================================================
-- COUNTY
-- =============================================================================

CREATE TABLE "public"."county" (
    "id"         TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "state_id"   TEXT        NOT NULL,
    "active"     BOOLEAN     NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,

    CONSTRAINT "county_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "county_id_format" CHECK ("id" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
    CONSTRAINT "county_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "county_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),

    -- Not a duplicate of the primary key. It is the target the payam composite
    -- foreign key below needs, and it is what makes C-2.3 enforceable.
    CONSTRAINT "county_id_state_id_key" UNIQUE ("id", "state_id")
);

-- =============================================================================
-- PAYAM
-- =============================================================================
--
-- C-2.3: every payam belongs to one county, every county to one state, and the
-- payam's own state_id always equals the state of its county.
--
-- Enforced by a COMPOSITE FOREIGN KEY (county_id, state_id) -> county(id,
-- state_id), not by a trigger and not by a CHECK. A CHECK cannot see another
-- table. A trigger can be disabled and has to be written correctly for updates
-- on both sides. The composite key is declarative, is enforced on insert and on
-- update, and also stops a county being moved to another state while payams
-- still point at the old one.

CREATE TABLE "public"."payam" (
    "id"         TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "county_id"  TEXT        NOT NULL,
    -- Denormalised, per extension 1.4: every entity a supervisor can be scoped
    -- to carries state_id directly, so a permission check is not a join.
    "state_id"   TEXT        NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" UUID,

    CONSTRAINT "payam_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payam_id_format" CHECK ("id" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
    CONSTRAINT "payam_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "payam_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "payam_county_state_consistent_fkey"
        FOREIGN KEY ("county_id", "state_id")
        REFERENCES "public"."county"("id", "state_id")
);

-- =============================================================================
-- LOCATION BUNDLE  (C-2.4, C-2.5)
-- =============================================================================
--
-- One row, holding the version identifier of the most recently built bundle, so
-- a device can ask whether the hierarchy has changed without downloading it.
-- The route that answers that question is B3's; this is where the answer lives.

CREATE TABLE "public"."location_bundle" (
    "id"           INTEGER     NOT NULL DEFAULT 1,
    "version"      TEXT        NOT NULL,
    "built_at"     TIMESTAMPTZ NOT NULL,
    "state_count"  INTEGER     NOT NULL,
    "county_count" INTEGER     NOT NULL,
    "payam_count"  INTEGER     NOT NULL,

    CONSTRAINT "location_bundle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "location_bundle_singleton" CHECK ("id" = 1)
);

-- =============================================================================
-- INDEXES
-- =============================================================================
--
-- Plain indexes on the foreign key columns: Postgres does not create these
-- itself, and without them every check of "is any payam still pointing at this
-- county" is a sequential scan.
--
-- Partial indexes on deleted_at IS NULL: every read in this unit goes through
-- an _active view, so that is the access path that matters at size.

CREATE INDEX "county_state_id_idx"  ON "public"."county" ("state_id");
CREATE INDEX "payam_county_id_idx"  ON "public"."payam"  ("county_id");
CREATE INDEX "payam_state_id_idx"   ON "public"."payam"  ("state_id");

CREATE INDEX "county_state_id_active_idx"
    ON "public"."county" ("state_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "payam_county_id_active_idx"
    ON "public"."payam" ("county_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "payam_state_id_active_idx"
    ON "public"."payam" ("state_id") WHERE "deleted_at" IS NULL;

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
--
-- Enabled with no policies: deny-by-default. Supabase will report
-- rls_enabled_no_policy at INFO for each of these. That is the intended state,
-- not a defect. Do not "resolve" it by adding a permissive policy.

ALTER TABLE "public"."state"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."county"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payam"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."location_bundle" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS
-- =============================================================================
--
-- Every read in this unit goes through these, so a forgotten
-- "WHERE deleted_at IS NULL" is impossible rather than merely discouraged
-- (extension 1.3).
--
-- security_invoker = true is load-bearing. A view defaults to running with its
-- owner's rights, which would let the anon key read these tables through the
-- view despite the RLS enabled above.
--
-- Note the name: _active here means NOT SOFT-DELETED. It does not filter the
-- `active` column on state and county, which is a separate, administrative
-- flag. A caller wanting only administratively-active rows filters `active`
-- itself.

CREATE VIEW "public"."state_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."state" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."county_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."county" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."payam_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."payam" WHERE "deleted_at" IS NULL;

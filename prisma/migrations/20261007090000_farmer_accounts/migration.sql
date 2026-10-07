-- B14 -- farmers hold accounts. Decided 2026-10-07 (docs/DECISIONS.md,
-- "Farmers enrol themselves and deal with buyers directly"): CORWADO has no
-- staff to enrol farmers, so farmers register and list their produce
-- themselves; officers help the few who cannot, case by case.
--
-- ADDITIVE ONLY: one nullable column on farmer, one value on an enum, two views
-- recreated. NO new audit actions -- a self-registration is `farmer.created`
-- and `consent.recorded` with a farmer actor, a listing is `listing.*`, a
-- farmer's answer to a buyer is `purchase_request.decided` -- so the audit
-- CHECK is not rebuilt and cannot collide with another branch that rebuilds it.

-- A farmer is an audit actor, acting on their own record and listings.
ALTER TYPE "public"."audit_actor_type" ADD VALUE IF NOT EXISTS 'farmer';

-- The link to the farmer's sign-in account. Null for a farmer an officer
-- registered who has not been given an account. One account, one farmer.
ALTER TABLE "public"."farmer" ADD COLUMN "auth_user_id" UUID;
ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_auth_user_id_key" UNIQUE ("auth_user_id");

-- A SELECT * view freezes its column list when it is created (DECISIONS, "A
-- view is a filter of its table"). CREATE OR REPLACE may append a column, which
-- is exactly what happened to the table, so both farmer-named views are
-- recreated with their original filters.
CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';

-- =============================================================================
-- FARMER PROFILE -- the fields of CORWADO's registration form (2026-10-07)
-- =============================================================================
--
-- "Offline Version - Proposed Farmer Registration Form", sections B to F and H,
-- one row per farmer. A separate table so the farmer record, its views and
-- every report that reads it are untouched. Enumerated answers are TEXT under a
-- CHECK rather than new enum types: the lists are CORWADO's proposal and will
-- move, and a CHECK can be replaced without a type migration.
--
-- NOT HERE, deliberately: section G (mobile money and bank details) -- payments
-- are outside this phase and account numbers are financial data the platform
-- has no use for yet; the photograph -- it needs an upload flow; sections I and
-- K -- office records the verification flow already keeps.

CREATE TABLE "public"."farmer_profile" (
    "farmer_id"         UUID        NOT NULL,
    -- B. Personal
    "date_of_birth"     DATE,
    "age_estimated"     BOOLEAN     NOT NULL DEFAULT false,
    "id_type"           TEXT,
    "id_number"         TEXT,
    "education_level"   TEXT,
    -- C. Contact
    "alt_phone"         TEXT,
    "phone_type"        TEXT,
    "has_whatsapp"      BOOLEAN,
    "preferred_channel" TEXT,
    "next_of_kin_name"         TEXT,
    "next_of_kin_relationship" TEXT,
    "next_of_kin_phone"        TEXT,
    "next_of_kin_location"     TEXT,
    -- A. How the farmer heard of the platform
    "heard_via"         TEXT,
    -- D. Location
    "village"           TEXT,
    "landmark"          TEXT,
    -- E. Farming profile
    "primary_crops"     TEXT[]      NOT NULL DEFAULT '{}',
    "other_crops"       TEXT,
    "land_size"         NUMERIC(10,2),
    "land_unit"         TEXT,
    "land_measured"     BOOLEAN,
    "land_tenure"       TEXT,
    "years_farming"     SMALLINT,
    "group_member"      BOOLEAN,
    "group_name"        TEXT,
    "group_role"        TEXT,
    "group_years"       SMALLINT,
    -- F. Household
    "household_size"    SMALLINT,
    "household_adults"  SMALLINT,
    "household_children" SMALLINT,
    "farm_workers"      SMALLINT,
    -- H. Services wanted
    "services_wanted"   TEXT[]      NOT NULL DEFAULT '{}',
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "farmer_profile_pkey" PRIMARY KEY ("farmer_id"),
    CONSTRAINT "farmer_profile_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "farmer_profile_id_type"
        CHECK ("id_type" IS NULL OR "id_type" IN ('national_id', 'passport', 'chief_letter', 'other')),
    CONSTRAINT "farmer_profile_id_number_len"
        CHECK ("id_number" IS NULL OR char_length("id_number") BETWEEN 3 AND 40),
    CONSTRAINT "farmer_profile_education"
        CHECK ("education_level" IS NULL OR "education_level" IN ('none', 'primary', 'secondary', 'tertiary')),
    CONSTRAINT "farmer_profile_alt_phone_e164" CHECK ("alt_phone" IS NULL OR "alt_phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "farmer_profile_phone_type"
        CHECK ("phone_type" IS NULL OR "phone_type" IN ('smartphone', 'basic', 'none')),
    CONSTRAINT "farmer_profile_channel"
        CHECK ("preferred_channel" IS NULL OR "preferred_channel" IN ('sms', 'whatsapp', 'voice', 'app')),
    CONSTRAINT "farmer_profile_kin_phone_e164"
        CHECK ("next_of_kin_phone" IS NULL OR "next_of_kin_phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "farmer_profile_heard_via"
        CHECK ("heard_via" IS NULL OR "heard_via" IN ('cooperative', 'community_leader', 'ngo', 'walk_in', 'other')),
    CONSTRAINT "farmer_profile_text_lengths" CHECK (
        coalesce(char_length("next_of_kin_name"), 0) <= 120 AND
        coalesce(char_length("next_of_kin_relationship"), 0) <= 60 AND
        coalesce(char_length("next_of_kin_location"), 0) <= 160 AND
        coalesce(char_length("village"), 0) <= 120 AND
        coalesce(char_length("landmark"), 0) <= 160 AND
        coalesce(char_length("other_crops"), 0) <= 300 AND
        coalesce(char_length("group_name"), 0) <= 160 AND
        coalesce(char_length("group_role"), 0) <= 60
    ),
    CONSTRAINT "farmer_profile_crops_card" CHECK (cardinality("primary_crops") <= 20),
    CONSTRAINT "farmer_profile_land" CHECK ("land_size" IS NULL OR "land_size" > 0),
    CONSTRAINT "farmer_profile_land_unit"
        CHECK ("land_unit" IS NULL OR "land_unit" IN ('feddan', 'acre', 'hectare')),
    CONSTRAINT "farmer_profile_tenure"
        CHECK ("land_tenure" IS NULL OR "land_tenure" IN ('owned', 'rented', 'communal', 'other')),
    CONSTRAINT "farmer_profile_counts" CHECK (
        coalesce("years_farming", 0) BETWEEN 0 AND 100 AND
        coalesce("group_years", 0) BETWEEN 0 AND 100 AND
        coalesce("household_size", 0) BETWEEN 0 AND 200 AND
        coalesce("household_adults", 0) BETWEEN 0 AND 200 AND
        coalesce("household_children", 0) BETWEEN 0 AND 200 AND
        coalesce("farm_workers", 0) BETWEEN 0 AND 200
    ),
    CONSTRAINT "farmer_profile_services" CHECK (
        "services_wanted" <@ ARRAY['extension','agronomy','market_information','transport','buyers','other']::TEXT[]
    )
);

ALTER TABLE "public"."farmer_profile" ENABLE ROW LEVEL SECURITY;

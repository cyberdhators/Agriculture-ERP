-- Migration 10 (B5): the farmer record and its consent. C-5.
--
-- The first tables holding real personal data. Everything here follows the
-- pattern of migrations 5, 6 and 9:
--   1. RLS enabled, no policies (deny-by-default backstop).
--   2. Views WITH (security_invoker = true); farmer_active is the only read
--      path for lists and counts.
--   3. deleted_at / deleted_by on farmer. Never on consent (extension §1.3).
--   4. Denormalised state_id AND county_id, each enforced by a composite
--      foreign key, so a farmer cannot disagree with its payam about where it
--      is (C-5.5).
--
-- Additive only. Widens one CHECK on audit_event (the action list).

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "public"."sex" AS ENUM ('f', 'm');
CREATE TYPE "public"."registration_source" AS ENUM ('officer', 'self');
CREATE TYPE "public"."verification_status" AS ENUM ('pending', 'verified', 'rejected');

-- -----------------------------------------------------------------------------
-- payam (id, county_id) becomes a key so farmer.county_id can be enforced
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payam_id_county_id_key'
    ) THEN
        ALTER TABLE "public"."payam"
            ADD CONSTRAINT "payam_id_county_id_key" UNIQUE ("id", "county_id");
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- The farmer-number counter, one row per county. C-5.4.
--
-- Allocation is a single upsert on this row inside the insert transaction:
--   INSERT ... ON CONFLICT (county_id) DO UPDATE SET next_value = next_value + 1
--   RETURNING next_value - 1
-- Concurrent registrations in the same county queue on the row lock that the
-- upsert takes, so no two transactions can read the same value. The UNIQUE on
-- farmer.farmer_number below is the backstop, not the mechanism.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."farmer_number_counter" (
    "county_id"  TEXT    NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "farmer_number_counter_pkey" PRIMARY KEY ("county_id"),
    CONSTRAINT "farmer_number_counter_county_id_fkey"
        FOREIGN KEY ("county_id") REFERENCES "public"."county"("id"),
    CONSTRAINT "farmer_number_counter_positive" CHECK ("next_value" >= 1)
);
ALTER TABLE "public"."farmer_number_counter" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- farmer
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."farmer" (
    -- Client-generated (C-5.12): no default, so a missing id is an error, not
    -- a silently different row.
    "id"                  UUID        NOT NULL,
    -- Stored as text at insert and never derived again (C-5.4). A county code
    -- changing under I-07 leaves every printed card valid.
    "farmer_number"       TEXT        NOT NULL,
    "given_name"          TEXT        NOT NULL,
    "family_name"         TEXT        NOT NULL,
    "sex"                 "public"."sex" NOT NULL,
    "year_of_birth"       INTEGER     NOT NULL,
    -- E.164, +211 (CONVENTIONS §7). Validated by the shared schema before it
    -- gets here; the CHECK is the backstop.
    "phone"               TEXT        NOT NULL,
    "national_id"         TEXT,
    "payam_id"            TEXT        NOT NULL,
    "county_id"           TEXT        NOT NULL,
    "state_id"            TEXT        NOT NULL,
    "registered_by"       UUID,
    "registration_source" "public"."registration_source" NOT NULL DEFAULT 'officer',
    "verification_status" "public"."verification_status" NOT NULL DEFAULT 'pending',
    "merged_into"         UUID,
    -- NOT NULL and deferred: the farmer and its consent commit together or
    -- not at all (C-5.3). See consent.farmer_id below for the other half.
    "consent_id"          UUID        NOT NULL,
    "duplicate_flag"      BOOLEAN     NOT NULL DEFAULT false,
    "duplicate_matches"   UUID[]      NOT NULL DEFAULT '{}',
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"          TIMESTAMPTZ,
    "deleted_by"          UUID,

    CONSTRAINT "farmer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "farmer_farmer_number_key" UNIQUE ("farmer_number"),
    CONSTRAINT "farmer_phone_e164" CHECK ("phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "farmer_year_of_birth_range"
        CHECK ("year_of_birth" BETWEEN 1800 AND 2200),
    CONSTRAINT "farmer_national_id_shape"
        CHECK ("national_id" IS NULL OR "national_id" ~ '^[0-9A-Z]{6,20}$'),
    -- An officer-registered farmer always has a registering officer (C-5.1).
    -- 'self' exists in the enum because the data model has it; no route
    -- produces it. It is a value, not a permission.
    CONSTRAINT "farmer_officer_registration_has_officer"
        CHECK ("registration_source" <> 'officer' OR "registered_by" IS NOT NULL),
    CONSTRAINT "farmer_payam_id_fkey"
        FOREIGN KEY ("payam_id") REFERENCES "public"."payam"("id"),
    CONSTRAINT "farmer_county_id_fkey"
        FOREIGN KEY ("county_id") REFERENCES "public"."county"("id"),
    CONSTRAINT "farmer_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    -- C-5.5: the two composite keys. A farmer's payam decides its county and
    -- its state; the database refuses any row that says otherwise.
    CONSTRAINT "farmer_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id")
        REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "farmer_payam_county_consistent_fkey"
        FOREIGN KEY ("payam_id", "county_id")
        REFERENCES "public"."payam"("id", "county_id"),
    CONSTRAINT "farmer_registered_by_fkey"
        FOREIGN KEY ("registered_by") REFERENCES "public"."officer"("id"),
    CONSTRAINT "farmer_merged_into_fkey"
        FOREIGN KEY ("merged_into") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "farmer_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
);

-- -----------------------------------------------------------------------------
-- consent. A record of an event: never soft-deleted, never removed (§1.3).
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."consent" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "farmer_id"    UUID        NOT NULL,
    "text_version" TEXT        NOT NULL,
    "language"     "public"."language" NOT NULL,
    "granted"      BOOLEAN     NOT NULL,
    "granted_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "withdrawn_at" TIMESTAMPTZ,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consent_text_version_not_blank" CHECK (length(trim("text_version")) > 0),
    -- A consent that was not granted is only ever a withdrawn one. A farmer
    -- who declines is not recorded at all: no consent, no farmer (C-5.3).
    CONSTRAINT "consent_not_granted_means_withdrawn"
        CHECK ("granted" OR "withdrawn_at" IS NOT NULL),
    CONSTRAINT "consent_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id")
        DEFERRABLE INITIALLY DEFERRED
);

-- The other half of the circular link, added after both tables exist.
ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_consent_id_fkey"
        FOREIGN KEY ("consent_id") REFERENCES "public"."consent"("id")
        DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- Immutability (C-5.9): the farmer number and the registering officer are
-- never changed by anyone, and the database says so, not the route.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."farmer_refuse_immutable_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."farmer_number" IS DISTINCT FROM OLD."farmer_number" THEN
        RAISE EXCEPTION 'farmer_number is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."registered_by" IS DISTINCT FROM OLD."registered_by" THEN
        RAISE EXCEPTION 'registered_by is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    NEW."updated_at" := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER "farmer_immutable_fields"
    BEFORE UPDATE ON "public"."farmer"
    FOR EACH ROW EXECUTE FUNCTION "public"."farmer_refuse_immutable_change"();

-- -----------------------------------------------------------------------------
-- Indexes: data-model-extension §10, partial on deleted_at IS NULL where the
-- list is at scale. The name-matching index uses the same expression the
-- duplicate query uses (C-5.6): compared normalised, stored as supplied.
-- -----------------------------------------------------------------------------
CREATE INDEX "farmer_payam_status_idx"
    ON "public"."farmer" ("payam_id", "verification_status", "deleted_at");
CREATE INDEX "farmer_phone_idx"
    ON "public"."farmer" ("phone") WHERE "deleted_at" IS NULL;
CREATE INDEX "farmer_name_payam_idx"
    ON "public"."farmer" (
        lower(normalize(trim("family_name"), NFC)),
        lower(normalize(trim("given_name"), NFC)),
        "payam_id"
    ) WHERE "deleted_at" IS NULL;
CREATE INDEX "farmer_registered_by_created_idx"
    ON "public"."farmer" ("registered_by", "created_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "farmer_state_created_idx"
    ON "public"."farmer" ("state_id", "created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "farmer_county_id_idx"       ON "public"."farmer" ("county_id");
CREATE INDEX "farmer_created_idx"
    ON "public"."farmer" ("created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "consent_farmer_id_idx"      ON "public"."consent" ("farmer_id");

-- -----------------------------------------------------------------------------
-- RLS and the active view
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."farmer"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."consent" ENABLE ROW LEVEL SECURITY;

CREATE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;

-- -----------------------------------------------------------------------------
-- audit_event: the action list grows. Generated from AUDIT_ACTIONS in
-- packages/shared/src/audit.ts -- same list, same change.
-- -----------------------------------------------------------------------------
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
    'consent.recorded'
));

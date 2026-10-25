-- Migration 20261028100000 -- user journeys (CORWADO's 16 October
-- specification, lines 36-57 and section 3; infographics 4, 5 and 7).
-- docs/DECISIONS.md, "User journeys (2026-10-28)".
--
-- WHAT IT CHANGES
--   farmer        sex, year_of_birth, payam_id, county_id and state_id become
--                 NULLABLE for a self-registered account only: sign-up asks
--                 for name, number, password, language and the notice; these
--                 move to the optional setup and are asked for when needed
--                 (a listing asks where the produce is). Two CHECKs keep the
--                 rest exactly as strict as before: an officer-registered
--                 farmer still has all five, and a location is all three
--                 levels or none.
--   farmer_number_unplaced_seq  numbers for an account with no county yet
--                 (the per-county counter needs a county).
--   buyer.preferred_language    the email account's language choice.
--   produce_listing.organization_id  produce posted for an organisation,
--                 like buying_request / service_listing (20261027090000).
--   account_block           one account blocks another (person level).
--   account_acknowledgement an email account's acknowledgement of the terms
--                 and privacy notice (a phone account records it in consent).
--   email_verification      a code sent to an email address at sign-up.
--   post_expiry_reminder    one reminder per post per end date (idempotent).
--
-- ADDITIVE. NOT NULL is relaxed, never tightened, on existing columns; no
-- type changes, no data rewritten: every existing farmer row already has all
-- five values, so both new CHECKs hold for every existing row. One view is
-- re-created with CREATE OR REPLACE (a SELECT * view freezes its columns; the
-- new column is appended). RLS on every new table with no policies (deny by
-- default). No audit CHECK here: the integrator rebuilds it.

-- ---------------------------------------------------------------------------
-- 1. A self-registered farmer may leave sex, year of birth and location blank
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."farmer" ALTER COLUMN "sex" DROP NOT NULL;
ALTER TABLE "public"."farmer" ALTER COLUMN "year_of_birth" DROP NOT NULL;
ALTER TABLE "public"."farmer" ALTER COLUMN "payam_id" DROP NOT NULL;
ALTER TABLE "public"."farmer" ALTER COLUMN "county_id" DROP NOT NULL;
ALTER TABLE "public"."farmer" ALTER COLUMN "state_id" DROP NOT NULL;

ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_location_whole" CHECK (
        ("payam_id" IS NULL) = ("county_id" IS NULL)
        AND ("payam_id" IS NULL) = ("state_id" IS NULL)
    ),
    ADD CONSTRAINT "farmer_officer_record_complete" CHECK (
        "registration_source" = 'self'
        OR ("sex" IS NOT NULL AND "year_of_birth" IS NOT NULL AND "payam_id" IS NOT NULL)
    );

CREATE SEQUENCE "public"."farmer_number_unplaced_seq" AS BIGINT START 1;

-- ---------------------------------------------------------------------------
-- 2. The email account's language
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."buyer" ADD COLUMN "preferred_language" "public"."language";

-- ---------------------------------------------------------------------------
-- 3. Produce posted for an organisation
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."produce_listing" ADD COLUMN "organization_id" UUID;
ALTER TABLE "public"."produce_listing"
    ADD CONSTRAINT "produce_listing_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id");
CREATE INDEX "produce_listing_organization_idx"
    ON "public"."produce_listing" ("organization_id", "updated_at" DESC)
    WHERE "organization_id" IS NOT NULL;

CREATE OR REPLACE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Person-level block
-- ---------------------------------------------------------------------------

CREATE TABLE "public"."account_block" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "blocker_auth_user_id" UUID        NOT NULL,
    "blocked_auth_user_id" UUID        NOT NULL,
    -- The name the blocker saw (from the conversation), so the list can say who
    -- it is without reading the other account's private record.
    "blocked_name"         TEXT        NOT NULL,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ended_at"             TIMESTAMPTZ,

    CONSTRAINT "account_block_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_block_not_self" CHECK ("blocker_auth_user_id" <> "blocked_auth_user_id"),
    CONSTRAINT "account_block_name_length" CHECK (char_length("blocked_name") BETWEEN 1 AND 200)
);
-- One live block per pair; an unblock ends the row and keeps it as history.
CREATE UNIQUE INDEX "account_block_one_live"
    ON "public"."account_block" ("blocker_auth_user_id", "blocked_auth_user_id")
    WHERE "ended_at" IS NULL;
CREATE INDEX "account_block_blocked_idx"
    ON "public"."account_block" ("blocked_auth_user_id") WHERE "ended_at" IS NULL;
ALTER TABLE "public"."account_block" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. An email account's acknowledgement of the terms and privacy notice
-- ---------------------------------------------------------------------------

CREATE TABLE "public"."account_acknowledgement" (
    "id"           UUID              NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID              NOT NULL,
    "kind"         TEXT              NOT NULL,
    "text_version" TEXT              NOT NULL,
    "language"     "public"."language" NOT NULL,
    "granted_at"   TIMESTAMPTZ       NOT NULL DEFAULT now(),
    "withdrawn_at" TIMESTAMPTZ,

    CONSTRAINT "account_acknowledgement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_acknowledgement_kind_known" CHECK ("kind" IN ('terms_privacy')),
    CONSTRAINT "account_acknowledgement_version_length"
        CHECK (char_length("text_version") BETWEEN 1 AND 40)
);
CREATE INDEX "account_acknowledgement_account_idx"
    ON "public"."account_acknowledgement" ("auth_user_id", "granted_at" DESC);
ALTER TABLE "public"."account_acknowledgement" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Email codes at sign-up (the email twin of phone_verification)
-- ---------------------------------------------------------------------------

CREATE TABLE "public"."email_verification" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    -- Lower-case address.
    "email"       TEXT        NOT NULL,
    "purpose"     TEXT        NOT NULL DEFAULT 'sign_up',
    "code_hash"   TEXT        NOT NULL,
    "attempts"    SMALLINT    NOT NULL DEFAULT 0,
    "expires_at"  TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_verification_purpose_known" CHECK ("purpose" IN ('sign_up')),
    CONSTRAINT "email_verification_email_lower" CHECK ("email" = lower("email")),
    CONSTRAINT "email_verification_attempts" CHECK ("attempts" BETWEEN 0 AND 100)
);
CREATE INDEX "email_verification_email_created_idx"
    ON "public"."email_verification" ("email", "created_at" DESC);
CREATE INDEX "email_verification_created_idx"
    ON "public"."email_verification" ("created_at" DESC);
ALTER TABLE "public"."email_verification" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7. Expiry reminders: one per post per end date
-- ---------------------------------------------------------------------------

CREATE TABLE "public"."post_expiry_reminder" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "post_kind"  TEXT        NOT NULL,
    "post_id"    UUID        NOT NULL,
    "ends_on"    DATE        NOT NULL,
    -- Whether an in-app notice was written (false: the account had nowhere to
    -- read one); either way the post is not reminded twice for this date.
    "delivered"  BOOLEAN     NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "post_expiry_reminder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "post_expiry_reminder_kind_known"
        CHECK ("post_kind" IN ('listing', 'buying_request', 'service')),
    -- An edited end date is a new date and earns a new reminder.
    CONSTRAINT "post_expiry_reminder_once" UNIQUE ("post_kind", "post_id", "ends_on")
);
ALTER TABLE "public"."post_expiry_reminder" ENABLE ROW LEVEL SECURITY;

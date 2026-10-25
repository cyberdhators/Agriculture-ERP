-- 2026-10-27 -- three things from CORWADO's 16 October specification. ADDITIVE:
-- two columns on account_profile, one on phone_verification, one CHECK widened
-- (a CHECK can only be replaced, never extended; every earlier value is kept),
-- and one new table. Nothing is dropped, renamed or retyped.
--
-- The audit CHECK for the new action keys is NOT in this migration: the
-- integrator writes one combined CHECK migration (lane-briefs/COMMON.md).

-- =============================================================================
-- 1. SELF-SERVICE RECOVERY AND A VERIFIED CHANGE OF NUMBER
-- =============================================================================
-- phone_verification (migration 20261019090000) carried sign-up codes only.
-- Two more purposes: a code to set a new password, and a code sent to a NEW
-- number before a change of number applies. A change-of-number code is bound
-- to the account that asked for it (auth_user_id), so a code verified by one
-- account cannot move another's number. Recovery and sign-up rows carry none.

ALTER TABLE "public"."phone_verification"
    DROP CONSTRAINT "phone_verification_purpose";
ALTER TABLE "public"."phone_verification"
    ADD CONSTRAINT "phone_verification_purpose" CHECK
        ("purpose" IN ('farmer_sign_up', 'password_recovery', 'phone_change'));

ALTER TABLE "public"."phone_verification"
    ADD COLUMN "auth_user_id" UUID;
ALTER TABLE "public"."phone_verification"
    ADD CONSTRAINT "phone_verification_change_has_account" CHECK
        (("purpose" = 'phone_change') = ("auth_user_id" IS NOT NULL));

-- =============================================================================
-- 2. ENTERPRISE SIZE ("SME is a size classification, not an alternative to
--    processor, supplier or trader")
-- =============================================================================
-- Optional; NULL is "not stated". Labels only: no numeric bands are defined
-- (an owner decision to confirm). An individual states no size. Shown on the
-- public profile only if the owner turns it on.

ALTER TABLE "public"."account_profile"
    ADD COLUMN "enterprise_size" TEXT,
    ADD COLUMN "show_enterprise_size" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."account_profile"
    ADD CONSTRAINT "account_profile_enterprise_size" CHECK (
        "enterprise_size" IS NULL
        OR ("enterprise_size" IN ('micro', 'small', 'medium', 'large')
            AND "profile_kind" <> 'individual')
    );

-- =============================================================================
-- 3. A MODERATOR ASKS FOR A CORRECTION ("Inspect, request correction and
--    moderate with a reason")
-- =============================================================================
-- One row per request, about exactly one post. The post stays live. "open"
-- until the owner edits the post, then "addressed" with the time. At most one
-- open request per post. The note is what the owner is shown on their own
-- post; it is never put in a notification. Soft delete only.

CREATE TABLE "public"."listing_correction" (
    "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    "target_type"        TEXT        NOT NULL,
    "produce_listing_id" UUID,
    "service_listing_id" UUID,
    "buying_request_id"  UUID,
    "reason_code"        TEXT        NOT NULL,
    "note"               TEXT        NOT NULL,
    "status"             TEXT        NOT NULL DEFAULT 'open',
    "requested_by"       UUID        NOT NULL,
    "requested_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "addressed_at"       TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"         TIMESTAMPTZ,
    "deleted_by"         UUID,

    CONSTRAINT "listing_correction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listing_correction_produce_listing_id_fkey"
        FOREIGN KEY ("produce_listing_id") REFERENCES "public"."produce_listing"("id"),
    CONSTRAINT "listing_correction_service_listing_id_fkey"
        FOREIGN KEY ("service_listing_id") REFERENCES "public"."service_listing"("id"),
    CONSTRAINT "listing_correction_buying_request_id_fkey"
        FOREIGN KEY ("buying_request_id") REFERENCES "public"."buying_request"("id"),
    CONSTRAINT "listing_correction_requested_by_fkey"
        FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "listing_correction_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "listing_correction_target_matches" CHECK (
        ("target_type" = 'produce_listing' AND "produce_listing_id" IS NOT NULL
            AND "service_listing_id" IS NULL AND "buying_request_id" IS NULL)
        OR ("target_type" = 'service_listing' AND "service_listing_id" IS NOT NULL
            AND "produce_listing_id" IS NULL AND "buying_request_id" IS NULL)
        OR ("target_type" = 'buying_request' AND "buying_request_id" IS NOT NULL
            AND "produce_listing_id" IS NULL AND "service_listing_id" IS NULL)
    ),
    CONSTRAINT "listing_correction_status" CHECK ("status" IN ('open', 'addressed')),
    CONSTRAINT "listing_correction_addressed_complete" CHECK
        (("status" = 'addressed') = ("addressed_at" IS NOT NULL)),
    CONSTRAINT "listing_correction_reason_code_shape" CHECK
        ("reason_code" ~ '^[a-z][a-z0-9_]{1,39}$'),
    CONSTRAINT "listing_correction_note_length" CHECK
        (char_length("note") BETWEEN 5 AND 500)
);

-- At most one open request per post.
CREATE UNIQUE INDEX "listing_correction_one_open_produce"
    ON "public"."listing_correction" ("produce_listing_id")
    WHERE "status" = 'open' AND "deleted_at" IS NULL AND "produce_listing_id" IS NOT NULL;
CREATE UNIQUE INDEX "listing_correction_one_open_service"
    ON "public"."listing_correction" ("service_listing_id")
    WHERE "status" = 'open' AND "deleted_at" IS NULL AND "service_listing_id" IS NOT NULL;
CREATE UNIQUE INDEX "listing_correction_one_open_request"
    ON "public"."listing_correction" ("buying_request_id")
    WHERE "status" = 'open' AND "deleted_at" IS NULL AND "buying_request_id" IS NOT NULL;
-- The moderator's list, newest first.
CREATE INDEX "listing_correction_queue_idx"
    ON "public"."listing_correction" ("status", "requested_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;

-- Deny-by-default backstop, as on every table: no policies, routes only.
ALTER TABLE "public"."listing_correction" ENABLE ROW LEVEL SECURITY;

CREATE VIEW "public"."listing_correction_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."listing_correction" WHERE "deleted_at" IS NULL;

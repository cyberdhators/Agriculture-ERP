-- 2026-10-23 -- PUBLIC PROFILES, VERSION 2: drafts, publishing, a photo
-- (CORWADO's 16 October specification, "Public profiles remain drafts until
-- previewed and deliberately published"; the client's profile infographic).
-- docs/DECISIONS.md, "Public profiles v2: drafts, publishing, photo".
--
-- ADDITIVE ONLY:
--   1. account_profile (one row per sign-in, 20261019090100) gains the public
--      profile: a public address (public_id, never the sign-in id), a display
--      name, an about text, a general location, product and service tags, an
--      optional photo, two privacy choices and a status. EVERY EXISTING ROW
--      STARTS AS A DRAFT: nothing becomes public without its owner publishing.
--   2. market_report may be about a profile: a nullable profile_id column and
--      the target CHECK replaced by one that admits it. Every existing row has
--      profile_id NULL and satisfies the new CHECK exactly as it did the old.
--      market_report_active (SELECT *) is recreated so it carries the column.
--
-- NOT HERE: the audit CHECK (audit_event_action_known). The new profile.*
-- keys are in AUDIT_ACTIONS and CONVENTIONS §5.2.2; one combined CHECK
-- migration adds them (the owner writes those).
--
-- No view selects * from account_profile, so none needs recreating for it.

ALTER TABLE "public"."account_profile"
    -- A volatile default fills every existing row with its own value.
    ADD COLUMN "public_id"        UUID        NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "display_name"     TEXT,
    ADD COLUMN "about"            TEXT,
    ADD COLUMN "state_id"         TEXT,
    ADD COLUMN "payam_id"         TEXT,
    ADD COLUMN "products"         TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN "services"         TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN "photo_path"       TEXT,
    ADD COLUMN "photo_updated_at" TIMESTAMPTZ,
    ADD COLUMN "show_phone"       BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN "allow_messages"   BOOLEAN     NOT NULL DEFAULT true,
    ADD COLUMN "status"           TEXT        NOT NULL DEFAULT 'draft',
    ADD COLUMN "published_at"     TIMESTAMPTZ;

ALTER TABLE "public"."account_profile"
    ADD CONSTRAINT "account_profile_public_id_key" UNIQUE ("public_id"),
    ADD CONSTRAINT "account_profile_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    ADD CONSTRAINT "account_profile_payam_id_fkey"
        FOREIGN KEY ("payam_id") REFERENCES "public"."payam"("id"),
    ADD CONSTRAINT "account_profile_status" CHECK
        ("status" IN ('draft', 'published', 'unpublished')),
    ADD CONSTRAINT "account_profile_display_name_length" CHECK
        ("display_name" IS NULL OR char_length("display_name") BETWEEN 2 AND 120),
    ADD CONSTRAINT "account_profile_about_length" CHECK
        ("about" IS NULL OR char_length("about") <= 1000),
    -- At most ten tags each. Each tag's own 1..40 characters is the shared
    -- schema's rule; here the whole list is bounded (10 x 40), because a
    -- CHECK cannot look inside each element without a function.
    ADD CONSTRAINT "account_profile_products_bounded" CHECK
        (cardinality("products") <= 10 AND char_length(array_to_string("products", '')) <= 400),
    ADD CONSTRAINT "account_profile_services_bounded" CHECK
        (cardinality("services") <= 10 AND char_length(array_to_string("services", '')) <= 400),
    -- A published profile has a name and the moment it was published.
    ADD CONSTRAINT "account_profile_published_whole" CHECK
        ("status" <> 'published' OR ("display_name" IS NOT NULL AND "published_at" IS NOT NULL)),
    -- A payam is only ever given with its state.
    ADD CONSTRAINT "account_profile_payam_needs_state" CHECK
        ("payam_id" IS NULL OR "state_id" IS NOT NULL);

-- The public directory reads published rows only.
CREATE INDEX "account_profile_published_idx"
    ON "public"."account_profile" ("public_id")
    WHERE "status" = 'published';

-- ---------------------------------------------------------------------------
-- market_report: a profile may be reported (POST /api/profiles/p/:id/reports)
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."market_report"
    ADD COLUMN "profile_id" UUID;

ALTER TABLE "public"."market_report"
    ADD CONSTRAINT "market_report_profile_id_fkey"
        FOREIGN KEY ("profile_id") REFERENCES "public"."account_profile"("public_id");

-- A CHECK can only be replaced. The two original arms, each now also saying
-- profile_id IS NULL (true of every existing row), and a third for a profile.
ALTER TABLE "public"."market_report"
    DROP CONSTRAINT "market_report_target_matches";

ALTER TABLE "public"."market_report"
    ADD CONSTRAINT "market_report_target_matches" CHECK (
        ("target_type" = 'buying_request' AND "buying_request_id" IS NOT NULL
            AND "service_listing_id" IS NULL AND "profile_id" IS NULL)
        OR ("target_type" = 'service_listing' AND "service_listing_id" IS NOT NULL
            AND "buying_request_id" IS NULL AND "profile_id" IS NULL)
        OR ("target_type" = 'profile' AND "profile_id" IS NOT NULL
            AND "buying_request_id" IS NULL AND "service_listing_id" IS NULL)
    );

CREATE INDEX "market_report_profile_idx"
    ON "public"."market_report" ("profile_id")
    WHERE "deleted_at" IS NULL AND "profile_id" IS NOT NULL;

-- A SELECT * view freezes its column list when it is created; CREATE OR
-- REPLACE appends the new column. The filter is unchanged.
CREATE OR REPLACE VIEW "public"."market_report_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."market_report" WHERE "deleted_at" IS NULL;

-- RLS: both tables already have it enabled with no policies (20261019090100,
-- 20261019101000); added columns inherit it. Nothing to do.

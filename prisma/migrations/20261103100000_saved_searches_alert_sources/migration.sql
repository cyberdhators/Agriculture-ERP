-- 2026-11-03 (lane-searches) -- SAVED SEARCHES, AND WHERE EACH MATCH ALERT
-- CAME FROM. docs/DECISIONS.md, "Saved searches" and "Match-alert results
-- report".
--
-- ADDITIVE ONLY: one new table and three new nullable columns on
-- marketing_notice. No existing row changes meaning; nothing is dropped.
--
-- NO AUDIT CHECK HERE, deliberately (as 20261101090000). New keys
-- saved_search.created / .paused / .resumed / .deleted are in AUDIT_ACTIONS;
-- the integrator's combined CHECK migration adds them. Until it is applied a
-- save, pause or delete is refused (500) and nothing is changed or unlogged.
--
-- NO PHONE NUMBER, NAME OR MESSAGE TEXT IS STORED in either table.

-- -----------------------------------------------------------------------------
-- 1. SAVED_SEARCH -- "tell me when this is posted", one account's own.
--   Keyed by the sign-in (one account buys and sells, phone or email). At
--   most SAVED_SEARCH_LIMIT (10) live per account, checked by the route under
--   a row lock. A product word or a category (or both), an optional state, an
--   optional highest price (produce listings only). Paused searches alert
--   nobody. Soft delete only.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."saved_search" (
    "id"            UUID                       NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"  UUID                       NOT NULL,
    "target"        TEXT                       NOT NULL,
    "product_name"  TEXT,
    "category"      "public"."listing_category",
    "state_id"      TEXT,
    "max_price_ssp" DECIMAL(12, 2),
    "paused_at"     TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ                NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ                NOT NULL DEFAULT now(),
    "deleted_at"    TIMESTAMPTZ,

    CONSTRAINT "saved_search_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saved_search_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "saved_search_target_known" CHECK ("target" IN ('listing', 'buying_request')),
    CONSTRAINT "saved_search_asks_something" CHECK (
        "product_name" IS NOT NULL OR "category" IS NOT NULL
    ),
    CONSTRAINT "saved_search_product_length" CHECK (
        "product_name" IS NULL OR char_length("product_name") BETWEEN 2 AND 80
    ),
    CONSTRAINT "saved_search_price_positive" CHECK (
        "max_price_ssp" IS NULL OR "max_price_ssp" > 0
    ),
    CONSTRAINT "saved_search_price_listings_only" CHECK (
        "max_price_ssp" IS NULL OR "target" = 'listing'
    )
);

-- The owner's list, and the limit's count.
CREATE INDEX "saved_search_owner_idx"
    ON "public"."saved_search" ("auth_user_id", "created_at" DESC)
    WHERE "deleted_at" IS NULL;

-- The match run: live, unpaused searches of one kind.
CREATE INDEX "saved_search_live_idx"
    ON "public"."saved_search" ("target", "category", "state_id")
    WHERE "deleted_at" IS NULL AND "paused_at" IS NULL;

ALTER TABLE "public"."saved_search" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. MARKETING_NOTICE -- where an alert came from, and whether its SMS went.
--   source: NULL on alerts made before this migration (the report reads them
--   from post_kind: a buying request alerts sellers, a listing alerts buyers).
--   saved_search_id: the search that matched, for a saved-search alert.
--   sms_sent_at: when the SMS provider accepted the alert's SMS.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."marketing_notice"
    ADD COLUMN "source"          TEXT,
    ADD COLUMN "saved_search_id" UUID,
    ADD COLUMN "sms_sent_at"     TIMESTAMPTZ;

ALTER TABLE "public"."marketing_notice"
    ADD CONSTRAINT "marketing_notice_source_known" CHECK (
        "source" IS NULL OR "source" IN ('buying_request_match', 'listing_match', 'saved_search')
    ),
    ADD CONSTRAINT "marketing_notice_saved_search_fkey"
        FOREIGN KEY ("saved_search_id") REFERENCES "public"."saved_search"("id"),
    ADD CONSTRAINT "marketing_notice_saved_search_source" CHECK (
        "saved_search_id" IS NULL OR "source" = 'saved_search'
    );

-- The staff report reads alerts by the time they were sent.
CREATE INDEX "marketing_notice_created_idx"
    ON "public"."marketing_notice" ("created_at");

-- Migration 20261019101000 -- buying requests, service listings and their
-- reports (LISTINGS LANE).
--
-- The owner, 2026-10-19, from CORWADO's specification of 16 October 2026:
--
--   * A BUYING REQUEST: "I need X of commodity Y in location Z by date", with
--     an optional price or negotiable, and delivery terms. Anyone signed in --
--     a farmer or a buyer account -- may post one, and it is visible on the
--     public market. It is NOT a purchase_request (a buyer's request to one
--     listing), which is unchanged: "buying requests are not inquiries".
--   * A SERVICE LISTING: tractor hire, transport, processing, storage, other.
--     Owned by a farmer account for now. The same lifecycle as produce, with
--     no stock.
--   * A MARKET REPORT: the product-report mechanism (20260917120000) for these
--     two kinds of post. A separate table rather than a widened
--     product_report: product_report.listing_id is NOT NULL with a foreign
--     key to produce_listing, and relaxing it would change a constraint the
--     administrator's queue relies on.
--
-- NEW TABLES ONLY. Nothing existing is altered. The patterns of 20260917120000
-- are copied: RLS enabled with no policies, `*_active` views WITH
-- (security_invoker = true), deleted_at / deleted_by on every table.
--
-- THE LIFECYCLE IS STORED IN THE CANONICAL WORDS: draft, active, paused,
-- withdrawn, completed. `expired` is computed from the end date (needed_by,
-- available_until) and never stored; the owner renews with a new date.
--
-- WHO POSTED A BUYING REQUEST is (poster_type, farmer_id | buyer_id), written
-- by the server from the session -- never from a request body. Exactly one of
-- the two ids is set, and it is the one poster_type names.

-- =============================================================================
-- buying_request
-- =============================================================================

CREATE TABLE "public"."buying_request" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "poster_type"    TEXT NOT NULL,
    "farmer_id"      UUID,
    "buyer_id"       UUID,
    -- The name shown on the market: chosen by the poster, never a legal name
    -- read from their record (the marketplace amendment: no personal data).
    "display_name"   TEXT NOT NULL,
    "category"       "public"."listing_category" NOT NULL,
    "product_name"   TEXT NOT NULL,
    "quantity"       NUMERIC(12,2) NOT NULL,
    "unit"           "public"."listing_unit" NOT NULL,
    "state_id"       TEXT NOT NULL,
    "location"       TEXT NOT NULL,
    "needed_by"      DATE NOT NULL,
    "price_ssp"      NUMERIC(12,2),
    "price_per"      "public"."listing_unit",
    "negotiable"     BOOLEAN NOT NULL DEFAULT true,
    "delivery_terms" TEXT,
    "description"    TEXT,
    -- Shown only to a signed-in farmer or buyer, never to the public.
    "contact_phone"  TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'draft',
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"     TIMESTAMPTZ,
    "deleted_by"     UUID,

    CONSTRAINT "buying_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "buying_request_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "buying_request_buyer_id_fkey"
        FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id"),
    CONSTRAINT "buying_request_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "buying_request_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "buying_request_poster_type_known"
        CHECK ("poster_type" IN ('farmer', 'buyer')),
    CONSTRAINT "buying_request_poster_matches" CHECK (
        ("poster_type" = 'farmer' AND "farmer_id" IS NOT NULL AND "buyer_id" IS NULL)
        OR ("poster_type" = 'buyer' AND "buyer_id" IS NOT NULL AND "farmer_id" IS NULL)
    ),
    CONSTRAINT "buying_request_status_known"
        CHECK ("status" IN ('draft', 'active', 'paused', 'withdrawn', 'completed')),
    CONSTRAINT "buying_request_display_name_length"
        CHECK (char_length(btrim("display_name")) BETWEEN 2 AND 120),
    CONSTRAINT "buying_request_product_name_not_blank" CHECK (btrim("product_name") <> ''),
    CONSTRAINT "buying_request_location_length"
        CHECK (char_length(btrim("location")) BETWEEN 2 AND 160),
    CONSTRAINT "buying_request_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "buying_request_price_non_negative" CHECK ("price_ssp" IS NULL OR "price_ssp" >= 0),
    CONSTRAINT "buying_request_price_has_unit" CHECK ("price_ssp" IS NULL OR "price_per" IS NOT NULL),
    CONSTRAINT "buying_request_delivery_terms_length" CHECK (char_length("delivery_terms") <= 500),
    CONSTRAINT "buying_request_description_length" CHECK (char_length("description") <= 1000),
    CONSTRAINT "buying_request_contact_phone_format" CHECK ("contact_phone" ~ '^\+211[0-9]{9}$')
);

-- The market: what is active, soonest needed first.
CREATE INDEX "buying_request_market_idx"
    ON "public"."buying_request" ("status", "needed_by", "updated_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "buying_request_farmer_idx"
    ON "public"."buying_request" ("farmer_id", "updated_at" DESC)
    WHERE "deleted_at" IS NULL AND "farmer_id" IS NOT NULL;
CREATE INDEX "buying_request_buyer_idx"
    ON "public"."buying_request" ("buyer_id", "updated_at" DESC)
    WHERE "deleted_at" IS NULL AND "buyer_id" IS NOT NULL;

-- =============================================================================
-- service_listing
-- =============================================================================

CREATE TABLE "public"."service_listing" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmer_id"         UUID NOT NULL,
    "trading_name"      TEXT NOT NULL,
    "service_type"      TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "description"       TEXT NOT NULL,
    -- A general location in words; the payam and state are the farmer's,
    -- copied as produce listings copy them, so scope checks need no join.
    "location"          TEXT NOT NULL,
    "payam_id"          TEXT NOT NULL,
    "state_id"          TEXT NOT NULL,
    "available_from"    DATE NOT NULL,
    "available_until"   DATE,
    "availability_note" TEXT,
    "price_ssp"         NUMERIC(12,2),
    "price_unit"        TEXT,
    "negotiable"        BOOLEAN NOT NULL DEFAULT false,
    "contact_phone"     TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'draft',
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"        TIMESTAMPTZ,
    "deleted_by"        UUID,

    CONSTRAINT "service_listing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_listing_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "service_listing_payam_state_fkey"
        FOREIGN KEY ("payam_id", "state_id") REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "service_listing_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "service_listing_service_type_known" CHECK (
        "service_type" IN ('tractor_hire', 'transport', 'processing', 'storage', 'other')
    ),
    CONSTRAINT "service_listing_price_unit_known" CHECK (
        "price_unit" IS NULL OR "price_unit" IN (
            'per_hour', 'per_day', 'per_acre', 'per_feddan',
            'per_trip', 'per_bag', 'per_kg', 'per_job'
        )
    ),
    CONSTRAINT "service_listing_status_known"
        CHECK ("status" IN ('draft', 'active', 'paused', 'withdrawn', 'completed')),
    CONSTRAINT "service_listing_trading_name_length"
        CHECK (char_length(btrim("trading_name")) BETWEEN 2 AND 120),
    CONSTRAINT "service_listing_title_length" CHECK (char_length(btrim("title")) BETWEEN 2 AND 200),
    CONSTRAINT "service_listing_description_length"
        CHECK (char_length(btrim("description")) BETWEEN 1 AND 1000),
    CONSTRAINT "service_listing_location_length"
        CHECK (char_length(btrim("location")) BETWEEN 2 AND 160),
    CONSTRAINT "service_listing_availability_note_length"
        CHECK (char_length("availability_note") <= 300),
    CONSTRAINT "service_listing_price_non_negative" CHECK ("price_ssp" IS NULL OR "price_ssp" >= 0),
    CONSTRAINT "service_listing_price_or_negotiable" CHECK ("price_ssp" IS NOT NULL OR "negotiable"),
    CONSTRAINT "service_listing_price_has_unit" CHECK ("price_ssp" IS NULL OR "price_unit" IS NOT NULL),
    CONSTRAINT "service_listing_dates_ordered"
        CHECK ("available_until" IS NULL OR "available_until" >= "available_from"),
    CONSTRAINT "service_listing_contact_phone_format" CHECK ("contact_phone" ~ '^\+211[0-9]{9}$')
);

CREATE INDEX "service_listing_market_idx"
    ON "public"."service_listing" ("status", "service_type", "updated_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "service_listing_farmer_idx"
    ON "public"."service_listing" ("farmer_id", "updated_at" DESC)
    WHERE "deleted_at" IS NULL;

-- =============================================================================
-- market_report -- one report about one buying request or service listing
-- =============================================================================
--
-- NO REPORTER IDENTITY IS STORED, exactly as product_report: a reason, an
-- optional sentence, and a one-way digest kept only to refuse a repeat of the
-- same report from the same source. The digest is not a rate limiter.

CREATE TABLE "public"."market_report" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_type"        TEXT NOT NULL,
    "buying_request_id"  UUID,
    "service_listing_id" UUID,
    "reason"             "public"."report_reason" NOT NULL,
    "description"        TEXT,
    "status"             "public"."report_status" NOT NULL DEFAULT 'new',
    "submission_digest"  TEXT,
    "resolved_by"        UUID,
    "resolved_at"        TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"         TIMESTAMPTZ,
    "deleted_by"         UUID,

    CONSTRAINT "market_report_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "market_report_buying_request_id_fkey"
        FOREIGN KEY ("buying_request_id") REFERENCES "public"."buying_request"("id"),
    CONSTRAINT "market_report_service_listing_id_fkey"
        FOREIGN KEY ("service_listing_id") REFERENCES "public"."service_listing"("id"),
    CONSTRAINT "market_report_resolved_by_fkey"
        FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "market_report_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "market_report_target_matches" CHECK (
        ("target_type" = 'buying_request' AND "buying_request_id" IS NOT NULL
            AND "service_listing_id" IS NULL)
        OR ("target_type" = 'service_listing' AND "service_listing_id" IS NOT NULL
            AND "buying_request_id" IS NULL)
    ),
    CONSTRAINT "market_report_description_length" CHECK (char_length("description") <= 500),
    CONSTRAINT "market_report_resolution_complete" CHECK (
        ("resolved_by" IS NULL AND "resolved_at" IS NULL)
        OR ("resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
    )
);

CREATE INDEX "market_report_queue_idx"
    ON "public"."market_report" ("status", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "market_report_buying_request_idx"
    ON "public"."market_report" ("buying_request_id")
    WHERE "deleted_at" IS NULL AND "buying_request_id" IS NOT NULL;
CREATE INDEX "market_report_service_listing_idx"
    ON "public"."market_report" ("service_listing_id")
    WHERE "deleted_at" IS NULL AND "service_listing_id" IS NOT NULL;

-- =============================================================================
-- ROW LEVEL SECURITY -- enabled, no policies: a deny-by-default backstop.
-- Every read and write goes through a route that calls requireRole.
-- =============================================================================

ALTER TABLE "public"."buying_request"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."market_report"   ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS -- soft-deleted rows appear in no list, count, export or report
-- =============================================================================

CREATE VIEW "public"."buying_request_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."buying_request" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."service_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."service_listing" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."market_report_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."market_report" WHERE "deleted_at" IS NULL;

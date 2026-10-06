-- B13 -- buyer accounts and procurement. Criteria C-14B in
-- docs/scope-and-acceptance.md; decision in docs/DECISIONS.md, "Buyers hold
-- accounts (2026-10-06)", which supersedes "Buyers hold no account in this
-- phase (2026-09-09)".
--
-- ADDITIVE ONLY. Five new tables, five new enum types, one new value on
-- audit_actor_type, two nullable columns on produce_listing, one nullable
-- column on notification and one NOT NULL relaxed there. Nothing is dropped
-- and no existing row changes meaning.
--
-- REUSE, NOT DUPLICATION. A product is a produce_listing: there is no product
-- table. The seller is the listing's farmer, and the buyer never receives the
-- farmer's id, name, phone or location below payam (C-14B.8). A notification
-- to a buyer is a row in the existing notification table, not a second table.

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE "public"."buyer_organization_type" AS ENUM (
    'trader', 'aggregator', 'processor', 'wholesaler', 'exporter',
    'food_company', 'ngo', 'institution', 'government', 'other'
);

-- `not_required` is an individual buyer's standing: nobody reviewed them, so
-- they are not "verified" -- they are simply not subject to review (owner,
-- 2026-10-06: "standard buyers/individual buyers shouldn't need review or
-- verification"). A business still is. See buyer_organization_standing_fits_kind.
CREATE TYPE "public"."buyer_verification_status" AS ENUM (
    'pending', 'under_review', 'verified', 'rejected', 'suspended', 'not_required'
);

-- Who the account is for. An individual buys for themselves and needs no
-- review; a business is checked by CORWADO before it may send requests.
CREATE TYPE "public"."buyer_account_type" AS ENUM ('individual', 'business');

-- A preference, never a payment. Payments are not in this phase (Inception
-- Report 5.1); this records how a buyer prefers to settle, nothing more.
CREATE TYPE "public"."buyer_payment_preference" AS ENUM (
    'cash_on_delivery', 'bank_transfer', 'mobile_money', 'cheque', 'other'
);

CREATE TYPE "public"."purchase_request_status" AS ENUM (
    'draft', 'submitted', 'under_review', 'accepted',
    'partially_fulfilled', 'fulfilled', 'cancelled', 'rejected'
);

CREATE TYPE "public"."purchase_order_status" AS ENUM (
    'pending', 'confirmed', 'processing', 'ready_for_delivery',
    'in_transit', 'delivered', 'completed', 'cancelled'
);

CREATE TYPE "public"."listing_grade" AS ENUM ('a', 'b', 'c', 'ungraded');

-- A buyer is an audit actor. ADD VALUE, never a rebuilt type: existing rows
-- keep their values. The new value is not used anywhere else in this file,
-- which is what Postgres requires of a value added in the same transaction.
ALTER TYPE "public"."audit_actor_type" ADD VALUE IF NOT EXISTS 'buyer';

-- =============================================================================
-- BUYER ORGANISATION -- the business, its procurement profile, its standing
-- =============================================================================

CREATE TABLE "public"."buyer_organization" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "account_type"         "public"."buyer_account_type" NOT NULL DEFAULT 'business',
    -- For an individual, the buyer's own name: the account still has one
    -- "organisation" so every scope, request and order hangs off one id.
    "name"                 TEXT        NOT NULL,
    "organization_type"    "public"."buyer_organization_type" NOT NULL,
    "registration_number"  TEXT,
    "tax_id"               TEXT,
    -- ISO 3166-1 alpha-2. An exporter may be registered outside South Sudan.
    "country_code"         CHAR(2)     NOT NULL DEFAULT 'SS',
    -- South Sudan locations, when the organisation is in South Sudan.
    "state_id"             TEXT,
    "county_id"            TEXT,
    "city"                 TEXT,
    "address"              TEXT,
    "website"              TEXT,
    "description"          TEXT,
    -- The procurement profile (C-14B.2).
    "interested_categories" "public"."listing_category"[] NOT NULL DEFAULT '{}',
    "interested_products"  TEXT[]      NOT NULL DEFAULT '{}',
    -- State ids. An array cannot carry a foreign key; the route checks each
    -- against state_active before writing.
    "preferred_state_ids"  TEXT[]      NOT NULL DEFAULT '{}',
    "min_quantity"         NUMERIC(12,2),
    "max_quantity"         NUMERIC(12,2),
    "preferred_unit"       "public"."listing_unit",
    "delivery_locations"   TEXT[]      NOT NULL DEFAULT '{}',
    "purchasing_months"    SMALLINT[]  NOT NULL DEFAULT '{}',
    "payment_preferences"  "public"."buyer_payment_preference"[] NOT NULL DEFAULT '{}',
    -- Standing (C-14B.3). Only an administrator moves it.
    "verification_status"  "public"."buyer_verification_status" NOT NULL DEFAULT 'pending',
    "verification_note"    TEXT,
    "verified_at"          TIMESTAMPTZ,
    "verified_by"          UUID,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"           TIMESTAMPTZ,
    "deleted_by"           UUID,

    CONSTRAINT "buyer_organization_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "buyer_organization_name_len"
        CHECK (char_length(btrim("name")) BETWEEN 2 AND 160),
    CONSTRAINT "buyer_organization_registration_number_len"
        CHECK ("registration_number" IS NULL OR char_length("registration_number") <= 64),
    CONSTRAINT "buyer_organization_tax_id_len"
        CHECK ("tax_id" IS NULL OR char_length("tax_id") <= 64),
    CONSTRAINT "buyer_organization_country_code_shape"
        CHECK ("country_code" ~ '^[A-Z]{2}$'),
    CONSTRAINT "buyer_organization_county_needs_state"
        CHECK ("county_id" IS NULL OR "state_id" IS NOT NULL),
    CONSTRAINT "buyer_organization_city_len"
        CHECK ("city" IS NULL OR char_length("city") <= 120),
    CONSTRAINT "buyer_organization_address_len"
        CHECK ("address" IS NULL OR char_length("address") <= 300),
    CONSTRAINT "buyer_organization_website_shape"
        CHECK ("website" IS NULL OR ("website" ~ '^https?://' AND char_length("website") <= 200)),
    CONSTRAINT "buyer_organization_description_len"
        CHECK ("description" IS NULL OR char_length("description") <= 1000),
    CONSTRAINT "buyer_organization_products_card"
        CHECK (cardinality("interested_products") <= 20),
    CONSTRAINT "buyer_organization_states_card"
        CHECK (cardinality("preferred_state_ids") <= 20),
    CONSTRAINT "buyer_organization_delivery_card"
        CHECK (cardinality("delivery_locations") <= 10),
    CONSTRAINT "buyer_organization_months_valid"
        CHECK ("purchasing_months" <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[]),
    CONSTRAINT "buyer_organization_min_quantity_positive"
        CHECK ("min_quantity" IS NULL OR "min_quantity" > 0),
    CONSTRAINT "buyer_organization_max_quantity_positive"
        CHECK ("max_quantity" IS NULL OR "max_quantity" > 0),
    CONSTRAINT "buyer_organization_quantity_range"
        CHECK ("min_quantity" IS NULL OR "max_quantity" IS NULL OR "max_quantity" >= "min_quantity"),
    CONSTRAINT "buyer_organization_verification_note_len"
        CHECK ("verification_note" IS NULL OR char_length("verification_note") <= 500),
    -- An individual is never pending, under review or verified -- they were
    -- not reviewed -- and a business is never exempt from review. Rejection
    -- and suspension apply to both: an administrator can still stop abuse.
    CONSTRAINT "buyer_organization_standing_fits_kind" CHECK (
        ("account_type" = 'individual' AND "verification_status" IN ('not_required', 'rejected', 'suspended')) OR
        ("account_type" = 'business'   AND "verification_status" <> 'not_required')
    ),
    CONSTRAINT "buyer_organization_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "buyer_organization_county_state_consistent_fkey"
        FOREIGN KEY ("county_id", "state_id") REFERENCES "public"."county"("id", "state_id"),
    CONSTRAINT "buyer_organization_verified_by_fkey"
        FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "buyer_organization_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
);

-- =============================================================================
-- BUYER -- the person who signs in on the organisation's behalf
-- =============================================================================
--
-- No email column, exactly as `user`: the address lives in auth.users and
-- nowhere else, so the two cannot drift. auth_user_id is the only link.

CREATE TABLE "public"."buyer" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"    UUID        NOT NULL,
    "organization_id" UUID        NOT NULL,
    "given_name"      TEXT        NOT NULL,
    "family_name"     TEXT        NOT NULL,
    -- E.164. Not restricted to +211: a buyer may be outside South Sudan.
    "phone"           TEXT        NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"      TIMESTAMPTZ,
    "deleted_by"      UUID,

    CONSTRAINT "buyer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "buyer_auth_user_id_key" UNIQUE ("auth_user_id"),
    CONSTRAINT "buyer_given_name_len" CHECK (char_length(btrim("given_name")) BETWEEN 1 AND 100),
    CONSTRAINT "buyer_family_name_len" CHECK (char_length(btrim("family_name")) BETWEEN 1 AND 100),
    CONSTRAINT "buyer_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT "buyer_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."buyer_organization"("id"),
    CONSTRAINT "buyer_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
);

-- =============================================================================
-- PRODUCE LISTING -- two optional procurement facts
-- =============================================================================

ALTER TABLE "public"."produce_listing"
    ADD COLUMN "quality_grade" "public"."listing_grade",
    ADD COLUMN "min_order_quantity" NUMERIC(12,2);

ALTER TABLE "public"."produce_listing"
    ADD CONSTRAINT "produce_listing_min_order_positive"
        CHECK ("min_order_quantity" IS NULL OR "min_order_quantity" > 0);

-- =============================================================================
-- PURCHASE REQUEST -- what a buyer wants (C-14B.11)
-- =============================================================================

CREATE TABLE "public"."purchase_request" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"   UUID        NOT NULL,
    "created_by"        UUID        NOT NULL,
    -- The listing it was raised from, when there was one. A request may also
    -- describe a need no listing yet meets.
    "listing_id"        UUID,
    "category"          "public"."listing_category" NOT NULL,
    "product_name"      TEXT        NOT NULL,
    "quantity"          NUMERIC(12,2) NOT NULL,
    "unit"              "public"."listing_unit" NOT NULL,
    "delivery_location" TEXT        NOT NULL,
    "required_by"       DATE,
    "notes"             TEXT,
    "status"            "public"."purchase_request_status" NOT NULL DEFAULT 'draft',
    "submitted_at"      TIMESTAMPTZ,
    "decision_note"     TEXT,
    "decided_by"        UUID,
    "decided_at"        TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"        TIMESTAMPTZ,

    CONSTRAINT "purchase_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_request_product_name_len"
        CHECK (char_length(btrim("product_name")) BETWEEN 1 AND 120),
    CONSTRAINT "purchase_request_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_request_delivery_location_len"
        CHECK (char_length(btrim("delivery_location")) BETWEEN 2 AND 200),
    CONSTRAINT "purchase_request_notes_len"
        CHECK ("notes" IS NULL OR char_length("notes") <= 1000),
    CONSTRAINT "purchase_request_decision_note_len"
        CHECK ("decision_note" IS NULL OR char_length("decision_note") <= 500),
    -- A draft has not been submitted; anything a reviewer has seen has. A
    -- cancelled request may be either: a buyer can cancel a draft too.
    CONSTRAINT "purchase_request_submitted_consistent"
        CHECK (
            ("status" <> 'draft' OR "submitted_at" IS NULL) AND
            ("status" IN ('draft', 'cancelled') OR "submitted_at" IS NOT NULL)
        ),
    CONSTRAINT "purchase_request_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."buyer_organization"("id"),
    CONSTRAINT "purchase_request_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."buyer"("id"),
    CONSTRAINT "purchase_request_listing_id_fkey"
        FOREIGN KEY ("listing_id") REFERENCES "public"."produce_listing"("id"),
    CONSTRAINT "purchase_request_decided_by_fkey"
        FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id")
);

-- =============================================================================
-- PURCHASE ORDER -- what CORWADO staff arranged against a listing (C-14B.12)
-- =============================================================================
--
-- `order` is a reserved word, hence purchase_order. Staff create orders; a
-- buyer reads them and may cancel one that is still pending. No payment.

CREATE SEQUENCE "public"."purchase_order_number_seq" AS BIGINT START 1;

CREATE TABLE "public"."purchase_order" (
    "id"                     UUID        NOT NULL DEFAULT gen_random_uuid(),
    "order_number"           TEXT        NOT NULL
        DEFAULT ('PO-' || lpad(nextval('public.purchase_order_number_seq')::TEXT, 6, '0')),
    "organization_id"        UUID        NOT NULL,
    "purchase_request_id"    UUID,
    "listing_id"             UUID        NOT NULL,
    -- Internal. Never returned to a buyer (C-14B.8).
    "farmer_id"              UUID        NOT NULL,
    "category"               "public"."listing_category" NOT NULL,
    "product_name"           TEXT        NOT NULL,
    "quantity"               NUMERIC(12,2) NOT NULL,
    "unit"                   "public"."listing_unit" NOT NULL,
    "unit_price_ssp"         NUMERIC(12,2) NOT NULL,
    -- Computed by the database, never sent by a client.
    "total_ssp"              NUMERIC(14,2) GENERATED ALWAYS AS (round("quantity" * "unit_price_ssp", 2)) STORED,
    "status"                 "public"."purchase_order_status" NOT NULL DEFAULT 'pending',
    "delivery_location"      TEXT        NOT NULL,
    "expected_delivery_date" DATE,
    "cancel_reason"          TEXT,
    "created_by"             UUID        NOT NULL,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"             TIMESTAMPTZ,
    "deleted_by"             UUID,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_order_number_key" UNIQUE ("order_number"),
    CONSTRAINT "purchase_order_product_name_len"
        CHECK (char_length(btrim("product_name")) BETWEEN 1 AND 120),
    CONSTRAINT "purchase_order_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_order_price_nonneg" CHECK ("unit_price_ssp" >= 0),
    CONSTRAINT "purchase_order_delivery_location_len"
        CHECK (char_length(btrim("delivery_location")) BETWEEN 2 AND 200),
    CONSTRAINT "purchase_order_cancel_reason_len"
        CHECK ("cancel_reason" IS NULL OR char_length("cancel_reason") <= 300),
    CONSTRAINT "purchase_order_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."buyer_organization"("id"),
    CONSTRAINT "purchase_order_purchase_request_id_fkey"
        FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_request"("id"),
    CONSTRAINT "purchase_order_listing_id_fkey"
        FOREIGN KEY ("listing_id") REFERENCES "public"."produce_listing"("id"),
    CONSTRAINT "purchase_order_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "purchase_order_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "purchase_order_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id")
);

-- =============================================================================
-- DELIVERY UPDATE -- the order's timeline (C-14B.13)
-- =============================================================================
--
-- A record of an event: appended, never edited, never soft-deleted, as with
-- consent. The order's `status` is the current state; this is how it got
-- there. No position is recorded, because no GPS tracking exists; a nullable
-- geography column can be added here when it does, without touching orders.

CREATE TABLE "public"."delivery_update" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "order_id"          UUID        NOT NULL,
    "status"            "public"."purchase_order_status" NOT NULL,
    "note"              TEXT,
    "recorded_by_user"  UUID,
    "recorded_by_buyer" UUID,
    "occurred_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "delivery_update_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_update_note_len" CHECK ("note" IS NULL OR char_length("note") <= 500),
    CONSTRAINT "delivery_update_one_recorder"
        CHECK (num_nonnulls("recorded_by_user", "recorded_by_buyer") = 1),
    CONSTRAINT "delivery_update_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id"),
    CONSTRAINT "delivery_update_recorded_by_user_fkey"
        FOREIGN KEY ("recorded_by_user") REFERENCES "public"."user"("id"),
    CONSTRAINT "delivery_update_recorded_by_buyer_fkey"
        FOREIGN KEY ("recorded_by_buyer") REFERENCES "public"."buyer"("id")
);

-- =============================================================================
-- NOTIFICATION -- a buyer organisation is a recipient too (C-14B.20)
-- =============================================================================
--
-- Relaxing NOT NULL on farmer_id loses nothing: every existing row has one,
-- and the CHECK below requires exactly one recipient on every row, old or new.
-- The existing GET /api/notifications joins farmer, so it never sees a
-- buyer's row.

ALTER TABLE "public"."notification"
    ADD COLUMN "buyer_organization_id" UUID,
    ALTER COLUMN "farmer_id" DROP NOT NULL;

ALTER TABLE "public"."notification"
    ADD CONSTRAINT "notification_buyer_organization_id_fkey"
        FOREIGN KEY ("buyer_organization_id") REFERENCES "public"."buyer_organization"("id"),
    ADD CONSTRAINT "notification_one_recipient"
        CHECK (num_nonnulls("farmer_id", "buyer_organization_id") = 1);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX "buyer_organization_status_idx"
    ON "public"."buyer_organization" ("verification_status", "created_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "buyer_organization_id_idx" ON "public"."buyer" ("organization_id");
CREATE INDEX "purchase_request_organization_idx"
    ON "public"."purchase_request" ("organization_id", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "purchase_request_status_idx"
    ON "public"."purchase_request" ("status", "created_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "purchase_order_organization_idx"
    ON "public"."purchase_order" ("organization_id", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "purchase_order_status_idx"
    ON "public"."purchase_order" ("status", "created_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "purchase_order_request_idx" ON "public"."purchase_order" ("purchase_request_id");
CREATE INDEX "delivery_update_order_idx"
    ON "public"."delivery_update" ("order_id", "occurred_at" DESC);
CREATE INDEX "notification_buyer_unread_idx"
    ON "public"."notification" ("buyer_organization_id", "created_at" DESC)
    WHERE "deleted_at" IS NULL;
-- The marketplace's two new filters.
CREATE INDEX "produce_listing_grade_idx"
    ON "public"."produce_listing" ("quality_grade") WHERE "deleted_at" IS NULL;

-- =============================================================================
-- ROW-LEVEL SECURITY -- deny by default, no policies
-- =============================================================================

ALTER TABLE "public"."buyer_organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."buyer"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."purchase_request"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."purchase_order"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."delivery_update"    ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS -- security_invoker, every column of their table
-- =============================================================================
--
-- buyer_active is where an account stops working: a removed buyer, or a buyer
-- whose organisation was removed, has no row here and requireRole refuses
-- them on their next request (as user_active does for staff, C-3.6).

CREATE VIEW "public"."buyer_organization_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."buyer_organization" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."buyer_active" WITH (security_invoker = true) AS
    SELECT b.* FROM "public"."buyer" b
    JOIN "public"."buyer_organization" o ON o."id" = b."organization_id"
    WHERE b."deleted_at" IS NULL AND o."deleted_at" IS NULL;

-- produce_listing gained two columns, and a SELECT * view froze its list when
-- it was created (DECISIONS, "A view is a filter of its table"). Recreated.
DROP VIEW IF EXISTS "public"."produce_listing_active";
CREATE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

-- =============================================================================
-- AUDIT ACTIONS -- the full list, generated from AUDIT_ACTIONS (77 keys)
-- =============================================================================
--
-- A CHECK can only be replaced, never extended, so this carries every key as
-- of this date: the 65 of 20260920170000 plus B13's twelve.

ALTER TABLE "public"."audit_event"
    DROP CONSTRAINT "audit_event_action_known";

ALTER TABLE "public"."audit_event"
    ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
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
        'consent.recorded',
        'farmer.verified',
        'farmer.rejected',
        'farmer.merged',
        'farmer.resubmitted',
        'farmer.reassigned',
        'farm.created',
        'farm.boundary_added',
        'farm.boundary_superseded',
        'farm.crops_declared',
        'farm.soft_deleted',
        'farm.repointed',
        'visit.recorded',
        'visit.corrected',
        'visit.soft_deleted',
        'visit.attachment_declared',
        'visit.attachment_arrived',
        'visit.attachment_failed',
        'visit.attachment_link_issued',
        'visit.repointed',
        'report.exported',
        'system.restored',
        'directory_entry.created',
        'directory_entry.updated',
        'directory_entry.soft_deleted',
        'learning_resource.created',
        'learning_resource.updated',
        'learning_resource.published',
        'learning_resource.soft_deleted',
        'product_report.created',
        'product_report.listing_removed',
        'product_report.status_changed',
        'communication.email_sent',
        'communication.send_failed',
        'weather_location.created',
        'weather_location.updated',
        'weather_location.soft_deleted',
        'listing.created',
        'listing.updated',
        'listing.status_changed',
        'listing.soft_deleted',
        'contact_request.created',
        'contact_request.handled',
        'market_price.created',
        'market_price.soft_deleted',
        'notification.created',
        'notification.read',
        'buyer.registered',
        'buyer.updated',
        'buyer_organization.updated',
        'buyer_organization.verification_changed',
        'purchase_request.created',
        'purchase_request.updated',
        'purchase_request.submitted',
        'purchase_request.cancelled',
        'purchase_request.decided',
        'purchase_order.created',
        'purchase_order.status_changed',
        'purchase_order.cancelled'
    ));

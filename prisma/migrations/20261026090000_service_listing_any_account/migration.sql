-- Migration 20261026090000 -- a service listing may be offered by any
-- account: a farmer account or a buyer account (an institute, college,
-- research body, advisory organisation or independent adviser).
--
-- The acceptance test of 2026-10-26 (check 7): "An institution (or any buyer
-- account) cannot post a service listing without first registering as a
-- farmer." CORWADO's specification: institutions "may publish ordinary
-- profiles and service advertisements"; "one account buys, sells, publishes
-- buying requests, offers services and seeks advice". This replaces "owned by
-- a farmer account for now" (20261019101000; docs/DECISIONS.md, "Services:
-- any account may offer one (2026-10-26)").
--
-- THE DESIGN OF buying_request, COPIED: who offers a service is (poster_type,
-- farmer_id | buyer_id), written by the server from the session -- never from
-- a request body. Exactly one of the two ids is set, and it is the one
-- poster_type names.
--
-- WHERE A BUYER'S SERVICE IS. A farmer's service keeps the payam and state of
-- the farmer's record, as before. A buyer has no payam: the state is chosen
-- on the form (checked against public.state) and the payam is left empty. So
-- payam_id becomes nullable -- but only a buyer's row may leave it empty.
--
-- ADDITIVE IN EFFECT. Two columns are added; farmer_id and payam_id lose NOT
-- NULL, which no existing row needs (every existing row keeps its farmer and
-- payam, and is backfilled poster_type = 'farmer'); new constraints only
-- narrow what a new row may be. Nothing is dropped or renamed. RLS is already
-- enabled on the table with no policies (20261019101000); added columns
-- inherit it. No audit key is added: the existing listing.created,
-- listing.updated and listing.status_changed are reused.

ALTER TABLE "public"."service_listing"
    ADD COLUMN "poster_type" TEXT NOT NULL DEFAULT 'farmer';
-- The default backfilled every existing row; from now on the server names it.
ALTER TABLE "public"."service_listing"
    ALTER COLUMN "poster_type" DROP DEFAULT;

ALTER TABLE "public"."service_listing"
    ADD COLUMN "buyer_id" UUID;

ALTER TABLE "public"."service_listing"
    ALTER COLUMN "farmer_id" DROP NOT NULL;
ALTER TABLE "public"."service_listing"
    ALTER COLUMN "payam_id" DROP NOT NULL;

ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_buyer_id_fkey"
        FOREIGN KEY ("buyer_id") REFERENCES "public"."buyer"("id");

-- The composite (payam_id, state_id) key is not checked when payam_id is
-- empty (MATCH SIMPLE), so the state gets a key of its own.
ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id");

ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_poster_type_known"
        CHECK ("poster_type" IN ('farmer', 'buyer'));

ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_poster_matches" CHECK (
        ("poster_type" = 'farmer' AND "farmer_id" IS NOT NULL AND "buyer_id" IS NULL)
        OR ("poster_type" = 'buyer' AND "buyer_id" IS NOT NULL AND "farmer_id" IS NULL)
    );

-- A farmer's service always has its payam; only a buyer's may have none.
ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_farmer_has_payam"
        CHECK ("poster_type" = 'buyer' OR "payam_id" IS NOT NULL);

CREATE INDEX "service_listing_buyer_idx"
    ON "public"."service_listing" ("buyer_id", "updated_at" DESC)
    WHERE "deleted_at" IS NULL AND "buyer_id" IS NOT NULL;

-- A SELECT * view freezes its column list when it is created; CREATE OR
-- REPLACE appends the two new columns. The filter is unchanged.
CREATE OR REPLACE VIEW "public"."service_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."service_listing" WHERE "deleted_at" IS NULL;

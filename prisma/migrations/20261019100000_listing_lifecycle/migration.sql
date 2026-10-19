-- Migration 20261019100000 -- the produce listing lifecycle (LISTINGS LANE).
--
-- The owner, 2026-10-19, from CORWADO's specification of 16 October 2026:
-- draft, active, paused, expired, withdrawn, completed. An edit is an event,
-- not a status. Recording a sale takes it off what is left; the listing is
-- completed when the owner says it is fulfilled or nothing is left.
--
-- ADDITIVE ONLY. No value is renamed or dropped, no row is changed:
--
--   * `listing_status` gains `paused` and `completed`. `listed` stays the
--     stored word for active, and the legacy `sold` stays readable -- the code
--     reads it as completed (packages/shared/src/market-posts.ts).
--   * `expired` is NOT a stored value: it is computed from `available_until`,
--     which the market already hides once past (2026-10-08). Renewing is a new
--     date, so a listing never has to be "un-expired" by a status write.
--   * `quantity_sold` -- how much of `quantity` has been sold. What is left is
--     `quantity - quantity_sold`. NOT NULL with a default of 0, so every
--     existing listing reads "nothing sold yet" and no row is rewritten.
--
-- The two new enum values are not used anywhere else in this file, which is
-- what Postgres requires of a value added in the same transaction.

ALTER TYPE "public"."listing_status" ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE "public"."listing_status" ADD VALUE IF NOT EXISTS 'completed';

ALTER TABLE "public"."produce_listing"
    ADD COLUMN IF NOT EXISTS "quantity_sold" NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "public"."produce_listing"
    ADD CONSTRAINT "produce_listing_quantity_sold_range"
    CHECK ("quantity_sold" >= 0 AND "quantity_sold" <= "quantity");

-- produce_listing gained a column, and a SELECT * view froze its column list
-- when it was created (DECISIONS, "A view is a filter of its table").
-- Recreated, as 20261006090000 did.
DROP VIEW IF EXISTS "public"."produce_listing_active";
CREATE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

-- Fix two defects introduced by migration 20260920100000:
--
-- 1. The DEFAULT for contact_phone was '+21100000000' (8 digits after +211),
--    but the CHECK constraint requires 9 digits (^\+211[0-9]{9}$). Any INSERT
--    that omits contact_phone fails the constraint. Fixed to '+211000000000'.
--
-- 2. The produce_listing_active view was created in 20260917 as SELECT *.
--    PostgreSQL snapshots the column list at CREATE VIEW time, so the thirteen
--    columns added in 20260920100000 are invisible to the view.
--    Recreated here.

ALTER TABLE "public"."produce_listing"
  ALTER COLUMN "contact_phone" SET DEFAULT '+211000000000';

DROP VIEW IF EXISTS "public"."produce_listing_active";
CREATE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
  SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

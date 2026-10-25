-- 2026-10-29 -- a suspension may carry a duration (CORWADO's Settings line
-- "reason codes, suspension duration and appeals"). docs/DECISIONS.md,
-- "A suspension may end by itself".
--
-- ADDITIVE: one nullable column each on farmer and buyer. NULL is a suspension
-- with no end (every suspension before this one), lasting until staff restore
-- it. A value is the moment it ends; the daily job (POST
-- /api/cron/expiry-reminders) lifts every suspension whose moment has passed,
-- audited with actor 'system'. A DISABLED account never carries one: a
-- disable is permanent until a Super Admin lifts it, and disabling clears it.
-- No audit CHECK change here: the integrator owns the CHECK
-- (account.suspension_expired is listed in the lane report).

ALTER TABLE "public"."farmer" ADD COLUMN "suspension_ends_at" TIMESTAMPTZ;
ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_suspension_ends_at_needs_suspension" CHECK (
        "suspension_ends_at" IS NULL
        OR ("suspended_at" IS NOT NULL AND "disabled_at" IS NULL)
    );

ALTER TABLE "public"."buyer" ADD COLUMN "suspension_ends_at" TIMESTAMPTZ;
ALTER TABLE "public"."buyer"
    ADD CONSTRAINT "buyer_suspension_ends_at_needs_suspension" CHECK (
        "suspension_ends_at" IS NULL
        OR ("suspended_at" IS NOT NULL AND "disabled_at" IS NULL)
    );

-- The daily job reads only the few rows with an end.
CREATE INDEX "farmer_suspension_ends_at_idx" ON "public"."farmer" ("suspension_ends_at")
    WHERE "suspension_ends_at" IS NOT NULL;
CREATE INDEX "buyer_suspension_ends_at_idx" ON "public"."buyer" ("suspension_ends_at")
    WHERE "suspension_ends_at" IS NOT NULL;

-- The views read `SELECT *`, which froze their column lists when they were
-- made; recreated with the same definitions so they carry the new column
-- (tests/views-track-tables.test.ts). Definitions as in 20261028090000 and
-- 20261028100000, unchanged.
CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';

CREATE OR REPLACE VIEW "public"."buyer_active" WITH (security_invoker = true) AS
    SELECT b.* FROM "public"."buyer" b
    JOIN "public"."buyer_organization" o ON o."id" = b."organization_id"
    WHERE b."deleted_at" IS NULL AND o."deleted_at" IS NULL;

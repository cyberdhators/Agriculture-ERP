-- Migration 7 -- unit B3
--
-- created_at on user and officer.
--
-- CONVENTIONS section 6.2 fixes the default list order as created_at
-- descending, then id descending as tiebreak, and gives its reason: cursor
-- pagination over an undefined order silently skips and repeats rows. Neither
-- table carried the column, so the first list routes had no deterministic sort
-- to page over.
--
-- It also makes section 7 testable. That rule is parked because no response
-- contains a timestamp; the user and officer lists are the first that will.
--
-- Additive, with a default, so existing rows get a value and nothing breaks.

ALTER TABLE "public"."user"
    ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE "public"."officer"
    ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();

-- The index the cursor sort actually uses. Without it every page is a sort of
-- the whole table.
CREATE INDEX "user_created_at_id_idx"
    ON "public"."user" ("created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;

CREATE INDEX "officer_created_at_id_idx"
    ON "public"."officer" ("created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;

-- The views are SELECT *, so they pick the column up automatically. Recreated
-- anyway, because "it should pick it up" is how a stale view definition
-- survives for three units.
DROP VIEW "public"."user_active";
DROP VIEW "public"."officer_active";

CREATE VIEW "public"."user_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."user" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."officer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."officer"
    WHERE "deleted_at" IS NULL AND "status" = 'active';

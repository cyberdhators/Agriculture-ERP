-- Migration 18 (B9): what the sync contract needs from the schema. C-9.
--
-- 1. A boundary's id is the client's (C-9.1). The server default is removed so
--    a missing id is an error, not a silently different row — as farmer, farm
--    and visit already are. Existing rows keep their ids.
-- 2. captured_at on farmer and farm: the device's moment (C-9.10). Nullable;
--    rows that predate this read "not recorded", never a guess.
-- 3. updated_at is kept current by a trigger on the three synced parents, so
--    the download filter (C-9.9) sees every change however it was made —
--    verification decisions, merges, reassignment, correction, removal. Until
--    now only some routes set it.
-- The SELECT * views over farmer and farm are recreated (migration 12's lesson).

ALTER TABLE "public"."farm_boundary" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "public"."farmer" ADD COLUMN "captured_at" TIMESTAMPTZ;
ALTER TABLE "public"."farm"   ADD COLUMN "captured_at" TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER "farmer_set_updated_at" BEFORE UPDATE ON "public"."farmer"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "farm_set_updated_at" BEFORE UPDATE ON "public"."farm"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
CREATE TRIGGER "visit_set_updated_at" BEFORE UPDATE ON "public"."visit"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- The download filter's indexes: by caseload and by state, on the moment of change.
CREATE INDEX "farmer_caseload_updated_idx" ON "public"."farmer" ("caseload_officer_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "farmer_state_updated_idx"    ON "public"."farmer" ("state_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "farm_updated_idx"            ON "public"."farm" ("updated_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "visit_updated_idx"           ON "public"."visit" ("updated_at" DESC) WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';
CREATE OR REPLACE VIEW "public"."farm_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farm" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."farm_mapped_v" WITH (security_invoker = true) AS
    SELECT f.* FROM "public"."farm" f
    WHERE f."deleted_at" IS NULL AND EXISTS (
        SELECT 1 FROM "public"."farm_boundary" b
        WHERE b."farm_id" = f."id" AND b."is_current" AND b."accuracy_flag" <> 'unusable'
    );

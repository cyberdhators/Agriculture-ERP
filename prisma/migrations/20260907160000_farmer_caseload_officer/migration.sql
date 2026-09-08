-- Migration 17 (B8.5): the caseload becomes a pointer of its own. C-8R.
--
-- registered_by stays the immutable historical fact (C-5.9). caseload_officer_id
-- is who works this farmer today: set to the registering officer at creation,
-- moved by an administrator. Every scope check reads it. Additive: one column,
-- backfilled, one key, one index; the two farmer views recreated because a
-- SELECT * view freezes its columns at creation (migration 12's lesson).

ALTER TABLE "public"."farmer" ADD COLUMN "caseload_officer_id" UUID;
UPDATE "public"."farmer" SET "caseload_officer_id" = "registered_by" WHERE "caseload_officer_id" IS NULL;
ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_caseload_officer_id_fkey" FOREIGN KEY ("caseload_officer_id") REFERENCES "public"."officer"("id");
CREATE INDEX "farmer_caseload_officer_idx" ON "public"."farmer" ("caseload_officer_id", "created_at" DESC) WHERE "deleted_at" IS NULL;

-- New farmers: the application sets both from the registering officer. The
-- trigger is the backstop for any writer that sets only registered_by.
CREATE OR REPLACE FUNCTION "public"."farmer_caseload_default"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.caseload_officer_id IS NULL THEN NEW.caseload_officer_id := NEW.registered_by; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER "farmer_caseload_default_trg"
    BEFORE INSERT ON "public"."farmer"
    FOR EACH ROW EXECUTE FUNCTION "public"."farmer_caseload_default"();

CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';

-- audit_event: one more action key, generated from AUDIT_ACTIONS.
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted', 'farmer.reassigned',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted',
    'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
    'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed',
    'visit.attachment_link_issued'
));

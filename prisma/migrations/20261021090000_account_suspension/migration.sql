-- 2026-10-21 -- staff suspend and restore an account (CORWADO's 16 October
-- specification, "Reports and support"; the owner, 2026-10-20). A suspended
-- account cannot sign in or use the app, and nothing it posted is on the
-- market; it stays on the register (and in reach figures, if verified):
-- suspension is a marketplace sanction, not a removal.
--
-- ADDITIVE: three nullable columns each on farmer and buyer; the views that
-- SELECT * from them recreated (CREATE OR REPLACE appends the columns, as
-- 20261007090000 did); the audit CHECK rebuilt with every key of
-- 20261020150000 (89) plus account.suspended and account.restored (91). Any
-- later CHECK migration starts from this list.

ALTER TABLE "public"."farmer"
    ADD COLUMN "suspended_at"     TIMESTAMPTZ,
    ADD COLUMN "suspended_reason" TEXT,
    ADD COLUMN "suspended_by"     UUID;
ALTER TABLE "public"."farmer"
    ADD CONSTRAINT "farmer_suspended_by_fkey"
        FOREIGN KEY ("suspended_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "farmer_suspension_whole" CHECK (
        ("suspended_at" IS NULL) = ("suspended_reason" IS NULL)
        AND ("suspended_at" IS NULL) = ("suspended_by" IS NULL)
    );

ALTER TABLE "public"."buyer"
    ADD COLUMN "suspended_at"     TIMESTAMPTZ,
    ADD COLUMN "suspended_reason" TEXT,
    ADD COLUMN "suspended_by"     UUID;
ALTER TABLE "public"."buyer"
    ADD CONSTRAINT "buyer_suspended_by_fkey"
        FOREIGN KEY ("suspended_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "buyer_suspension_whole" CHECK (
        ("suspended_at" IS NULL) = ("suspended_reason" IS NULL)
        AND ("suspended_at" IS NULL) = ("suspended_by" IS NULL)
    );

-- A SELECT * view freezes its column list when it is created (DECISIONS, "A
-- view is a filter of its table"); the original filters, unchanged.
CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';
CREATE OR REPLACE VIEW "public"."buyer_active" WITH (security_invoker = true) AS
    SELECT b.* FROM "public"."buyer" b
    JOIN "public"."buyer_organization" o ON o."id" = b."organization_id"
    WHERE b."deleted_at" IS NULL AND o."deleted_at" IS NULL;

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
        'purchase_order.cancelled',
        'communication.sms_sent',
        'account.profile_updated',
        'staff.permission_granted',
        'staff.permission_revoked',
        'superadmin.granted',
        'superadmin.revoked',
        'staff.sessions_revoked',
        'staff.sessions_revoke_failed',
        'conversation.started',
        'message.sent',
        'conversation.blocked',
        'buyer.soft_deleted',
        'account.suspended',
        'account.restored'
    ));

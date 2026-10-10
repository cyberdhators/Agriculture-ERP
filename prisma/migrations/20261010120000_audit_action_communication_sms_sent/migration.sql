-- 2026-10-10: the administrator's SMS to farmers and officers, through Bird.
--
-- ONE CHANGE: the audit action CHECK gains `communication.sms_sent`. Nothing
-- else. No table, no column, no data is touched.
--
-- A CHECK can only be replaced, never extended, so this carries every key of
-- 20261006090000 (seventy-seven) plus the one new key. Removing none is what
-- packages/shared/tests/audit-check-matches-migrations.test.ts verifies.
--
-- SAFE TO DEPLOY THE CODE FIRST. POST /api/admin/communications reads this
-- constraint before sending an SMS and refuses with 503 `sms_not_configured`
-- until the key is accepted, so no message is sent and billed whose audit row
-- the database would then refuse. Email is unaffected either way.

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
        'communication.sms_sent'
    ));

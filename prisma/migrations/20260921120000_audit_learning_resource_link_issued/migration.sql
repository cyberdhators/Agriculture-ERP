-- Adds one audit action: 'learning_resource.link_issued'.
--
-- WHY IT IS AUDITED. A learning resource lives in a private bucket and is read
-- through a short-lived signed link. That link outlives the request that asked
-- for it and can be copied or forwarded, so the request is recorded -- who
-- asked, for what, when -- and never the link itself. This is the same
-- reasoning, and the same shape, as 'visit.attachment_link_issued', which the
-- constraint already carries.
--
-- Listing the catalogue is NOT audited. A list is metadata about files; a link
-- is access to one.
--
-- ADDITIVE. The constraint is rebuilt because a CHECK cannot be extended in
-- place. EVERY action already permitted is carried over unchanged -- the list
-- below is GENERATED from packages/shared/src/audit.ts, not retyped, because a
-- hand-copied list is how this constraint once lost three weather keys and
-- broke every route that wrote them on a fresh database.

ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";

ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK (
    "action" IN (
        'user.created', 'user.updated', 'user.password_set',
        'user.soft_deleted', 'officer.created', 'officer.updated',
        'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
        'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
        'location.created', 'location.renamed', 'location.soft_deleted',
        'farmer.created', 'farmer.updated', 'farmer.soft_deleted',
        'consent.recorded', 'farmer.verified', 'farmer.rejected',
        'farmer.merged', 'farmer.resubmitted', 'farmer.reassigned',
        'farm.created', 'farm.boundary_added', 'farm.boundary_superseded',
        'farm.crops_declared', 'farm.soft_deleted', 'farm.repointed',
        'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
        'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed',
        'visit.attachment_link_issued', 'visit.repointed', 'report.exported',
        'system.restored', 'directory_entry.created', 'directory_entry.updated',
        'directory_entry.soft_deleted', 'learning_resource.created', 'learning_resource.updated',
        'learning_resource.published', 'learning_resource.soft_deleted', 'learning_resource.link_issued',
        'weather_location.created', 'weather_location.updated', 'weather_location.soft_deleted',
        'product_report.created', 'product_report.status_changed', 'product_report.listing_removed',
        'communication.email_sent', 'communication.send_failed'
    ));

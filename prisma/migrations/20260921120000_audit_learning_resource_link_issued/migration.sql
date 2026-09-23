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
-- below is GENERATED from packages/shared/src/audit.ts, not retyped.
--
-- REGENERATED AFTER MERGING main. This migration is timestamped after main's
-- own audit migrations, so it runs last and its list is the one a fresh
-- database ends up with. Written before the merge it carried 56 keys and would
-- have DROPPED the ten marketplace actions main had added -- listing,
-- contact_request, market_price and notification -- failing every one of those
-- writes on its audit insert. That is the same way this constraint once lost
-- three weather keys. The list is generated, so the merge could be absorbed by
-- regenerating rather than by noticing.

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
        'communication.email_sent', 'communication.send_failed', 'listing.created',
        'listing.updated', 'listing.status_changed', 'listing.soft_deleted',
        'contact_request.created', 'contact_request.handled', 'market_price.created',
        'market_price.soft_deleted', 'notification.created', 'notification.read'
    ));

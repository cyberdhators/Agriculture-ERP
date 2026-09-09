-- Migration 21 (B11): the two things a restore writes. C-11.
--
-- system.restored: the one event that removes entries from the append-only
-- audit log leaves a note saying so (C-11.4). lost_on_restore: an attachment
-- whose file did not survive the restore is corrected from arrived to failed
-- with a code, so C-8.7 never calls a lost photo safe (C-11.3).
ALTER TABLE "public"."visit_attachment" DROP CONSTRAINT "visit_attachment_failure_code_known";
ALTER TABLE "public"."visit_attachment" ADD CONSTRAINT "visit_attachment_failure_code_known" CHECK (
    "failure_code" IS NULL OR "failure_code" IN ('size_mismatch', 'type_mismatch', 'grant_expired', 'device_gave_up', 'lost_on_restore')
);

ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted', 'farmer.reassigned',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted',
    'farm.repointed',
    'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
    'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed',
    'visit.attachment_link_issued', 'visit.repointed',
    'report.exported',
    'system.restored'
));

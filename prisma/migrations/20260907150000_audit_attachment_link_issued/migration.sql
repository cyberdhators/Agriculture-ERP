-- Migration 16 (B8): one more audit action key, generated from AUDIT_ACTIONS.
--
-- visit.attachment_link_issued: the one READ this system audits. An expiring
-- link to a farmer's photograph is a read that produces an artefact outliving
-- the request — a URL that works for minutes and can be copied or forwarded —
-- so its issuing is recorded: who asked, for which attachment, when. Never
-- the link itself. Owner's decision, 2026-09-07 (docs/DECISIONS.md, B8).
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted',
    'farm.created', 'farm.boundary_added', 'farm.boundary_superseded', 'farm.crops_declared', 'farm.soft_deleted',
    'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
    'visit.attachment_declared', 'visit.attachment_arrived', 'visit.attachment_failed',
    'visit.attachment_link_issued'
));

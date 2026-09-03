-- Migration 22 -- unit P1, the directory and learning-library routes (C-13.9)
--
-- P1's routes write audit rows, and every action key is refused by the database
-- unless it appears in the audit_event_action_known CHECK. This migration
-- widens that constraint to the seven keys P1 adds, in lockstep with the same
-- edit to AUDIT_ACTIONS in packages/shared/src/audit.ts and to
-- docs/api/CONVENTIONS.md section 5.2.2 -- one change, three places.
--
-- The constraint is dropped and recreated with the FULL list rather than
-- altered in place: a CHECK cannot be extended, only replaced. It is additive
-- in effect -- every key the old constraint allowed the new one allows too --
-- so it cannot fail against existing rows.
--
-- -------------------------------------------------------------------------
-- WHY THIS FILE IS DATED 2026-09-13 AND NOT 2026-09-05
-- -------------------------------------------------------------------------
-- It was written as migration 10, timestamped 20260905100000, before B5 to
-- B11 existed. Migrations 17, 20 and 21 each recreated this same constraint
-- with a longer list. Because this migration had never been applied, a
-- `migrate deploy` would have applied it AFTER those three -- replacing a
-- 40-key constraint with the 22 keys known in September, and silently
-- refusing every farmer, consent, verification, farm, boundary, crop, visit,
-- attachment and report audit row. Every create, update and delete in B5 to
-- B11 appends one of those, so every write in the system would have failed on
-- its audit insert.
--
-- Re-dating it puts it last, where its list is the current one. The list below
-- is generated from AUDIT_ACTIONS, not retyped: 47 keys.

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
        'learning_resource.soft_deleted'
    ));

-- Migration 11 (B6): verification, rejection, merging and escalation. C-6.
--
-- Additive. Same pattern as migrations 5, 6, 9, 10: RLS on with no policies,
-- views WITH (security_invoker = true), records of events are never deleted.

-- -----------------------------------------------------------------------------
-- The fourth state. `merged` is a state, with merged_into as the pointer, so
-- the queue, the view and reporting check one column (DECISIONS, B6).
-- -----------------------------------------------------------------------------
ALTER TYPE "public"."verification_status" ADD VALUE IF NOT EXISTS 'merged';

CREATE TYPE "public"."verification_decision" AS ENUM ('verified', 'rejected', 'merged', 'resubmitted');

-- -----------------------------------------------------------------------------
-- The escalation clock (C-6.7). Set at registration, reset on resubmission,
-- never editable otherwise: the trigger below refuses any other change.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."farmer"
    ADD COLUMN "pending_since" TIMESTAMPTZ NOT NULL DEFAULT now();
-- Existing rows: the clock started at registration.
UPDATE "public"."farmer" SET "pending_since" = "created_at";

-- -----------------------------------------------------------------------------
-- verification_event (data-model §1, corrected in B6): the actor is a staff
-- user for verified/rejected/merged and an officer for resubmitted; exactly
-- one of the two is set, and which one is tied to the decision.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."verification_event" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "farmer_id"       UUID        NOT NULL,
    "reviewer_id"     UUID,
    "officer_id"      UUID,
    "decision"        "public"."verification_decision" NOT NULL,
    "merge_target_id" UUID,
    -- Fixed keys, never sentences (C-6.3). Generated from REJECTION_REASONS in
    -- packages/shared/src/verification.ts -- the same list, so the database
    -- refuses any code the code does not define.
    "reason_code"     TEXT,
    -- The one free-text field about a named person. Data, not a message:
    -- returned only inside the verification record, never in the audit log,
    -- never in error reporting (C-6.3).
    "note"            TEXT,
    -- Whole days the record had waited when the decision was made (C-6.6).
    "days_waiting"    INTEGER     NOT NULL,
    "decided_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "verification_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "verification_event_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "verification_event_reviewer_id_fkey"
        FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id"),
    CONSTRAINT "verification_event_officer_id_fkey"
        FOREIGN KEY ("officer_id") REFERENCES "public"."officer"("id"),
    CONSTRAINT "verification_event_merge_target_id_fkey"
        FOREIGN KEY ("merge_target_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "verification_event_actor_matches_decision" CHECK (
        ("decision" = 'resubmitted' AND "officer_id" IS NOT NULL AND "reviewer_id" IS NULL) OR
        ("decision" <> 'resubmitted' AND "reviewer_id" IS NOT NULL AND "officer_id" IS NULL)
    ),
    CONSTRAINT "verification_event_reason_on_reject" CHECK (
        ("decision" = 'rejected' AND "reason_code" IS NOT NULL) OR
        ("decision" <> 'rejected')
    ),
    CONSTRAINT "verification_event_target_on_merge" CHECK (
        ("decision" = 'merged' AND "merge_target_id" IS NOT NULL) OR
        ("decision" <> 'merged' AND "merge_target_id" IS NULL)
    ),
    CONSTRAINT "verification_event_reason_known" CHECK ("reason_code" IS NULL OR "reason_code" IN (
        'duplicate',
        'wrong_location',
        'incomplete',
        'not_a_farmer',
        'consent_missing',
        'other'
    )),
    CONSTRAINT "verification_event_note_length" CHECK ("note" IS NULL OR length("note") <= 280),
    CONSTRAINT "verification_event_days_nonneg" CHECK ("days_waiting" >= 0)
);

CREATE INDEX "verification_event_farmer_idx"
    ON "public"."verification_event" ("farmer_id", "decided_at" DESC);
CREATE INDEX "verification_event_reviewer_idx"
    ON "public"."verification_event" ("reviewer_id", "decided_at" DESC);

ALTER TABLE "public"."verification_event" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- The queue (C-6.7): pending farmers in a state, oldest clock first.
-- -----------------------------------------------------------------------------
CREATE INDEX "farmer_queue_idx"
    ON "public"."farmer" ("state_id", "pending_since", "id")
    WHERE "deleted_at" IS NULL AND "verification_status" = 'pending';
CREATE INDEX "farmer_pending_since_idx"
    ON "public"."farmer" ("pending_since")
    WHERE "deleted_at" IS NULL AND "verification_status" = 'pending';

-- -----------------------------------------------------------------------------
-- The clock is immutable except on resubmission (C-6.7). Extends the B5
-- trigger so there is still one function guarding farmer's immutable fields.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."farmer_refuse_immutable_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."farmer_number" IS DISTINCT FROM OLD."farmer_number" THEN
        RAISE EXCEPTION 'farmer_number is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."registered_by" IS DISTINCT FROM OLD."registered_by" THEN
        RAISE EXCEPTION 'registered_by is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."pending_since" IS DISTINCT FROM OLD."pending_since"
       AND NOT (OLD."verification_status" = 'rejected' AND NEW."verification_status" = 'pending') THEN
        RAISE EXCEPTION 'pending_since is the escalation clock and changes only on resubmission'
            USING ERRCODE = 'check_violation';
    END IF;
    NEW."updated_at" := now();
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- The verified-only view (C-6.8). Every reach figure reads this and nothing
-- else. Pending, rejected, merged and soft-deleted rows are not in it.
-- -----------------------------------------------------------------------------
CREATE VIEW "public"."farmer_verified_v" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer"
    WHERE "deleted_at" IS NULL AND "verification_status" = 'verified';

-- -----------------------------------------------------------------------------
-- audit_event: four more action keys. Generated from AUDIT_ACTIONS.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";
ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
    'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
    'officer.created', 'officer.updated', 'officer.status_changed', 'officer.password_set', 'officer.soft_deleted',
    'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
    'location.created', 'location.renamed', 'location.soft_deleted',
    'farmer.created', 'farmer.updated', 'farmer.soft_deleted', 'consent.recorded',
    'farmer.verified', 'farmer.rejected', 'farmer.merged', 'farmer.resubmitted'
));

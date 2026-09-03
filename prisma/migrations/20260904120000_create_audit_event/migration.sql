-- Migration 9 -- unit B4, the append-only audit log
--
-- Criteria C-4.1 to C-4.9 in docs/scope-and-acceptance.md. Shape from
-- docs/data-model.md, with two corrections recorded in docs/DECISIONS.md:
-- entity_id is text (locations are keyed by codes), and actor_id carries no
-- foreign key (a row must survive its actor being removed).

CREATE TYPE "public"."audit_actor_type" AS ENUM ('admin', 'supervisor', 'read_only', 'officer', 'system');

CREATE TABLE "public"."audit_event" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT        NOT NULL,
    -- text, not uuid: a uuid still fits, and state/county/payam are keyed by
    -- codes like CE-JUB-MUN, which the reseed must be able to record.
    "entity_id"   TEXT        NOT NULL,
    "actor_type"  "public"."audit_actor_type" NOT NULL,
    -- No foreign key, deliberately. Append-only means a row can never be
    -- cascaded or nulled when its actor is hard-deleted (the test sweep does
    -- exactly that), and a key would make that either fail or corrupt history.
    -- Null only when actor_type is system (C-4.3): a script has no principal.
    "actor_id"    UUID,
    "action"      TEXT        NOT NULL,
    -- Changed fields only, never whole rows. Never a password, token or
    -- authentication identifier (C-4.6): writeAudit strips them before this
    -- row is written, and a test proves it.
    "before"      JSONB,
    "after"       JSONB,
    "device_id"   TEXT,
    -- Server time inside the transaction, never client-supplied.
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_event_actor_matches_type" CHECK (
        ("actor_type" = 'system' AND "actor_id" IS NULL) OR
        ("actor_type" <> 'system' AND "actor_id" IS NOT NULL)
    ),
    -- ACTIONS ARE KEYS, NOT SENTENCES (C-4.7). Generated from AUDIT_ACTIONS in
    -- packages/shared/src/audit.ts -- the same list, so the database refuses
    -- any key the code does not define. Adding an action means editing both,
    -- in one change, which a reviewer sees.
    CONSTRAINT "audit_event_action_known" CHECK ("action" IN (
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
        'location.soft_deleted'
    ))
);

-- docs/data-model-extension.md section 10, exactly.
CREATE INDEX "audit_event_entity_idx"
    ON "public"."audit_event" ("entity_type", "entity_id", "occurred_at" DESC);
CREATE INDEX "audit_event_actor_idx"
    ON "public"."audit_event" ("actor_id", "occurred_at" DESC);
-- The cursor sort for GET /api/audit: occurred_at desc, id desc as tiebreak.
CREATE INDEX "audit_event_occurred_idx"
    ON "public"."audit_event" ("occurred_at" DESC, "id" DESC);

ALTER TABLE "public"."audit_event" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- APPEND-ONLY, ENFORCED BY THE DATABASE  (C-4.2)
-- =============================================================================
--
-- A TRIGGER, NOT A REVOKE FROM THE OWNER. The application connects AS the
-- owner (postgres). A privilege revoked from the owner is re-grantable by the
-- owner in the same session, so REVOKE protects against nothing this code can
-- run. The trigger below raises for every role including the owner, until
-- someone deliberately removes it.
--
-- WHAT THIS DOES NOT STOP, stated plainly: a superuser, or the owner via
-- DROP TRIGGER, ALTER TABLE ... DISABLE TRIGGER, or TRUNCATE, can still alter
-- history. Those are deliberate DDL acts, visible as migration drift, not
-- something an ordinary code path does by accident. This is append-only
-- against the application, not immutability against the database's owner.
-- Do not describe it as immutable anywhere.

CREATE OR REPLACE FUNCTION "public"."audit_event_refuse_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Audit history is never updated or deleted. Append a new row instead.';
END;
$$;

CREATE TRIGGER "audit_event_append_only"
    BEFORE UPDATE OR DELETE ON "public"."audit_event"
    FOR EACH ROW EXECUTE FUNCTION "public"."audit_event_refuse_change"();

-- Belt and braces for the client-facing roles, which never reach this table
-- directly anyway: RLS with no policies already denies them everything.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."audit_event" FROM anon, authenticated;

-- Migration 6 -- unit B3, identity and roles
--
-- Criteria C-3.1 to C-3.9 in docs/scope-and-acceptance.md.
-- Shapes from docs/data-model.md (user, officer) and data-model-extension 1.3.

-- =============================================================================
-- ROLES
-- =============================================================================
-- Office staff hold one of three. Officers are a separate table, not a fourth
-- role here: they authenticate differently, are scoped differently, and belong
-- to a payam. C-3.2 counts four roles across the system; this enum covers the
-- three that office staff can hold.

CREATE TYPE "public"."user_role" AS ENUM ('admin', 'supervisor', 'read_only');

-- =============================================================================
-- USER  -- office staff
-- =============================================================================
--
-- No email column, deliberately. Email lives in auth.users and nowhere else, so
-- the two cannot drift. auth_user_id is the only link. See docs/DECISIONS.md.

CREATE TABLE "public"."user" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"   UUID        NOT NULL,
    "name"           TEXT        NOT NULL,
    "role"           "public"."user_role" NOT NULL,
    "scope_state_id" TEXT,
    "last_login_at"  TIMESTAMPTZ,
    "deleted_at"     TIMESTAMPTZ,
    "deleted_by"     UUID,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_auth_user_id_key" UNIQUE ("auth_user_id"),
    CONSTRAINT "user_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "user_scope_state_id_fkey"
        FOREIGN KEY ("scope_state_id") REFERENCES "public"."state"("id"),

    -- C-3.4, and the note in C-3: a null scope must NEVER mean "everything".
    -- A supervisor or read_only account must carry a state; an admin must not.
    -- The database enforces it so no route has to remember.
    CONSTRAINT "user_scope_matches_role" CHECK (
        ("role" = 'admin'      AND "scope_state_id" IS NULL) OR
        ("role" IN ('supervisor', 'read_only') AND "scope_state_id" IS NOT NULL)
    )
);

-- =============================================================================
-- OFFICER  -- extension officers in the field
-- =============================================================================
--
-- phone is the login identity the officer types. The identifier actually
-- presented to Supabase Auth is DERIVED from it and is not stored here: it is
-- an authentication detail, not a field of the officer. See docs/DECISIONS.md
-- and docs/api/CONVENTIONS.md section 2.

-- payam needs a unique on (id, state_id) before anything can reference that
-- pair, exactly as county needed one in migration 5. This ALTER must come
-- BEFORE the officer table below: a composite foreign key requires its target
-- constraint to already exist, and Postgres reports the omission as
-- "there is no unique constraint matching given keys for referenced table".
ALTER TABLE "public"."payam"
    ADD CONSTRAINT "payam_id_state_id_key" UNIQUE ("id", "state_id");

CREATE TYPE "public"."officer_status" AS ENUM ('active', 'inactive');

CREATE TABLE "public"."officer" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"   UUID        NOT NULL,
    "name"           TEXT        NOT NULL,
    -- E.164, exactly as phoneSchema produces it. Never the GoTrue form, which
    -- strips the leading plus.
    "phone"          TEXT        NOT NULL,
    "payam_id"       TEXT        NOT NULL,
    -- Denormalised, per data-model-extension 1.4, so a scope check is not a join.
    "state_id"       TEXT        NOT NULL,
    "status"         "public"."officer_status" NOT NULL DEFAULT 'active',
    "last_sync_at"   TIMESTAMPTZ,
    "deleted_at"     TIMESTAMPTZ,
    "deleted_by"     UUID,

    CONSTRAINT "officer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "officer_auth_user_id_key" UNIQUE ("auth_user_id"),
    CONSTRAINT "officer_phone_key" UNIQUE ("phone"),
    CONSTRAINT "officer_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "officer_phone_e164" CHECK ("phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "officer_payam_id_fkey"
        FOREIGN KEY ("payam_id") REFERENCES "public"."payam"("id"),
    CONSTRAINT "officer_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    -- Same composite trick as payam: an officer's state cannot disagree with
    -- the state of their payam.
    CONSTRAINT "officer_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id")
        REFERENCES "public"."payam"("id", "state_id")
);

-- =============================================================================
-- THE DEFERRED deleted_by FOREIGN KEYS  -- B3 opening task 6
-- =============================================================================
--
-- B2 carried deleted_by as a nullable uuid with no key, because `user` did not
-- exist. This is the promise being kept. Adding a constraint to a populated
-- table validates it against existing rows -- all null here, so it cannot fail.
-- The precedent is recorded in docs/DECISIONS.md.

ALTER TABLE "public"."state"  ADD CONSTRAINT "state_deleted_by_fkey"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");
ALTER TABLE "public"."county" ADD CONSTRAINT "county_deleted_by_fkey"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");
ALTER TABLE "public"."payam"  ADD CONSTRAINT "payam_deleted_by_fkey"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");
ALTER TABLE "public"."user"   ADD CONSTRAINT "user_deleted_by_fkey"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");
ALTER TABLE "public"."officer" ADD CONSTRAINT "officer_deleted_by_fkey"
    FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX "user_role_idx"           ON "public"."user" ("role");
CREATE INDEX "user_scope_state_id_idx" ON "public"."user" ("scope_state_id");
CREATE INDEX "user_active_idx"         ON "public"."user" ("role") WHERE "deleted_at" IS NULL;

CREATE INDEX "officer_payam_id_idx"    ON "public"."officer" ("payam_id");
CREATE INDEX "officer_state_id_idx"    ON "public"."officer" ("state_id");
CREATE INDEX "officer_active_idx"      ON "public"."officer" ("state_id")
    WHERE "deleted_at" IS NULL AND "status" = 'active';

-- =============================================================================
-- ROW-LEVEL SECURITY  -- deny by default, no policies
-- =============================================================================

ALTER TABLE "public"."user"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."officer" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS
-- =============================================================================
--
-- security_invoker = true, or the view reads past the RLS above. See
-- migration 5.
--
-- C-3.6: an account is not-active either by status or by soft deletion, and
-- both must end access. officer_active encodes both, so a single view is the
-- one place that decides.

CREATE VIEW "public"."user_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."user" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."officer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."officer"
    WHERE "deleted_at" IS NULL AND "status" = 'active';

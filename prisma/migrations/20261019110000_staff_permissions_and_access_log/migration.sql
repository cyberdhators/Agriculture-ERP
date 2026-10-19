-- STAFF PERMISSIONS LANE (2026-10-19). CORWADO's specification of 16 October
-- 2026, the administration part: staff permission presets, Super Admin
-- delegation, and per-account access logs.
--
-- ADDITIVE ONLY. Four new tables, one trigger function per purpose, and
-- triggers on the account tables that only ever INSERT into the new access
-- log. No existing column, constraint, view or row is changed. The four staff
-- roles and requireRole are untouched: a permission is a second, finer
-- question asked only by the routes this lane added.
--
-- Row-level security is ON for every new table with NO policies -- the
-- deny-by-default backstop every table here has. Only the API's own
-- connection reads or writes them.
--
-- NOT APPLIED by the session that wrote it. Applying it is the integrating
-- session's decision (there is only the production database).

-- =============================================================================
-- 1. STAFF PERMISSION GRANTS
-- =============================================================================
--
-- One row per preset given to one staff account. A staff member may hold
-- several presets; at most one ACTIVE grant per (account, preset) -- changing
-- a preset's scope is a revocation and a new grant, so the trail shows both.
--
-- Revocation is the soft delete: `revoked_at`, `revoked_by` and
-- `revoke_reason` are set together and never cleared. A row is never deleted.
-- Every grant and revocation also writes an audit_event row in the same
-- transaction (staff.permission_granted / revoked, superadmin.granted /
-- revoked).

CREATE TABLE "public"."staff_permission_grant" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID        NOT NULL,
    "preset"        TEXT        NOT NULL,
    "scope_kind"    TEXT        NOT NULL,
    "reason"        TEXT        NOT NULL,
    "granted_by"    UUID        NOT NULL,
    "granted_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revoked_at"    TIMESTAMPTZ,
    "revoked_by"    UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "staff_permission_grant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_permission_grant_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user"("id"),
    CONSTRAINT "staff_permission_grant_granted_by_fkey"
        FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "staff_permission_grant_revoked_by_fkey"
        FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id"),
    -- The same list as STAFF_PRESETS in packages/shared/src/staff-permissions.ts.
    CONSTRAINT "staff_permission_grant_preset_known" CHECK ("preset" IN (
        'super_admin', 'administrator', 'moderator_editor', 'analyst', 'support'
    )),
    CONSTRAINT "staff_permission_grant_scope_known" CHECK ("scope_kind" IN ('platform', 'states')),
    -- Super Admin is national by definition; it can never be limited to states.
    CONSTRAINT "staff_permission_grant_super_admin_platform"
        CHECK ("preset" <> 'super_admin' OR "scope_kind" = 'platform'),
    CONSTRAINT "staff_permission_grant_reason_not_blank" CHECK (btrim("reason") <> ''),
    -- A revocation is all three facts or none of them.
    CONSTRAINT "staff_permission_grant_revocation_complete" CHECK (
        ("revoked_at" IS NULL AND "revoked_by" IS NULL AND "revoke_reason" IS NULL) OR
        ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND btrim("revoke_reason") <> '')
    )
);

CREATE UNIQUE INDEX "staff_permission_grant_one_active_key"
    ON "public"."staff_permission_grant" ("user_id", "preset") WHERE "revoked_at" IS NULL;
CREATE INDEX "staff_permission_grant_active_preset_idx"
    ON "public"."staff_permission_grant" ("preset") WHERE "revoked_at" IS NULL;

ALTER TABLE "public"."staff_permission_grant" ENABLE ROW LEVEL SECURITY;

-- The states a `states`-scoped grant covers. Written once with the grant and
-- never changed: a different set of states is a new grant.
CREATE TABLE "public"."staff_permission_grant_state" (
    "grant_id" UUID NOT NULL,
    "state_id" TEXT NOT NULL,

    CONSTRAINT "staff_permission_grant_state_pkey" PRIMARY KEY ("grant_id", "state_id"),
    CONSTRAINT "staff_permission_grant_state_grant_id_fkey"
        FOREIGN KEY ("grant_id") REFERENCES "public"."staff_permission_grant"("id"),
    CONSTRAINT "staff_permission_grant_state_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id")
);

ALTER TABLE "public"."staff_permission_grant_state" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. ACCESS LOG -- append-only, per account
-- =============================================================================
--
-- account_created, first_sign_in, sign_in, return_session, reauth_failed.
-- The actor is the APPLICATION row id and its kind (user, officer, buyer,
-- farmer) -- never the auth account id, never an email or phone.
--
-- NO RAW IP ADDRESS AND NO USER AGENT are stored. `device_label` is at most a
-- platform family (android, ios, windows, mac, linux, other), derived in the
-- application and checked here. Times are UTC; the portal displays them in
-- Africa/Juba.
--
-- RETENTION IS AN OPEN DECISION (docs/DECISIONS.md, 2026-10-19). Nothing here
-- expires rows; nothing may delete them either, by the trigger below.

CREATE TABLE "public"."access_log" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "principal_kind" TEXT        NOT NULL,
    "principal_id"   UUID        NOT NULL,
    "event"          TEXT        NOT NULL,
    "occurred_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "device_label"   TEXT,

    CONSTRAINT "access_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_log_principal_kind_known"
        CHECK ("principal_kind" IN ('user', 'officer', 'buyer', 'farmer')),
    -- The same list as ACCESS_EVENTS in packages/shared/src/staff-permissions.ts.
    CONSTRAINT "access_log_event_known" CHECK ("event" IN (
        'account_created', 'first_sign_in', 'sign_in', 'return_session', 'reauth_failed'
    )),
    CONSTRAINT "access_log_device_label_known" CHECK ("device_label" IS NULL OR "device_label" IN (
        'android', 'ios', 'windows', 'mac', 'linux', 'other'
    ))
);

CREATE INDEX "access_log_occurred_idx"
    ON "public"."access_log" ("occurred_at" DESC, "id" DESC);
CREATE INDEX "access_log_principal_idx"
    ON "public"."access_log" ("principal_kind", "principal_id", "occurred_at" DESC);
CREATE INDEX "access_log_event_idx"
    ON "public"."access_log" ("event", "occurred_at" DESC);

ALTER TABLE "public"."access_log" ENABLE ROW LEVEL SECURITY;

-- Append-only, the same way audit_event is: a trigger that raises for every
-- role including the owner the application connects as (see migration
-- 20260904120000 for why a REVOKE from the owner would protect nothing).
CREATE OR REPLACE FUNCTION "public"."access_log_refuse_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'access_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Access history is never updated or deleted. Append a new row instead.';
END;
$$;

CREATE TRIGGER "access_log_append_only"
    BEFORE UPDATE OR DELETE ON "public"."access_log"
    FOR EACH ROW EXECUTE FUNCTION "public"."access_log_refuse_change"();

REVOKE UPDATE, DELETE, TRUNCATE ON "public"."access_log" FROM anon, authenticated;

-- =============================================================================
-- 3. ACCOUNT ACTIVITY -- one row per account, "last activity"
-- =============================================================================
--
-- What the return-session classifier needs and what the access-log screen
-- shows as "last activity": when the account was last seen, first signed in
-- and last signed in. A moving pointer, not a record, so it is updated in
-- place and not audited row by row (as assistant_usage is not). The history
-- lives in access_log.

CREATE TABLE "public"."account_activity" (
    "principal_kind"   TEXT        NOT NULL,
    "principal_id"     UUID        NOT NULL,
    "first_sign_in_at" TIMESTAMPTZ,
    "last_sign_in_at"  TIMESTAMPTZ,
    "last_seen_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "account_activity_pkey" PRIMARY KEY ("principal_kind", "principal_id"),
    CONSTRAINT "account_activity_principal_kind_known"
        CHECK ("principal_kind" IN ('user', 'officer', 'buyer', 'farmer'))
);

ALTER TABLE "public"."account_activity" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. "ACCOUNT CREATED", RECORDED WHERE ACCOUNTS ARE CREATED
-- =============================================================================
--
-- An AFTER INSERT trigger on each account table, so every route that creates
-- an account -- staff, officer, buyer self-registration, farmer
-- self-registration -- is covered without editing any of them.
--
-- IT CAN NEVER BREAK AN ACCOUNT CREATION. The insert runs inside its own
-- exception block: if it fails for any reason, a WARNING is raised and the
-- account is created exactly as it would have been without this migration.
--
-- A farmer row is an ACCOUNT only once it has an auth_user_id: most farmers
-- are registered by an officer and never sign in. So the farmer trigger fires
-- on insert with an auth_user_id, and on the update that first gives one.

CREATE OR REPLACE FUNCTION "public"."access_log_account_created"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'farmer' THEN
        IF NEW."auth_user_id" IS NULL THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD."auth_user_id" IS NOT NULL THEN
            RETURN NEW;
        END IF;
    END IF;
    BEGIN
        INSERT INTO "public"."access_log" ("principal_kind", "principal_id", "event")
        -- The table name IS the principal kind: user, officer, buyer, farmer.
        VALUES (TG_TABLE_NAME, NEW."id", 'account_created');
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'access_log: account_created not recorded for % (%)', TG_TABLE_NAME, SQLSTATE;
    END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "user_access_log_account_created"
    AFTER INSERT ON "public"."user"
    FOR EACH ROW EXECUTE FUNCTION "public"."access_log_account_created"();

CREATE TRIGGER "officer_access_log_account_created"
    AFTER INSERT ON "public"."officer"
    FOR EACH ROW EXECUTE FUNCTION "public"."access_log_account_created"();

CREATE TRIGGER "buyer_access_log_account_created"
    AFTER INSERT ON "public"."buyer"
    FOR EACH ROW EXECUTE FUNCTION "public"."access_log_account_created"();

CREATE TRIGGER "farmer_access_log_account_created"
    AFTER INSERT OR UPDATE OF "auth_user_id" ON "public"."farmer"
    FOR EACH ROW EXECUTE FUNCTION "public"."access_log_account_created"();

-- The accounts that already exist get their "account created" event too,
-- dated when the row was created, so the log starts complete rather than on
-- the day this migration ran. Soft-deleted accounts included: they existed.
INSERT INTO "public"."access_log" ("principal_kind", "principal_id", "event", "occurred_at")
SELECT 'user', "id", 'account_created', "created_at" FROM "public"."user";

INSERT INTO "public"."access_log" ("principal_kind", "principal_id", "event", "occurred_at")
SELECT 'officer', "id", 'account_created', "created_at" FROM "public"."officer";

INSERT INTO "public"."access_log" ("principal_kind", "principal_id", "event", "occurred_at")
SELECT 'buyer', "id", 'account_created', "created_at" FROM "public"."buyer";

-- A farmer's account creation is dated by the farmer row: farmers who
-- self-register get both at once. A farmer linked to an account later is
-- dated by the row, which is the earliest the account can have existed.
INSERT INTO "public"."access_log" ("principal_kind", "principal_id", "event", "occurred_at")
SELECT 'farmer', "id", 'account_created', "created_at" FROM "public"."farmer"
 WHERE "auth_user_id" IS NOT NULL;

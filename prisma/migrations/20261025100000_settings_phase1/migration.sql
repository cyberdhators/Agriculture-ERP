-- 2026-10-25 -- SETTINGS, PHASE 1 (CORWADO's 16 October specification, the
-- "Settings" tab: "Service configuration, policy versions, security,
-- integration and recovery controls"). docs/DECISIONS.md, "Settings, phase 1".
--
-- ADDITIVE: two new tables and their seed rows. No existing table, column or
-- row changes.
--
-- NO AUDIT CHECK HERE, deliberately, as in 20261024090000_adviser_approval.
-- This change adds audit keys to AUDIT_ACTIONS (setting.changed, notice.*);
-- one combined CHECK migration is written by the owner. Until it is applied
-- the database refuses these keys, so every write here is refused rather
-- than unlogged.
--
-- NO SECRET IS STORED HERE. Integrations are reported by whether an
-- environment variable NAME is present, computed in the route; nothing in
-- either table holds a key, a token or a password.

-- -----------------------------------------------------------------------------
-- 1. SETTING_VERSION -- one row per saved version of one setting.
--
-- VERSIONED, NEVER OVERWRITTEN. A change appends version n+1; the current
-- value of a key is its highest version. No row is ever updated or deleted
-- (the trigger below), so every earlier value stays readable.
--
-- The value is JSON; its shape is the shared Zod schema for that key
-- (packages/shared/src/settings.ts), checked by the route before it is
-- written. The database checks only what it can: a known key, an object.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."setting_version" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "key"        TEXT        NOT NULL,
    "version"    INTEGER     NOT NULL,
    "value"      JSONB       NOT NULL,
    -- NULL only for a row seeded by a migration.
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "setting_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "setting_version_changed_by_fkey"
        FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id"),
    -- SETTING_KEYS in packages/shared/src/settings.ts.
    CONSTRAINT "setting_version_key_known" CHECK ("key" IN (
        'identity', 'support', 'maintenance', 'reason_codes'
    )),
    CONSTRAINT "setting_version_version_positive" CHECK ("version" > 0),
    CONSTRAINT "setting_version_value_object" CHECK (jsonb_typeof("value") = 'object'),
    CONSTRAINT "setting_version_value_size" CHECK (pg_column_size("value") <= 65536)
);

-- Two saves of the same version from two tabs: the second is refused by the
-- database, not only by the route.
CREATE UNIQUE INDEX "setting_version_key_version_key"
    ON "public"."setting_version" ("key", "version");

CREATE OR REPLACE FUNCTION "public"."setting_version_refuse_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'setting_version is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'A setting is changed by appending its next version.';
END;
$$;

CREATE TRIGGER "setting_version_append_only"
    BEFORE UPDATE OR DELETE ON "public"."setting_version"
    FOR EACH ROW EXECUTE FUNCTION "public"."setting_version_refuse_change"();

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."setting_version" ENABLE ROW LEVEL SECURITY;

-- THE DEFAULT MODERATION REASON CODES (version 1). Archived, never deleted:
-- the route refuses a save that drops a code that existed before.
INSERT INTO "public"."setting_version" ("key", "version", "value") VALUES (
    'reason_codes', 1, '{"codes": [
        {"code": "prohibited_content", "label": "Prohibited content", "applies_to": ["listing", "profile", "report"], "active": true},
        {"code": "misleading_listing", "label": "Misleading listing", "applies_to": ["listing", "report"], "active": true},
        {"code": "fraud_or_scam", "label": "Fraud or scam", "applies_to": ["listing", "account", "profile", "report"], "active": true},
        {"code": "abusive_behaviour", "label": "Abusive behaviour", "applies_to": ["account", "profile", "report"], "active": true},
        {"code": "duplicate_or_spam", "label": "Duplicate or spam", "applies_to": ["listing", "account", "profile", "report"], "active": true},
        {"code": "other", "label": "Other", "applies_to": ["listing", "account", "profile", "report"], "active": true}
    ]}'::jsonb
);

-- -----------------------------------------------------------------------------
-- 2. NOTICE -- versioned consent, terms and privacy texts.
--
--   draft --(publish)--> published --(a newer version is published)--> retired
--   draft --(discard)--> soft-deleted
--
-- At most one published notice per kind and language (the partial unique
-- index). A published or retired notice is never edited: its body is what
-- people agreed to. The consent text a farmer accepts is recorded on
-- public.consent as text_version '<version>-<language>' (e.g. 'v1.3-en'),
-- exactly as the sign-up screens recorded it before this table existed.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."notice" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "kind"         TEXT        NOT NULL,
    "version"      TEXT        NOT NULL,
    "language"     "public"."language" NOT NULL,
    "body"         TEXT        NOT NULL,
    "status"       TEXT        NOT NULL DEFAULT 'draft',
    -- NULL only for a row seeded by a migration.
    "created_by"   UUID,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "published_at" TIMESTAMPTZ,
    "published_by" UUID,
    "retired_at"   TIMESTAMPTZ,
    "retired_by"   UUID,
    "deleted_at"   TIMESTAMPTZ,

    CONSTRAINT "notice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notice_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "notice_published_by_fkey"
        FOREIGN KEY ("published_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "notice_retired_by_fkey"
        FOREIGN KEY ("retired_by") REFERENCES "public"."user"("id"),
    -- NOTICE_KINDS in packages/shared/src/settings.ts.
    CONSTRAINT "notice_kind_known" CHECK ("kind" IN ('consent', 'terms', 'privacy')),
    -- NOTICE_VERSION_PATTERN: 'v1', 'v1.3', 'v2.0.1'.
    CONSTRAINT "notice_version_shape" CHECK ("version" ~ '^v[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'),
    CONSTRAINT "notice_body_length" CHECK (char_length("body") BETWEEN 20 AND 20000),
    CONSTRAINT "notice_status_known" CHECK ("status" IN ('draft', 'published', 'retired')),
    -- A published or retired notice says when it was published.
    CONSTRAINT "notice_published_recorded" CHECK (
        "status" = 'draft' OR "published_at" IS NOT NULL
    ),
    CONSTRAINT "notice_retired_recorded" CHECK (
        "status" <> 'retired' OR "retired_at" IS NOT NULL
    ),
    -- Only a draft is ever discarded.
    CONSTRAINT "notice_only_drafts_deleted" CHECK (
        "deleted_at" IS NULL OR "status" = 'draft'
    )
);

-- One row per kind, version and language.
CREATE UNIQUE INDEX "notice_kind_version_language_key"
    ON "public"."notice" ("kind", "version", "language")
    WHERE "deleted_at" IS NULL;
-- At most one published notice per kind and language.
CREATE UNIQUE INDEX "notice_one_published"
    ON "public"."notice" ("kind", "language")
    WHERE "status" = 'published' AND "deleted_at" IS NULL;

ALTER TABLE "public"."notice" ENABLE ROW LEVEL SECURITY;

-- THE CURRENT CONSENT TEXT, v1.3, as published -- word for word the
-- 'consent.body' of apps/web/lib/i18n/en.ts and ar.ts, which the sign-up
-- screens show and record as 'v1.3-en' and 'v1.3-ar'. A test
-- (apps/web/tests/settings-scan.test.ts) holds the two in step.
INSERT INTO "public"."notice" ("kind", "version", "language", "body", "status", "published_at") VALUES
    ('consent', 'v1.3', 'en', 'AgriOne South Sudan records your name, phone number, place, farm details and what you post, so that buyers and sellers can find you and you can be connected to markets, inputs and advice. People reach you through messages in the app. Your phone number is shown on something you post only if you choose, and when you send a buyer request to a seller, your phone number is given to that seller. Your messages are seen only by you and the person you write to. Your details are otherwise shared only with the officers and partners running this programme. You may ask to see or remove your record at any time. Registering means you agree to this.', 'published', now()),
    ('consent', 'v1.3', 'ar', 'يسجل أجري ون جنوب السودان اسمك ورقم هاتفك ومكانك وبيانات مزرعتك وما تنشره، حتى يجدك المشترون والبائعون وتتصل بالأسواق والمدخلات والنصائح. يتواصل معك الناس عبر الرسائل داخل التطبيق. لا يظهر رقم هاتفك على ما تنشره إلا إذا اخترت ذلك، وعندما ترسل طلب شراء إلى بائع يُعطى رقم هاتفك لذلك البائع. لا يرى رسائلك إلا أنت والشخص الذي تراسله. فيما عدا ذلك لا تُشارك بياناتك إلا مع المسؤولين والشركاء القائمين على هذا البرنامج. يمكنك طلب الاطلاع على سجلك أو حذفه في أي وقت. التسجيل يعني موافقتك على ذلك.', 'published', now());

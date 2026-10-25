-- 2026-10-27 -- OFFICIAL ANNOUNCEMENTS, MESSAGE TEMPLATES, DELIVERY RECORDS
-- AND NOTIFICATION PREFERENCES. CORWADO's 16 October specification, the
-- Communications tab: "Official announcements, templates, recipient scope,
-- preferences and delivery records. Preview before sending; private
-- conversations are not a broadcast resource." docs/DECISIONS.md, "Official
-- announcements".
--
-- ADDITIVE: four new tables. No existing table, column or row changes.
--
-- NO AUDIT CHECK HERE, deliberately, as in 20261025100000_settings_phase1.
-- This change adds audit keys to AUDIT_ACTIONS (message_template.*,
-- announcement.*, notification_preference.updated); one combined CHECK
-- migration is written by the owner. Until it is applied the database
-- refuses these keys, so every write here is refused rather than unlogged.
--
-- NO CONTACT DETAIL IS STORED HERE. A delivery names its recipient by record
-- id; the phone number or address is read from the account tables at the
-- moment of sending and never copied into these rows.

-- -----------------------------------------------------------------------------
-- 1. MESSAGE_TEMPLATE -- saved texts, one channel each.
--   draft <-> active <-> archived. Never deleted: an announcement may name it.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."message_template" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"       TEXT        NOT NULL,
    "channel"    TEXT        NOT NULL,
    -- The in-app title and email subject. NULL for an SMS template.
    "title"      TEXT,
    "body"       TEXT        NOT NULL,
    "status"     TEXT        NOT NULL DEFAULT 'draft',
    "created_by" UUID        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_by" UUID        NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_template_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "message_template_updated_by_fkey"
        FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id"),
    -- ANNOUNCEMENT_CHANNELS in packages/shared/src/announcements.ts.
    CONSTRAINT "message_template_channel_known" CHECK ("channel" IN ('in_app', 'sms', 'email')),
    -- TEMPLATE_STATUSES.
    CONSTRAINT "message_template_status_known" CHECK ("status" IN ('draft', 'active', 'archived')),
    CONSTRAINT "message_template_name_length" CHECK (char_length("name") BETWEEN 3 AND 80),
    CONSTRAINT "message_template_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000),
    -- An SMS has no title; in-app and email always have one.
    CONSTRAINT "message_template_title_by_channel" CHECK (
        ("channel" = 'sms') = ("title" IS NULL)
    ),
    CONSTRAINT "message_template_title_length" CHECK (
        "title" IS NULL OR char_length("title") BETWEEN 3 AND 120
    )
);

CREATE INDEX "message_template_status_idx"
    ON "public"."message_template" ("status", "updated_at" DESC);

ALTER TABLE "public"."message_template" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. ANNOUNCEMENT -- one official announcement.
--
--   draft --(send: deliveries queued)--> sending --(nothing left queued)--> completed
--   draft --(discard)--> soft-deleted
--
-- Only a draft is edited or discarded. A sent announcement's text is what
-- people received and stays as it was.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."announcement" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "title"           TEXT        NOT NULL,
    "body"            TEXT        NOT NULL,
    "sms_body"        TEXT,
    "category"        TEXT        NOT NULL DEFAULT 'announcement',
    "channels"        TEXT[]      NOT NULL,
    "scope_kind"      TEXT        NOT NULL,
    "scope_state_id"  TEXT,
    "scope_activity"  TEXT,
    "template_id"     UUID,
    "status"          TEXT        NOT NULL DEFAULT 'draft',
    -- Set when the deliveries are queued: how many recipients the send had.
    "recipient_count" INTEGER,
    "created_by"      UUID        NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "sent_by"         UUID,
    "sent_at"         TIMESTAMPTZ,
    "completed_at"    TIMESTAMPTZ,
    "deleted_at"      TIMESTAMPTZ,
    "deleted_by"      UUID,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "announcement_sent_by_fkey"
        FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "announcement_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "announcement_template_id_fkey"
        FOREIGN KEY ("template_id") REFERENCES "public"."message_template"("id"),
    CONSTRAINT "announcement_scope_state_id_fkey"
        FOREIGN KEY ("scope_state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "announcement_title_length" CHECK (char_length("title") BETWEEN 3 AND 120),
    CONSTRAINT "announcement_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "announcement_sms_body_length" CHECK (
        "sms_body" IS NULL OR char_length("sms_body") BETWEEN 1 AND 2000
    ),
    -- ANNOUNCEMENT_CATEGORIES.
    CONSTRAINT "announcement_category_known" CHECK ("category" IN ('announcement', 'essential')),
    -- At least one channel, each known.
    CONSTRAINT "announcement_channels_known" CHECK (
        cardinality("channels") BETWEEN 1 AND 3
        AND "channels" <@ ARRAY['in_app', 'sms', 'email']::text[]
    ),
    -- An SMS announcement carries its SMS text.
    CONSTRAINT "announcement_sms_text" CHECK (
        NOT ('sms' = ANY ("channels")) OR "sms_body" IS NOT NULL
    ),
    -- ANNOUNCEMENT_SCOPES.
    CONSTRAINT "announcement_scope_known" CHECK ("scope_kind" IN (
        'all', 'phone', 'email', 'state', 'activity', 'staff', 'officers'
    )),
    -- A state scope names its state, an activity scope its activity; no
    -- other scope names either.
    CONSTRAINT "announcement_scope_whole" CHECK (
        ("scope_kind" = 'state') = ("scope_state_id" IS NOT NULL)
        AND ("scope_kind" = 'activity') = ("scope_activity" IS NOT NULL)
    ),
    -- ANNOUNCEMENT_STATUSES.
    CONSTRAINT "announcement_status_known" CHECK ("status" IN ('draft', 'sending', 'completed')),
    CONSTRAINT "announcement_sent_recorded" CHECK (
        "status" = 'draft'
        OR ("sent_at" IS NOT NULL AND "sent_by" IS NOT NULL AND "recipient_count" IS NOT NULL)
    ),
    CONSTRAINT "announcement_completed_recorded" CHECK (
        "status" <> 'completed' OR "completed_at" IS NOT NULL
    ),
    -- Only a draft is ever discarded.
    CONSTRAINT "announcement_only_drafts_deleted" CHECK (
        "deleted_at" IS NULL OR "status" = 'draft'
    )
);

CREATE INDEX "announcement_list_idx"
    ON "public"."announcement" ("created_at" DESC)
    WHERE "deleted_at" IS NULL;

ALTER TABLE "public"."announcement" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. ANNOUNCEMENT_DELIVERY -- one row per recipient per channel.
--
--   queued --(claimed by a batch)--> sending --> sent | failed
--   skipped: never attempted (a preference, no contact, a shared phone, no inbox)
--   failed --(retry)--> queued
--
-- The recipient is named by kind and record id (farmer, buyer, officer or
-- staff `user`); a buyer's in-app delivery goes to its organisation's inbox.
-- No phone number, address or message text is stored here.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."announcement_delivery" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "announcement_id"     UUID        NOT NULL,
    "channel"             TEXT        NOT NULL,
    "recipient_kind"      TEXT        NOT NULL,
    "recipient_id"        UUID        NOT NULL,
    -- The sign-in account, for its preferences; NULL for a farmer with none.
    "auth_user_id"        UUID,
    "status"              TEXT        NOT NULL DEFAULT 'queued',
    "skip_reason"         TEXT,
    "provider_message_id" TEXT,
    "error"               TEXT,
    "attempts"            INTEGER     NOT NULL DEFAULT 0,
    "claimed_at"          TIMESTAMPTZ,
    "sent_at"             TIMESTAMPTZ,
    "notification_id"     UUID,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "announcement_delivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_delivery_announcement_id_fkey"
        FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id"),
    CONSTRAINT "announcement_delivery_notification_id_fkey"
        FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id"),
    CONSTRAINT "announcement_delivery_channel_known" CHECK ("channel" IN ('in_app', 'sms', 'email')),
    -- RECIPIENT_KINDS.
    CONSTRAINT "announcement_delivery_recipient_known" CHECK (
        "recipient_kind" IN ('farmer', 'buyer', 'officer', 'staff')
    ),
    -- DELIVERY_STATUSES.
    CONSTRAINT "announcement_delivery_status_known" CHECK (
        "status" IN ('queued', 'sending', 'sent', 'failed', 'skipped')
    ),
    -- DELIVERY_SKIP_REASONS; a reason exactly when skipped.
    CONSTRAINT "announcement_delivery_skip_reason" CHECK (
        ("status" = 'skipped') = ("skip_reason" IS NOT NULL)
        AND ("skip_reason" IS NULL OR "skip_reason" IN (
            'preference', 'no_contact', 'duplicate_contact', 'no_inbox'
        ))
    ),
    CONSTRAINT "announcement_delivery_sent_recorded" CHECK (
        "status" <> 'sent' OR "sent_at" IS NOT NULL
    ),
    CONSTRAINT "announcement_delivery_error_length" CHECK (
        "error" IS NULL OR char_length("error") <= 300
    ),
    CONSTRAINT "announcement_delivery_provider_id_length" CHECK (
        "provider_message_id" IS NULL OR char_length("provider_message_id") <= 200
    ),
    CONSTRAINT "announcement_delivery_attempts_positive" CHECK ("attempts" >= 0)
);

-- One delivery per recipient per channel: a repeated queue is a no-op.
CREATE UNIQUE INDEX "announcement_delivery_once"
    ON "public"."announcement_delivery" ("announcement_id", "channel", "recipient_kind", "recipient_id");
-- The batch worker's claim: the next queued rows of one announcement.
CREATE INDEX "announcement_delivery_status_idx"
    ON "public"."announcement_delivery" ("announcement_id", "status");
-- A person's own announcements list: the in-app deliveries made to them.
CREATE INDEX "announcement_delivery_inbox_idx"
    ON "public"."announcement_delivery" ("recipient_kind", "recipient_id")
    WHERE "channel" = 'in_app' AND "status" = 'sent';

ALTER TABLE "public"."announcement_delivery" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 4. NOTIFICATION_PREFERENCE -- what a person has switched off.
--
-- One row per sign-in account, written only when the person saves; no row
-- means everything is on (DEFAULT_PREFERENCES). Essential and security
-- messages have no column: they cannot be switched off.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."notification_preference" (
    "auth_user_id"          UUID        NOT NULL,
    "announcements_in_app"  BOOLEAN     NOT NULL DEFAULT true,
    "announcements_sms"     BOOLEAN     NOT NULL DEFAULT true,
    "announcements_email"   BOOLEAN     NOT NULL DEFAULT true,
    "updates_in_app"        BOOLEAN     NOT NULL DEFAULT true,
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("auth_user_id")
);

ALTER TABLE "public"."notification_preference" ENABLE ROW LEVEL SECURITY;

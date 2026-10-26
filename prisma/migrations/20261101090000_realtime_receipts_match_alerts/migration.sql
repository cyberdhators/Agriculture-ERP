-- 2026-11-01 (lane-realtime, written 2026-10-26) -- SMS DELIVERY RECEIPTS,
-- SMS OPT-OUTS, MATCH ALERTS AND "SHOW WHEN I'M ACTIVE". docs/DECISIONS.md,
-- "Bird Realtime live updates", "SMS delivery receipts" and "Match alerts".
--
-- ADDITIVE ONLY: three new tables and new columns with defaults on two
-- existing tables. No existing row changes meaning; no column is dropped.
--
-- NO AUDIT CHECK HERE, deliberately (as 20261027110000_communications). New
-- keys sms_receipt.recorded and sms_opt_out.recorded are in AUDIT_ACTIONS; the
-- integrator's combined CHECK migration adds them. Until it is applied the
-- webhook's writes are refused and the route answers 500, so Bird retries the
-- event later (its schedule runs about 27 hours) -- nothing is lost or unlogged.
--
-- NO PHONE NUMBER AND NO MESSAGE TEXT IS STORED in any of these tables.

-- -----------------------------------------------------------------------------
-- 1. ANNOUNCEMENT_DELIVERY -- what the handset's carrier reported.
--   status stays the send outcome ('sent' = Bird accepted it); the receipt is
--   separate, so "sent" and "delivered to phone" are counted side by side.
--   Webhooks are not ordered: a receipt replaces an earlier one only when its
--   event time is not older (receipt_at), which the update statement checks.
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."announcement_delivery"
    ADD COLUMN "receipt_status" TEXT,
    ADD COLUMN "receipt_reason" TEXT,
    ADD COLUMN "receipt_at"     TIMESTAMPTZ;

ALTER TABLE "public"."announcement_delivery"
    ADD CONSTRAINT "announcement_delivery_receipt_known" CHECK (
        "receipt_status" IS NULL OR "receipt_status" IN (
            'delivered', 'undelivered', 'failed', 'rejected', 'expired'
        )
    ),
    ADD CONSTRAINT "announcement_delivery_receipt_recorded" CHECK (
        ("receipt_status" IS NULL) = ("receipt_at" IS NULL)
    ),
    ADD CONSTRAINT "announcement_delivery_receipt_reason_length" CHECK (
        "receipt_reason" IS NULL OR char_length("receipt_reason") <= 120
    );

-- The webhook finds a delivery by Bird's message id.
CREATE INDEX "announcement_delivery_provider_message_idx"
    ON "public"."announcement_delivery" ("provider_message_id")
    WHERE "provider_message_id" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. BIRD_WEBHOOK_EVENT -- one row per webhook-id: the deduplication record.
--   Delivery is at-least-once; a retry or a replay carries the same id and is
--   answered 200 without being applied twice. Type, event time and outcome
--   only: never the payload, a number or a text.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."bird_webhook_event" (
    "webhook_id"  TEXT        NOT NULL,
    "event_type"  TEXT        NOT NULL,
    "event_at"    TIMESTAMPTZ,
    "outcome"     TEXT        NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "bird_webhook_event_pkey" PRIMARY KEY ("webhook_id"),
    CONSTRAINT "bird_webhook_event_id_length" CHECK (char_length("webhook_id") BETWEEN 1 AND 200),
    CONSTRAINT "bird_webhook_event_type_length" CHECK (char_length("event_type") BETWEEN 1 AND 64),
    CONSTRAINT "bird_webhook_event_outcome_length" CHECK (char_length("outcome") BETWEEN 1 AND 40)
);

CREATE INDEX "bird_webhook_event_received_idx"
    ON "public"."bird_webhook_event" ("received_at" DESC);

ALTER TABLE "public"."bird_webhook_event" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. SMS_OPT_OUT -- a person texted STOP, or Bird recorded a suppression.
--   The account it matched (NULL when the number matched no account) and
--   Bird's reference; never the number. The matching accounts' SMS
--   announcement and SMS match-alert switches are turned off in the same
--   transaction; essential messages are not affected.
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."sms_opt_out" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID,
    "source"       TEXT        NOT NULL,
    "provider_ref" TEXT,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sms_opt_out_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sms_opt_out_source_known" CHECK ("source" IN ('keyword_stop', 'suppression')),
    CONSTRAINT "sms_opt_out_provider_ref_length" CHECK (
        "provider_ref" IS NULL OR char_length("provider_ref") <= 200
    )
);

CREATE INDEX "sms_opt_out_account_idx"
    ON "public"."sms_opt_out" ("auth_user_id", "created_at" DESC);

ALTER TABLE "public"."sms_opt_out" ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 4. NOTIFICATION_PREFERENCE -- match alerts, and "show when I'm active".
--   match_in_app: on by default. match_sms: OFF by default (marketing SMS is
--   opt-in). show_activity: on by default, and reciprocal -- an account that
--   hides its own activity sees nobody else's (lib/api/presence.ts).
-- -----------------------------------------------------------------------------
ALTER TABLE "public"."notification_preference"
    ADD COLUMN "match_in_app"  BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "match_sms"     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "show_activity" BOOLEAN NOT NULL DEFAULT true;

-- -----------------------------------------------------------------------------
-- 5. MARKETING_NOTICE -- one match alert sent to one account about one post.
--   The unique key makes a post alert a person at most once however often it
--   is saved; the index serves the cap (MATCH_ALERT_DAILY_CAP per 24 hours).
-- -----------------------------------------------------------------------------
CREATE TABLE "public"."marketing_notice" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"    UUID        NOT NULL,
    "kind"            TEXT        NOT NULL DEFAULT 'match',
    "post_kind"       TEXT        NOT NULL,
    "post_id"         UUID        NOT NULL,
    "notification_id" UUID,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "marketing_notice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_notice_notification_id_fkey"
        FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id"),
    CONSTRAINT "marketing_notice_kind_known" CHECK ("kind" IN ('match')),
    CONSTRAINT "marketing_notice_post_kind_known" CHECK ("post_kind" IN ('buying_request', 'listing'))
);

CREATE UNIQUE INDEX "marketing_notice_once"
    ON "public"."marketing_notice" ("auth_user_id", "post_kind", "post_id");
CREATE INDEX "marketing_notice_recent_idx"
    ON "public"."marketing_notice" ("auth_user_id", "created_at" DESC);

ALTER TABLE "public"."marketing_notice" ENABLE ROW LEVEL SECURITY;

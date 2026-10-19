-- 2026-10-20 -- in-app messaging (CORWADO's 16 October specification:
-- "Protect private contacts through in-app messaging and deliberate public
-- contact choices"). The owner's decision: a conversation is always about a
-- post -- a listing, a buying request or a service -- between the post's owner
-- and one other account. No cold messages.
--
-- ADDITIVE: two tables, and the audit CHECK rebuilt with every key of
-- 20261019110100 (85) plus conversation.started, message.sent and
-- conversation.blocked (88). Any later CHECK migration starts from this list.
--
-- PARTICIPANTS ARE SIGN-INS (auth users), not farmer or buyer records: one
-- account buys and sells (#178), so one inbox holds both sides' chats. Staff
-- have no read path: private conversations are not a staff resource; problems
-- reach staff through reports.
--
-- A MESSAGE'S ID IS MADE ON THE PHONE, so a message written offline and sent
-- twice is stored once (the offline-sync law). Message text never enters the
-- audit log or a notification -- audit rows carry ids only.

CREATE TABLE "public"."conversation" (
    "id"                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    "post_kind"                TEXT        NOT NULL,
    "post_id"                  UUID        NOT NULL,
    -- Kept as it was when the chat began, so a renamed or removed post still
    -- reads sensibly in the inbox.
    "post_title"               TEXT        NOT NULL,
    "owner_auth_user_id"       UUID        NOT NULL,
    "owner_name"               TEXT        NOT NULL,
    "starter_auth_user_id"     UUID        NOT NULL,
    "starter_name"             TEXT        NOT NULL,
    "last_message_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_sender_auth_user_id" UUID,
    "owner_read_at"            TIMESTAMPTZ,
    "starter_read_at"          TIMESTAMPTZ,
    "blocked_at"               TIMESTAMPTZ,
    "blocked_by"               UUID,
    "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_post_kind" CHECK ("post_kind" IN ('listing', 'buying_request', 'service')),
    CONSTRAINT "conversation_two_people" CHECK ("owner_auth_user_id" <> "starter_auth_user_id"),
    CONSTRAINT "conversation_blocker_is_participant" CHECK (
        "blocked_by" IS NULL OR "blocked_by" IN ("owner_auth_user_id", "starter_auth_user_id")
    ),
    -- One conversation per post per other person: asking again reopens it.
    CONSTRAINT "conversation_one_per_post_and_starter" UNIQUE ("post_kind", "post_id", "starter_auth_user_id")
);

CREATE INDEX "conversation_owner_idx" ON "public"."conversation" ("owner_auth_user_id", "last_message_at" DESC);
CREATE INDEX "conversation_starter_idx" ON "public"."conversation" ("starter_auth_user_id", "last_message_at" DESC);

CREATE TABLE "public"."message" (
    "id"                  UUID        NOT NULL,
    "conversation_id"     UUID        NOT NULL,
    "sender_auth_user_id" UUID        NOT NULL,
    "body"                TEXT        NOT NULL,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"          TIMESTAMPTZ,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_conversation_id_fkey"
        FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id"),
    CONSTRAINT "message_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000)
);

CREATE INDEX "message_conversation_created_idx" ON "public"."message" ("conversation_id", "created_at");

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."message" ENABLE ROW LEVEL SECURITY;

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
        'learning_resource.soft_deleted',
        'product_report.created',
        'product_report.listing_removed',
        'product_report.status_changed',
        'communication.email_sent',
        'communication.send_failed',
        'weather_location.created',
        'weather_location.updated',
        'weather_location.soft_deleted',
        'listing.created',
        'listing.updated',
        'listing.status_changed',
        'listing.soft_deleted',
        'contact_request.created',
        'contact_request.handled',
        'market_price.created',
        'market_price.soft_deleted',
        'notification.created',
        'notification.read',
        'buyer.registered',
        'buyer.updated',
        'buyer_organization.updated',
        'buyer_organization.verification_changed',
        'purchase_request.created',
        'purchase_request.updated',
        'purchase_request.submitted',
        'purchase_request.cancelled',
        'purchase_request.decided',
        'purchase_order.created',
        'purchase_order.status_changed',
        'purchase_order.cancelled',
        'communication.sms_sent',
        'account.profile_updated',
        'staff.permission_granted',
        'staff.permission_revoked',
        'superadmin.granted',
        'superadmin.revoked',
        'staff.sessions_revoked',
        'staff.sessions_revoke_failed',
        'conversation.started',
        'message.sent',
        'conversation.blocked'
    ));

-- 2026-10-21 -- "Contact CORWADO". The owner's choice: a help page with FAQs
-- and a short message form; staff see the messages in a list and mark them
-- done. No tickets, no assignment, no replies, no SLAs -- helpdesk ticketing
-- stays out of scope (CLAUDE.md section 2).
--
-- ADDITIVE: one table, and the audit CHECK rebuilt with every key of
-- 20261020150000 (89) plus account.suspended and account.restored (added by
-- the concurrent 20261021090000_account_suspension, included here so this
-- rebuild cannot drop them whichever lands first) plus support_message.created
-- and support_message.done (93). Any later CHECK migration starts from this list.
--
-- WHO SENT IT: a signed-in farmer or buyer is recorded by sign-in id; anyone
-- else is a visitor and must leave a phone or an email, or nobody can answer.
-- `source_digest` is a ONE-WAY hash of the submitting connection, kept only to
-- count a visitor's messages per day; it identifies nobody, is never returned
-- and never audited. Message text never enters the audit log.

CREATE TABLE "public"."support_message" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "from_auth_user_id" UUID,
    "from_kind"         TEXT        NOT NULL,
    "name"              TEXT        NOT NULL,
    "phone"             TEXT,
    "email"             TEXT,
    "topic"             TEXT        NOT NULL,
    "body"              TEXT        NOT NULL,
    "status"            TEXT        NOT NULL DEFAULT 'new',
    "source_digest"     TEXT,
    "handled_by"        UUID,
    "handled_at"        TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"        TIMESTAMPTZ,

    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_message_handled_by_fkey"
        FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "support_message_from_kind" CHECK ("from_kind" IN ('farmer', 'buyer', 'visitor')),
    -- A visitor has no sign-in; a farmer or buyer always has one.
    CONSTRAINT "support_message_sender_matches_kind" CHECK (
        ("from_kind" = 'visitor') = ("from_auth_user_id" IS NULL)
    ),
    -- A visitor must be reachable, or the message cannot be answered.
    CONSTRAINT "support_message_visitor_contact" CHECK (
        "from_kind" <> 'visitor' OR "phone" IS NOT NULL OR "email" IS NOT NULL
    ),
    CONSTRAINT "support_message_name_length" CHECK (char_length("name") BETWEEN 2 AND 120),
    CONSTRAINT "support_message_topic" CHECK (
        "topic" IN ('account', 'marketplace', 'messages', 'technical', 'other')
    ),
    CONSTRAINT "support_message_body_length" CHECK (char_length("body") BETWEEN 10 AND 2000),
    CONSTRAINT "support_message_status" CHECK ("status" IN ('new', 'done')),
    -- Done always says by whom and when; new never does.
    CONSTRAINT "support_message_done_is_handled" CHECK (
        ("status" = 'done') = ("handled_at" IS NOT NULL AND "handled_by" IS NOT NULL)
    )
);

CREATE INDEX "support_message_status_created_idx"
    ON "public"."support_message" ("status", "created_at" DESC);

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."support_message" ENABLE ROW LEVEL SECURITY;

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
        'conversation.blocked',
        'buyer.soft_deleted',
        'account.suspended',
        'account.restored',
        'support_message.created',
        'support_message.done'
    ));

-- 2026-10-19 -- "who you are, what you do" (CORWADO's 16 October
-- specification): an account's profile kind and its activities, chosen in an
-- optional setup step that can be skipped and edited later. They personalise
-- shortcuts and never restrict what the account may do.
--
-- ADDITIVE: one table keyed by the sign-in (one account, buying and selling),
-- and the audit CHECK rebuilt with every existing key plus
-- `account.profile_updated` (a CHECK can only be replaced, never extended).

CREATE TABLE "public"."account_profile" (
    "auth_user_id" UUID        NOT NULL,
    "profile_kind" TEXT        NOT NULL DEFAULT 'individual',
    "group_kind"   TEXT,
    "activities"   TEXT[]      NOT NULL DEFAULT '{}',
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "account_profile_pkey" PRIMARY KEY ("auth_user_id"),
    CONSTRAINT "account_profile_kind" CHECK
        ("profile_kind" IN ('individual', 'group', 'business', 'institution')),
    -- A group says what kind of group; nothing else may carry a group kind.
    CONSTRAINT "account_profile_group_kind" CHECK (
        ("profile_kind" = 'group') = ("group_kind" IS NOT NULL)
        AND ("group_kind" IS NULL OR "group_kind" IN
             ('producer_group', 'cooperative', 'vsla', 'sacco', 'other_association'))
    ),
    CONSTRAINT "account_profile_activities" CHECK ("activities" <@ ARRAY[
        'farmer', 'trader', 'processor', 'input_supplier', 'transport',
        'other_services', 'knowledge_provider', 'financial_services', 'buyer'
    ]::TEXT[])
);

ALTER TABLE "public"."account_profile" ENABLE ROW LEVEL SECURITY;

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
        'account.profile_updated'
    ));

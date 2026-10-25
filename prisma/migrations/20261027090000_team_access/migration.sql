-- Migration 20261027090000 -- organisational profiles and team access
-- (CORWADO's 16 October specification, "Organizational continuity"; the
-- demonstrations "Team access", "Independent institution" and "Deletion").
-- docs/DECISIONS.md, "Organisational profiles and team access (2026-10-27)".
--
-- WHAT IT ADDS
--   organization             an organisational profile any account may create
--                            (group, business or institution). Separate from
--                            buyer_organization, which stays a buyer's own
--                            procurement record with staff verification.
--   organization_member      one person's access to one organisation: a preset
--                            (administrator, contributor, viewer) and granular
--                            permissions. Revocation ends the row, never
--                            removes it: the history stays.
--   organization_invitation  an expiring invitation to a phone or an email
--                            (kind 'member'), or an offer of administration to
--                            an existing member (kind 'transfer'). Only a hash
--                            of the invitation token is stored.
--   organization_id          on buying_request and service_listing: the post
--                            was made for an organisation (the person acting
--                            stays in farmer_id / buyer_id and in the audit).
--   owner_/starter_organization_id, last_sender_side on conversation and
--   sender_side on message: a conversation side may be an organisation's
--   shared inbox; the person who wrote stays in sender_auth_user_id.
--
-- ADDITIVE. Three tables; nullable columns; two views re-created with
-- CREATE OR REPLACE (a SELECT * view freezes its columns, so the new ones are
-- appended). One constraint is REPLACED, not dropped: the conversation's
-- one-per-post-and-starter unique becomes two partial unique indexes, the
-- personal one with exactly the old meaning for every existing row (all have
-- starter_organization_id NULL) and one per post and starting organisation.
-- Correct on an empty database and on a populated one: no backfill is needed
-- because every existing row is personal (NULL organisation).
--
-- RLS is enabled on every new table with no policies (deny by default); every
-- read and write goes through an API route. No audit CHECK here: the new keys
-- are listed in the lane's report and the integrator rebuilds the CHECK.

CREATE TABLE "public"."organization" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"          TEXT        NOT NULL,
    "profile_kind"  TEXT        NOT NULL,
    "group_kind"    TEXT,
    "activities"    TEXT[]      NOT NULL DEFAULT '{}',
    "about"         TEXT,
    "state_id"      TEXT,
    "location"      TEXT,
    -- Public contacts are the organisation's own and shown only when given.
    "public_phone"  TEXT,
    "public_email"  TEXT,
    -- Whether the public profile lists team members at all; each member must
    -- also agree (organization_member.show_on_profile).
    "show_team"     BOOLEAN     NOT NULL DEFAULT false,
    "status"        TEXT        NOT NULL DEFAULT 'draft',
    "published_at"  TIMESTAMPTZ,
    "closed_at"     TIMESTAMPTZ,
    "closed_by"     UUID,
    "closed_reason" TEXT,
    "created_by"    UUID        NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"    TIMESTAMPTZ,
    "deleted_by"    UUID,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "organization_name_length" CHECK (char_length("name") BETWEEN 2 AND 120),
    CONSTRAINT "organization_kind_known"
        CHECK ("profile_kind" IN ('group', 'business', 'institution')),
    CONSTRAINT "organization_group_kind" CHECK (
        ("profile_kind" = 'group') = ("group_kind" IS NOT NULL)
        AND ("group_kind" IS NULL OR "group_kind" IN
            ('producer_group', 'cooperative', 'vsla', 'sacco', 'other_association'))
    ),
    CONSTRAINT "organization_activities_known" CHECK ("activities" <@ ARRAY[
        'farmer', 'trader', 'processor', 'input_supplier', 'transport', 'other_services',
        'knowledge_provider', 'financial_services', 'buyer']::TEXT[]),
    CONSTRAINT "organization_status_known" CHECK ("status" IN ('draft', 'published')),
    CONSTRAINT "organization_closed_pair" CHECK (("closed_at" IS NULL) = ("closed_by" IS NULL))
);

CREATE INDEX "organization_status_idx" ON "public"."organization" ("status", "updated_at" DESC)
    WHERE "deleted_at" IS NULL;

CREATE TABLE "public"."organization_member" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID        NOT NULL,
    "auth_user_id"    UUID        NOT NULL,
    "preset"          TEXT        NOT NULL,
    "permissions"     TEXT[]      NOT NULL DEFAULT '{}',
    "status"          TEXT        NOT NULL DEFAULT 'active',
    -- The person's own agreement to appear on the public profile.
    "show_on_profile" BOOLEAN     NOT NULL DEFAULT false,
    "public_title"    TEXT,
    "invitation_id"   UUID,
    "invited_by"      UUID,
    "joined_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "ended_at"        TIMESTAMPTZ,
    "ended_by"        UUID,
    "end_reason"      TEXT,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "organization_member_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_member_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id"),
    CONSTRAINT "organization_member_preset_known"
        CHECK ("preset" IN ('administrator', 'contributor', 'viewer')),
    CONSTRAINT "organization_member_status_known"
        CHECK ("status" IN ('active', 'revoked', 'left')),
    CONSTRAINT "organization_member_permissions_known" CHECK ("permissions" <@ ARRAY[
        'profile.edit', 'listings.manage', 'inbox.read', 'inbox.reply', 'advisory.handle',
        'team.manage']::TEXT[]),
    -- Team management is the administrator's, and only the administrator's.
    CONSTRAINT "organization_member_team_is_admin"
        CHECK (("preset" = 'administrator') = ('team.manage' = ANY ("permissions"))),
    CONSTRAINT "organization_member_ended"
        CHECK (("status" = 'active') = ("ended_at" IS NULL))
);

-- One live membership per person per organisation; ended rows are history.
CREATE UNIQUE INDEX "organization_member_one_active"
    ON "public"."organization_member" ("organization_id", "auth_user_id")
    WHERE "status" = 'active';
CREATE INDEX "organization_member_person_idx"
    ON "public"."organization_member" ("auth_user_id") WHERE "status" = 'active';

CREATE TABLE "public"."organization_invitation" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"      UUID        NOT NULL,
    "kind"                 TEXT        NOT NULL DEFAULT 'member',
    "channel"              TEXT,
    -- A normalised +211 number or a lower-case email address.
    "target"               TEXT,
    "target_member_id"     UUID,
    "preset"               TEXT        NOT NULL,
    "permissions"          TEXT[]      NOT NULL DEFAULT '{}',
    -- Transfer only: what the offering administrator becomes on acceptance.
    "sender_after"         TEXT,
    "token_hash"           TEXT,
    "expires_at"           TIMESTAMPTZ NOT NULL,
    "status"               TEXT        NOT NULL DEFAULT 'pending',
    "delivery"             TEXT        NOT NULL DEFAULT 'link_only',
    "invited_by"           UUID        NOT NULL,
    "invited_by_member_id" UUID        NOT NULL,
    "responded_by"         UUID,
    "responded_at"         TIMESTAMPTZ,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "organization_invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_invitation_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id"),
    CONSTRAINT "organization_invitation_target_member_id_fkey"
        FOREIGN KEY ("target_member_id") REFERENCES "public"."organization_member"("id"),
    CONSTRAINT "organization_invitation_invited_by_member_id_fkey"
        FOREIGN KEY ("invited_by_member_id") REFERENCES "public"."organization_member"("id"),
    CONSTRAINT "organization_invitation_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "organization_invitation_kind_known" CHECK ("kind" IN ('member', 'transfer')),
    CONSTRAINT "organization_invitation_shape" CHECK (
        ("kind" = 'member' AND "channel" IN ('phone', 'email') AND "target" IS NOT NULL
            AND "token_hash" IS NOT NULL AND "target_member_id" IS NULL AND "sender_after" IS NULL)
        OR
        ("kind" = 'transfer' AND "target_member_id" IS NOT NULL AND "channel" IS NULL
            AND "target" IS NULL AND "token_hash" IS NULL
            AND "preset" = 'administrator'
            AND "sender_after" IN ('administrator', 'contributor', 'viewer', 'leave'))
    ),
    CONSTRAINT "organization_invitation_preset_known"
        CHECK ("preset" IN ('administrator', 'contributor', 'viewer')),
    CONSTRAINT "organization_invitation_permissions_known" CHECK ("permissions" <@ ARRAY[
        'profile.edit', 'listings.manage', 'inbox.read', 'inbox.reply', 'advisory.handle',
        'team.manage']::TEXT[]),
    CONSTRAINT "organization_invitation_status_known"
        CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled')),
    CONSTRAINT "organization_invitation_delivery_known"
        CHECK ("delivery" IN ('link_only', 'sms_sent', 'email_sent', 'send_failed', 'in_app'))
);

CREATE INDEX "organization_invitation_org_idx"
    ON "public"."organization_invitation" ("organization_id", "created_at" DESC);
CREATE INDEX "organization_invitation_target_idx"
    ON "public"."organization_invitation" ("target") WHERE "status" = 'pending';

ALTER TABLE "public"."organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organization_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organization_invitation" ENABLE ROW LEVEL SECURITY;

-- Posts made for an organisation.
ALTER TABLE "public"."buying_request" ADD COLUMN "organization_id" UUID;
ALTER TABLE "public"."buying_request"
    ADD CONSTRAINT "buying_request_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id");
CREATE INDEX "buying_request_organization_idx"
    ON "public"."buying_request" ("organization_id", "updated_at" DESC)
    WHERE "organization_id" IS NOT NULL;

ALTER TABLE "public"."service_listing" ADD COLUMN "organization_id" UUID;
ALTER TABLE "public"."service_listing"
    ADD CONSTRAINT "service_listing_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id");
CREATE INDEX "service_listing_organization_idx"
    ON "public"."service_listing" ("organization_id", "updated_at" DESC)
    WHERE "organization_id" IS NOT NULL;

CREATE OR REPLACE VIEW "public"."buying_request_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."buying_request" WHERE "deleted_at" IS NULL;
CREATE OR REPLACE VIEW "public"."service_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."service_listing" WHERE "deleted_at" IS NULL;

-- Conversations: a side may be an organisation's shared inbox.
ALTER TABLE "public"."conversation" ADD COLUMN "owner_organization_id" UUID;
ALTER TABLE "public"."conversation" ADD COLUMN "starter_organization_id" UUID;
ALTER TABLE "public"."conversation" ADD COLUMN "last_sender_side" TEXT;
ALTER TABLE "public"."conversation"
    ADD CONSTRAINT "conversation_owner_organization_id_fkey"
        FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organization"("id");
ALTER TABLE "public"."conversation"
    ADD CONSTRAINT "conversation_starter_organization_id_fkey"
        FOREIGN KEY ("starter_organization_id") REFERENCES "public"."organization"("id");
ALTER TABLE "public"."conversation"
    ADD CONSTRAINT "conversation_last_sender_side_known"
        CHECK ("last_sender_side" IS NULL OR "last_sender_side" IN ('owner', 'starter'));
ALTER TABLE "public"."conversation"
    ADD CONSTRAINT "conversation_two_sides" CHECK (
        "owner_organization_id" IS NULL OR "starter_organization_id" IS NULL
        OR "owner_organization_id" <> "starter_organization_id"
    );

-- The replaced unique: the personal form keeps its exact old meaning.
ALTER TABLE "public"."conversation" DROP CONSTRAINT "conversation_one_per_post_and_starter";
CREATE UNIQUE INDEX "conversation_one_per_post_and_starter"
    ON "public"."conversation" ("post_kind", "post_id", "starter_auth_user_id")
    WHERE "starter_organization_id" IS NULL;
CREATE UNIQUE INDEX "conversation_one_per_post_and_starter_org"
    ON "public"."conversation" ("post_kind", "post_id", "starter_organization_id")
    WHERE "starter_organization_id" IS NOT NULL;
CREATE INDEX "conversation_owner_org_idx"
    ON "public"."conversation" ("owner_organization_id", "last_message_at" DESC)
    WHERE "owner_organization_id" IS NOT NULL;
CREATE INDEX "conversation_starter_org_idx"
    ON "public"."conversation" ("starter_organization_id", "last_message_at" DESC)
    WHERE "starter_organization_id" IS NOT NULL;

ALTER TABLE "public"."message" ADD COLUMN "sender_side" TEXT;
ALTER TABLE "public"."message"
    ADD CONSTRAINT "message_sender_side_known"
        CHECK ("sender_side" IS NULL OR "sender_side" IN ('owner', 'starter'));

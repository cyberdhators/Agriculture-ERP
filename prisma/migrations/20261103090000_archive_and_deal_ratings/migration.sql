-- 2026-11-03 (lane-trust) -- "ARCHIVE FOR ME" AND RATINGS AFTER A COMPLETED
-- DEAL. docs/DECISIONS.md, "Archive for me replaces Close conversation" and
-- "Ratings after a completed deal". Both approved by the owner.
--
-- ADDITIVE ONLY. Two nullable columns on public.conversation, one new table,
-- and one widened CHECK (a new allowed value; every existing row still
-- passes). No existing row is changed: a conversation closed before today
-- keeps its blocked_at and stays closed. No view selects from conversation
-- or notification, so none is recreated.
--
-- THE AUDIT KEYS this work writes (conversation.archived,
-- conversation.unarchived, rating.created, rating.reported, rating.hidden,
-- rating.restored, rating.report_dismissed) are NOT added to the audit CHECK
-- here: the integrator's combined CHECK migration adds them.

-- 1. ARCHIVE FOR ME: one mark per side. For an organisation's shared inbox the
--    side is the organisation's. A new message clears both (the application,
--    lib/api/messaging.ts insertMessage).
ALTER TABLE "public"."conversation"
    ADD COLUMN "owner_archived_at"   TIMESTAMPTZ,
    ADD COLUMN "starter_archived_at" TIMESTAMPTZ;

-- 2. RATINGS. One row per side per completed deal.
--    deal_kind 'purchase_order': deal_id is a purchase_order (sides buyer, seller).
--    deal_kind 'conversation':   deal_id is a conversation about a completed
--                                post in which both sides wrote (sides owner, starter).
--    The rated party is a person (ratee_auth_user_id) or an organisation
--    (ratee_organization_id), never both. The rater's name is NOT stored: it is
--    read when shown, from what the rater shows publicly (packages/shared/src/ratings.ts).
CREATE TABLE "public"."deal_rating" (
    "id"                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    "deal_kind"             TEXT        NOT NULL,
    "deal_id"               UUID        NOT NULL,
    "rater_side"            TEXT        NOT NULL,
    -- The person who wrote it, and the organisation they wrote for (if any).
    "rater_auth_user_id"    UUID        NOT NULL,
    "rater_organization_id" UUID,
    "ratee_auth_user_id"    UUID,
    "ratee_organization_id" UUID,
    "stars"                 SMALLINT    NOT NULL,
    "comment"               TEXT,
    -- When the deal completed, as read when the rating was given.
    "completed_at"          TIMESTAMPTZ NOT NULL,
    -- The rated party's report: once, a product-report reason and a note.
    "reported_at"           TIMESTAMPTZ,
    "report_reason"         "public"."report_reason",
    "report_note"           TEXT,
    -- A moderator's decision (content.moderate), always with a reason.
    "hidden_at"             TIMESTAMPTZ,
    "hidden_by"             UUID,
    "hidden_reason"         TEXT,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"            TIMESTAMPTZ,
    "deleted_by"            UUID,

    CONSTRAINT "deal_rating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_rating_deal_kind" CHECK ("deal_kind" IN ('purchase_order', 'conversation')),
    CONSTRAINT "deal_rating_side" CHECK (
        ("deal_kind" = 'purchase_order' AND "rater_side" IN ('buyer', 'seller'))
        OR ("deal_kind" = 'conversation' AND "rater_side" IN ('owner', 'starter'))
    ),
    CONSTRAINT "deal_rating_one_ratee" CHECK (
        ("ratee_auth_user_id" IS NULL) <> ("ratee_organization_id" IS NULL)
    ),
    CONSTRAINT "deal_rating_not_self" CHECK (
        "ratee_auth_user_id" IS NULL OR "ratee_auth_user_id" <> "rater_auth_user_id"
    ),
    CONSTRAINT "deal_rating_stars" CHECK ("stars" BETWEEN 1 AND 5),
    CONSTRAINT "deal_rating_comment_length" CHECK (
        "comment" IS NULL OR char_length("comment") BETWEEN 1 AND 300
    ),
    CONSTRAINT "deal_rating_report_whole" CHECK (
        ("reported_at" IS NULL) = ("report_reason" IS NULL)
    ),
    CONSTRAINT "deal_rating_report_note_length" CHECK (
        "report_note" IS NULL OR char_length("report_note") <= 500
    ),
    CONSTRAINT "deal_rating_hidden_with_reason" CHECK (
        ("hidden_at" IS NULL) = ("hidden_reason" IS NULL)
        AND ("hidden_at" IS NULL) = ("hidden_by" IS NULL)
    ),
    CONSTRAINT "deal_rating_hidden_reason_length" CHECK (
        "hidden_reason" IS NULL OR char_length("hidden_reason") BETWEEN 1 AND 500
    ),
    CONSTRAINT "deal_rating_rater_organization_id_fkey"
        FOREIGN KEY ("rater_organization_id") REFERENCES "public"."organization"("id"),
    CONSTRAINT "deal_rating_ratee_organization_id_fkey"
        FOREIGN KEY ("ratee_organization_id") REFERENCES "public"."organization"("id"),
    CONSTRAINT "deal_rating_hidden_by_fkey"
        FOREIGN KEY ("hidden_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "deal_rating_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    -- ONCE: one rating per side of a deal.
    CONSTRAINT "deal_rating_once_per_side" UNIQUE ("deal_kind", "deal_id", "rater_side")
);

CREATE INDEX "deal_rating_ratee_person_idx"
    ON "public"."deal_rating" ("ratee_auth_user_id", "created_at" DESC)
    WHERE "ratee_auth_user_id" IS NOT NULL;
CREATE INDEX "deal_rating_ratee_organization_idx"
    ON "public"."deal_rating" ("ratee_organization_id", "created_at" DESC)
    WHERE "ratee_organization_id" IS NOT NULL;
CREATE INDEX "deal_rating_reported_idx"
    ON "public"."deal_rating" ("reported_at" DESC)
    WHERE "reported_at" IS NOT NULL;

-- Deny by default: every read and write goes through the API routes.
ALTER TABLE "public"."deal_rating" ENABLE ROW LEVEL SECURITY;

-- 3. A stored notice may point at a rating ("You received a new rating" opens
--    the Ratings tab). The kinds are NOTICE_REF_KINDS in packages/shared/src/realtime.ts.
ALTER TABLE "public"."notification" DROP CONSTRAINT "notification_ref_kind_known";
ALTER TABLE "public"."notification"
    ADD CONSTRAINT "notification_ref_kind_known" CHECK (
        "ref_kind" IS NULL OR "ref_kind" IN ('buying_request', 'listing', 'conversation', 'rating')
    );

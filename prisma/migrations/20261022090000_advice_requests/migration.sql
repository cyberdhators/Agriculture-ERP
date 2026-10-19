-- 2026-10-22 -- independent advice, part 1: find a provider and ask (CORWADO's
-- 16 October specification, "Independent knowledge providers" and "Support
-- and advisory outcomes"). docs/DECISIONS.md, "Advice: find a provider and ask".
--
-- ADDITIVE: two tables, and the conversation table's post_kind CHECK widened
-- by one value ('advice_case'). Dropping and re-adding a CHECK with a superset
-- of its values cannot fail on, or change, any existing row.
--
-- NO AUDIT CHECK HERE, deliberately. This change adds five audit keys
-- (advice_provider.saved, advice_case.created, advice_case.status_changed,
-- advice_case.closed, advice_case.feedback) to AUDIT_ACTIONS; three branches
-- touch audit_event_action_known at once, so one combined CHECK migration is
-- written when they meet. Until it is applied the database refuses these keys,
-- which is why it must be applied with this one.
--
-- PARTICIPANTS ARE SIGN-INS (auth users), as in messaging: one account buys
-- and sells (#178), so the same account may ask for advice and give it. Staff
-- have no read path to a case: a question is private to the two people in it.

-- A provider's public advice profile: one per account, published by its owner
-- with no review (public visibility is not endorsement). The "approved
-- adviser" pathway, when it comes, adds its own columns or table beside this;
-- nothing here assumes there is no such thing.
CREATE TABLE "public"."advice_provider" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id"         UUID        NOT NULL,
    "display_name"         TEXT        NOT NULL,
    "provider_kind"        TEXT        NOT NULL,
    "description"          TEXT        NOT NULL,
    "topics"               TEXT[]      NOT NULL,
    "languages"            TEXT[]      NOT NULL,
    -- The states served; empty means anywhere.
    "state_ids"            TEXT[]      NOT NULL DEFAULT '{}',
    "delivery_modes"       TEXT[]      NOT NULL,
    "availability"         TEXT,
    -- Words, never a payment: payments are out of scope.
    "terms"                TEXT        NOT NULL,
    "fee_note"             TEXT,
    -- Disclosed in the provider's own words, e.g. "I sell seed".
    "commercial_interests" TEXT,
    "status"               TEXT        NOT NULL DEFAULT 'draft',
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"           TIMESTAMPTZ,

    CONSTRAINT "advice_provider_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "advice_provider_one_per_account" UNIQUE ("auth_user_id"),
    CONSTRAINT "advice_provider_display_name_length" CHECK (char_length("display_name") BETWEEN 2 AND 120),
    CONSTRAINT "advice_provider_kind_known" CHECK ("provider_kind" IN (
        'independent_adviser', 'institute', 'research_training', 'advisory_organization', 'other'
    )),
    CONSTRAINT "advice_provider_description_length" CHECK (char_length("description") BETWEEN 10 AND 2000),
    -- ADVICE_TOPICS in packages/shared/src/advice-topics.ts.
    CONSTRAINT "advice_provider_topics_known" CHECK (
        cardinality("topics") > 0 AND "topics" <@ ARRAY[
            'crops', 'livestock', 'soil_fertiliser', 'pests_diseases', 'water_irrigation',
            'post_harvest', 'marketing_prices', 'finance_business', 'climate_weather', 'other'
        ]::TEXT[]
    ),
    CONSTRAINT "advice_provider_languages_known" CHECK (
        cardinality("languages") > 0 AND "languages" <@ ARRAY[
            'en', 'ar', 'juba_arabic', 'dinka', 'nuer', 'bari', 'other'
        ]::TEXT[]
    ),
    CONSTRAINT "advice_provider_delivery_known" CHECK (
        cardinality("delivery_modes") > 0 AND "delivery_modes" <@ ARRAY['remote', 'in_person']::TEXT[]
    ),
    CONSTRAINT "advice_provider_availability_length" CHECK (
        "availability" IS NULL OR char_length("availability") <= 300
    ),
    CONSTRAINT "advice_provider_terms_known" CHECK ("terms" IN ('free', 'paid', 'free_and_paid')),
    CONSTRAINT "advice_provider_fee_note_length" CHECK (
        "fee_note" IS NULL OR char_length("fee_note") <= 300
    ),
    CONSTRAINT "advice_provider_commercial_length" CHECK (
        "commercial_interests" IS NULL OR char_length("commercial_interests") <= 500
    ),
    CONSTRAINT "advice_provider_status_known" CHECK ("status" IN ('draft', 'published', 'unpublished'))
);

-- The directory reads published profiles, most recently updated first; the
-- topic and language filters are array containment.
CREATE INDEX "advice_provider_published_idx" ON "public"."advice_provider" ("updated_at" DESC, "id" DESC)
    WHERE "status" = 'published' AND "deleted_at" IS NULL;
CREATE INDEX "advice_provider_topics_idx" ON "public"."advice_provider" USING GIN ("topics");

-- One person's question to the provider they chose. The id is made on the
-- phone, so a request sent twice is stored once. Its conversation is a row in
-- public.conversation with post_kind 'advice_case' and post_id = this id.
CREATE TABLE "public"."advice_case" (
    "id"                     UUID        NOT NULL,
    "provider_id"            UUID        NOT NULL,
    "requester_auth_user_id" UUID        NOT NULL,
    -- "Mary K.", as the provider sees the requester; never a phone.
    "requester_name"         TEXT        NOT NULL,
    "topic"                  TEXT        NOT NULL,
    "question"               TEXT        NOT NULL,
    "preferred_contact"      TEXT        NOT NULL DEFAULT 'in_app',
    -- Off unless the requester ticks it.
    "share_details"          BOOLEAN     NOT NULL DEFAULT false,
    "status"                 TEXT        NOT NULL DEFAULT 'open',
    "outcome"                TEXT,
    "closed_at"              TIMESTAMPTZ,
    "closed_by"              UUID,
    "feedback_rating"        SMALLINT,
    "feedback_comment"       TEXT,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"             TIMESTAMPTZ,

    CONSTRAINT "advice_case_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "advice_case_provider_id_fkey"
        FOREIGN KEY ("provider_id") REFERENCES "public"."advice_provider"("id"),
    CONSTRAINT "advice_case_topic_known" CHECK ("topic" IN (
        'crops', 'livestock', 'soil_fertiliser', 'pests_diseases', 'water_irrigation',
        'post_harvest', 'marketing_prices', 'finance_business', 'climate_weather', 'other'
    )),
    CONSTRAINT "advice_case_question_length" CHECK (char_length("question") BETWEEN 10 AND 2000),
    CONSTRAINT "advice_case_contact_known" CHECK ("preferred_contact" IN ('in_app', 'phone', 'sms')),
    CONSTRAINT "advice_case_status_known" CHECK ("status" IN ('open', 'in_progress', 'closed')),
    CONSTRAINT "advice_case_outcome_known" CHECK (
        "outcome" IS NULL OR "outcome" IN ('resolved', 'referred', 'closed_unresolved', 'cancelled')
    ),
    -- A closed case has an outcome, and only a closed case has one.
    CONSTRAINT "advice_case_closed_has_outcome" CHECK (("status" = 'closed') = ("outcome" IS NOT NULL)),
    CONSTRAINT "advice_case_feedback_rating_range" CHECK (
        "feedback_rating" IS NULL OR "feedback_rating" BETWEEN 1 AND 5
    ),
    CONSTRAINT "advice_case_feedback_comment_length" CHECK (
        "feedback_comment" IS NULL OR char_length("feedback_comment") <= 1000
    )
    -- That the requester is not the provider's own account is checked by the
    -- route (the provider's account lives on the other table).
);

CREATE INDEX "advice_case_provider_idx" ON "public"."advice_case" ("provider_id", "status", "created_at" DESC);
CREATE INDEX "advice_case_requester_idx" ON "public"."advice_case" ("requester_auth_user_id", "created_at" DESC);

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."advice_provider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."advice_case" ENABLE ROW LEVEL SECURITY;

-- Each case's conversation reuses in-app messaging. The new value is created
-- only by POST /api/advice/cases; POST /api/conversations still accepts the
-- three post kinds alone.
ALTER TABLE "public"."conversation"
    DROP CONSTRAINT "conversation_post_kind";

ALTER TABLE "public"."conversation"
    ADD CONSTRAINT "conversation_post_kind" CHECK ("post_kind" IN ('listing', 'buying_request', 'service', 'advice_case'));

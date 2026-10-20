-- 2026-10-22 -- Advice & Learning: draft, review, publish (CORWADO's 16 October
-- specification: "Advice and Learning: Draft, review and publication
-- workflow; translations, media, topics and advisory requests. Publishing
-- authority is separately assignable." and "Public visitors can browse
-- published listings and advice.").
--
-- EXTENDS learning_resource (migration 6); no parallel table. Still a library
-- of guides, not a course system: nothing here holds an enrolment, a score or
-- progress (CLAUDE.md section 2).
--
-- ADDITIVE: one enum type; nullable or defaulted columns; CHECKs that every
-- existing row already satisfies once the backfill below has run; the
-- SELECT * view recreated so it carries the new columns. Nothing is dropped,
-- retyped or renamed. `published` stays and is kept equal to
-- (status = 'published') by a CHECK, so every reader of the old flag -- the
-- officer list among them -- sees exactly what it saw before.
--
-- The audit CHECK (audit_event_action_known) is NOT touched here. The new
-- keys (learning_resource.submitted, .returned, .unpublished) are in
-- AUDIT_ACTIONS; one combined CHECK migration is written when the branches
-- that add keys land.

CREATE TYPE "public"."learning_status" AS ENUM (
    'draft',
    'in_review',
    'published',
    'unpublished'
);

ALTER TABLE "public"."learning_resource"
    -- The workflow state. New rows start as drafts, as they started
    -- unpublished before.
    ADD COLUMN "status"         "public"."learning_status" NOT NULL DEFAULT 'draft',
    -- The shared ADVICE_TOPICS (packages/shared/src/advice-topics.ts), so a
    -- farmer filters guides, advice providers and advice requests the same
    -- way. The old single `topic` stays; the route keeps it filled.
    ADD COLUMN "topics"         TEXT[]      NOT NULL DEFAULT '{}',
    -- Translations. `title` and `description` are the English (existing
    -- content stays as it is, read as English); these are the Arabic.
    ADD COLUMN "title_ar"       TEXT,
    ADD COLUMN "description_ar" TEXT,
    -- Who moved it, and when. Submitted: the last time it went to review.
    -- Reviewed: the last return, publish or unpublish, with the note a
    -- return carries. Published: the last time it went public.
    ADD COLUMN "submitted_by"   UUID,
    ADD COLUMN "submitted_at"   TIMESTAMPTZ,
    ADD COLUMN "reviewed_by"    UUID,
    ADD COLUMN "reviewed_at"    TIMESTAMPTZ,
    ADD COLUMN "review_note"    TEXT,
    ADD COLUMN "published_by"   UUID,
    ADD COLUMN "published_at"   TIMESTAMPTZ,
    ADD COLUMN "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now();

-- BACKFILL. A resource published today is published under the workflow, so
-- nothing disappears from an officer's list. An unpublished one becomes a
-- draft: nobody submitted it, so it is not "in review". published_by and
-- published_at stay null for those rows -- nobody recorded who published them
-- or when, and inventing it would be worse than saying so. updated_at starts
-- at the upload time rather than at this migration.
UPDATE "public"."learning_resource"
   SET "status" = CASE WHEN "published" THEN 'published' ELSE 'draft' END::"public"."learning_status",
       "topics" = ARRAY[CASE "topic"::text
           WHEN 'crop_production' THEN 'crops'
           WHEN 'livestock'       THEN 'livestock'
           WHEN 'pest_disease'    THEN 'pests_diseases'
           WHEN 'post_harvest'    THEN 'post_harvest'
           WHEN 'marketing'       THEN 'marketing_prices'
           WHEN 'cooperative'     THEN 'finance_business'
           WHEN 'climate'         THEN 'climate_weather'
           ELSE 'other'
       END],
       "updated_at" = "uploaded_at";

ALTER TABLE "public"."learning_resource"
    ADD CONSTRAINT "learning_resource_submitted_by_fkey"
        FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "learning_resource_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "learning_resource_published_by_fkey"
        FOREIGN KEY ("published_by") REFERENCES "public"."user"("id"),
    -- The old flag and the new state cannot disagree.
    ADD CONSTRAINT "learning_resource_published_matches_status"
        CHECK ("published" = ("status" = 'published')),
    -- ADVICE_TOPICS, verbatim. A topic added there needs a migration here.
    ADD CONSTRAINT "learning_resource_topics_known" CHECK (
        "topics" <@ ARRAY[
            'crops',
            'livestock',
            'soil_fertiliser',
            'pests_diseases',
            'water_irrigation',
            'post_harvest',
            'marketing_prices',
            'finance_business',
            'climate_weather',
            'other'
        ]::text[]
    ),
    -- LEARNING_TOPICS_MAX in packages/shared. At least one is the API's rule
    -- (the shared schema), not the database's: a row written outside the API
    -- with the column's default is unfiled, not invalid.
    ADD CONSTRAINT "learning_resource_topics_count"
        CHECK (cardinality("topics") <= 4),
    -- Both checks are vacuous on rows where the column is null.
    ADD CONSTRAINT "learning_resource_title_ar_not_blank"
        CHECK (btrim("title_ar") <> ''),
    ADD CONSTRAINT "learning_resource_review_note_not_blank"
        CHECK (btrim("review_note") <> ''),
    -- A move is recorded with its actor and its time, or not at all.
    ADD CONSTRAINT "learning_resource_submitted_whole"
        CHECK (("submitted_by" IS NULL) = ("submitted_at" IS NULL)),
    ADD CONSTRAINT "learning_resource_reviewed_whole"
        CHECK (("reviewed_by" IS NULL) = ("reviewed_at" IS NULL)),
    -- published_at alone is allowed: a row a later tool backfills with a
    -- known date and no known person. A person without a time is not.
    ADD CONSTRAINT "learning_resource_published_by_has_time"
        CHECK ("published_by" IS NULL OR "published_at" IS NOT NULL);

-- The public list: published guides, newest first, by topic.
CREATE INDEX "learning_resource_public_idx"
    ON "public"."learning_resource" ("status", "published_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "learning_resource_topics_idx"
    ON "public"."learning_resource" USING GIN ("topics")
    WHERE "deleted_at" IS NULL;

-- A SELECT * view freezes its column list when it is created (DECISIONS, "A
-- view is a filter of its table"); CREATE OR REPLACE appends the new columns.
-- The original filter, unchanged.
CREATE OR REPLACE VIEW "public"."learning_resource_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."learning_resource" WHERE "deleted_at" IS NULL;

-- RLS was enabled on learning_resource in migration 6, with no policies, and
-- stays so: every read and write goes through an API route.

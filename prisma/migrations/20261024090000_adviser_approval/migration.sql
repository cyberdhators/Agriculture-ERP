-- 2026-10-24 -- independent advice, part 2: the OPTIONAL "approved adviser"
-- pathway (CORWADO's 16 October specification, "An existing user applies with
-- specialties, service area, languages, experience, qualifications and
-- affiliation. An authorized administrator requests clarification, approves
-- or declines with a recorded reason."). docs/DECISIONS.md, "Approved
-- advisers: optional, reviewed, revocable".
--
-- ADDITIVE: one new table, and two nullable columns on advice_provider. No
-- existing row changes: every provider starts with approved_at NULL, which is
-- exactly what it was before (not approved).
--
-- NO AUDIT CHECK HERE, deliberately, as in 20261022090000_advice_requests.
-- This change adds seven audit keys to AUDIT_ACTIONS (adviser_application.*
-- and adviser_approval.revoked); one combined CHECK migration is written by
-- the owner. Until it is applied the database refuses these keys, so every
-- write here is refused rather than unlogged.
--
-- INDEPENDENT OF ACCOUNT STANDING. Approval lives on the provider row and on
-- the application, never on the farmer or buyer record, so suspending or
-- restoring an account does not touch it: restoration does not bring back a
-- revoked approval (the specification), and suspension does not erase one
-- (a suspended account is simply out of the directory, badge and all).

-- One application by one provider. A provider may apply again after a
-- decline, a withdrawal or a revocation; each attempt is its own row, so the
-- history stays.
CREATE TABLE "public"."adviser_application" (
    "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
    "provider_id"             UUID        NOT NULL,
    -- The sign-in that applied, so a staff member's own application can be
    -- recognised and refused to them.
    "auth_user_id"            UUID        NOT NULL,
    "specialties"             TEXT[]      NOT NULL,
    -- State ids served; empty means anywhere.
    "service_area"            TEXT[]      NOT NULL DEFAULT '{}',
    "languages"               TEXT[]      NOT NULL,
    "experience"              TEXT        NOT NULL,
    "qualifications"          TEXT,
    "affiliation"             TEXT,
    -- Acknowledgements: unticked on the form, and only true is accepted.
    "accurate_information"    BOOLEAN     NOT NULL,
    "disclose_interests"      BOOLEAN     NOT NULL,
    "status"                  TEXT        NOT NULL DEFAULT 'submitted',
    -- The latest question from CORWADO, and the applicant's latest answer.
    "clarification_request"   TEXT,
    "applicant_reply"         TEXT,
    -- The latest final decision: approved, declined or revoked.
    "decision_reason"         TEXT,
    "decided_by"              UUID,
    "decided_at"              TIMESTAMPTZ,
    "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"              TIMESTAMPTZ,

    CONSTRAINT "adviser_application_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adviser_application_provider_id_fkey"
        FOREIGN KEY ("provider_id") REFERENCES "public"."advice_provider"("id"),
    CONSTRAINT "adviser_application_decided_by_fkey"
        FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id"),
    -- ADVICE_TOPICS in packages/shared/src/advice-topics.ts.
    CONSTRAINT "adviser_application_specialties_known" CHECK (
        cardinality("specialties") > 0 AND "specialties" <@ ARRAY[
            'crops', 'livestock', 'soil_fertiliser', 'pests_diseases', 'water_irrigation',
            'post_harvest', 'marketing_prices', 'finance_business', 'climate_weather', 'other'
        ]::TEXT[]
    ),
    -- ADVICE_LANGUAGES in packages/shared/src/advice.ts.
    CONSTRAINT "adviser_application_languages_known" CHECK (
        cardinality("languages") > 0 AND "languages" <@ ARRAY[
            'en', 'ar', 'juba_arabic', 'dinka', 'nuer', 'bari', 'other'
        ]::TEXT[]
    ),
    CONSTRAINT "adviser_application_service_area_size" CHECK (cardinality("service_area") <= 20),
    CONSTRAINT "adviser_application_experience_length" CHECK (
        char_length("experience") BETWEEN 20 AND 2000
    ),
    CONSTRAINT "adviser_application_qualifications_length" CHECK (
        "qualifications" IS NULL OR char_length("qualifications") <= 2000
    ),
    CONSTRAINT "adviser_application_affiliation_length" CHECK (
        "affiliation" IS NULL OR char_length("affiliation") <= 300
    ),
    CONSTRAINT "adviser_application_acknowledged" CHECK (
        "accurate_information" AND "disclose_interests"
    ),
    CONSTRAINT "adviser_application_status_known" CHECK ("status" IN (
        'submitted', 'clarification_requested', 'approved', 'declined', 'revoked', 'withdrawn'
    )),
    CONSTRAINT "adviser_application_clarification_length" CHECK (
        "clarification_request" IS NULL OR char_length("clarification_request") <= 1000
    ),
    CONSTRAINT "adviser_application_reply_length" CHECK (
        "applicant_reply" IS NULL OR char_length("applicant_reply") <= 2000
    ),
    CONSTRAINT "adviser_application_reason_length" CHECK (
        "decision_reason" IS NULL OR char_length("decision_reason") <= 1000
    ),
    -- A question asked is a question written down.
    CONSTRAINT "adviser_application_clarification_has_request" CHECK (
        "status" <> 'clarification_requested' OR "clarification_request" IS NOT NULL
    ),
    -- Every final decision records who made it, when, and why.
    CONSTRAINT "adviser_application_decision_recorded" CHECK (
        "status" NOT IN ('approved', 'declined', 'revoked')
        OR ("decision_reason" IS NOT NULL AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
    )
);

-- ONE OPEN APPLICATION PER PROVIDER: a second Submit from another tab is
-- refused by the database, not only by the route.
CREATE UNIQUE INDEX "adviser_application_one_open" ON "public"."adviser_application" ("provider_id")
    WHERE "status" IN ('submitted', 'clarification_requested') AND "deleted_at" IS NULL;
-- And one standing approval.
CREATE UNIQUE INDEX "adviser_application_one_approved" ON "public"."adviser_application" ("provider_id")
    WHERE "status" = 'approved' AND "deleted_at" IS NULL;
-- The staff queue reads one status, oldest first.
CREATE INDEX "adviser_application_queue_idx" ON "public"."adviser_application" ("status", "updated_at", "id")
    WHERE "deleted_at" IS NULL;

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."adviser_application" ENABLE ROW LEVEL SECURITY;

-- THE BADGE. approved_at IS NOT NULL is "Approved adviser"; both columns are
-- set together by an approval and cleared together by a revocation.
ALTER TABLE "public"."advice_provider"
    ADD COLUMN "approved_at"             TIMESTAMPTZ,
    ADD COLUMN "approved_application_id" UUID;

ALTER TABLE "public"."advice_provider"
    ADD CONSTRAINT "advice_provider_approved_application_id_fkey"
        FOREIGN KEY ("approved_application_id") REFERENCES "public"."adviser_application"("id");

ALTER TABLE "public"."advice_provider"
    ADD CONSTRAINT "advice_provider_approval_pair" CHECK (
        ("approved_at" IS NULL) = ("approved_application_id" IS NULL)
    );

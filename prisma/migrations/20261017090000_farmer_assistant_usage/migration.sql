-- 2026-10-17 -- the farmer's assistant (an AI chat, Claude Haiku 5.5) in place
-- of the learning library on the farmer's dashboard. Approved by the owner,
-- lifting "Ask AI" from CLAUDE.md's hold list (DECISIONS.md, same date).
--
-- ONE ADDITIVE TABLE: how many questions each farmer asked on each day, so a
-- daily cap (ASSISTANT_LIMITS.dailyMax in packages/shared) holds across
-- devices and serverless instances. It stores a count only -- never a
-- question, an answer or anything the farmer typed. The conversation lives on
-- the farmer's phone.
--
-- A counter, not a record: incrementing it is not a create/update of
-- business data, so it is not audited row by row (the audit law covers
-- records). Row-level security on, no policies -- the deny-by-default
-- backstop every table here has; only the API's own connection writes it.

CREATE TABLE "public"."assistant_usage" (
    "farmer_id"  UUID        NOT NULL,
    "day"        DATE        NOT NULL,
    "questions"  INTEGER     NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("farmer_id", "day"),
    CONSTRAINT "assistant_usage_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "assistant_usage_questions_nonnegative" CHECK ("questions" >= 0)
);

ALTER TABLE "public"."assistant_usage" ENABLE ROW LEVEL SECURITY;

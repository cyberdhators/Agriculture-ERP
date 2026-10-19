-- 2026-10-19 -- phone verification by SMS code (CORWADO's specification:
-- "Contact verification activates the account automatically"; the owner's
-- decision the same day). A farmer signing up receives a 6-digit code by SMS
-- (Bird) and the sign-up completes only with it.
--
-- ONE ADDITIVE TABLE. It holds a code's hash, never the code; the phone it was
-- sent to (needed to match the sign-up and to rate-limit sends); and its
-- lifecycle. An operational record like assistant_usage, not a business
-- record: rows are not audited one by one -- the sign-up they complete is
-- (`farmer.created`). Row-level security on, no policies.

CREATE TABLE "public"."phone_verification" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "phone"       TEXT        NOT NULL,
    "purpose"     TEXT        NOT NULL,
    "code_hash"   TEXT        NOT NULL,
    "attempts"    SMALLINT    NOT NULL DEFAULT 0,
    "expires_at"  TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "phone_verification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "phone_verification_phone_e164" CHECK ("phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "phone_verification_purpose" CHECK ("purpose" IN ('farmer_sign_up')),
    CONSTRAINT "phone_verification_attempts" CHECK ("attempts" BETWEEN 0 AND 100)
);

-- Rate limits read recent sends per phone, and system-wide.
CREATE INDEX "phone_verification_phone_created_idx"
    ON "public"."phone_verification" ("phone", "created_at" DESC);
CREATE INDEX "phone_verification_created_idx"
    ON "public"."phone_verification" ("created_at" DESC);

ALTER TABLE "public"."phone_verification" ENABLE ROW LEVEL SECURITY;

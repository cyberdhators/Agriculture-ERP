-- 2026-10-09: recovery codes -- a farmer or buyer who forgets their password
-- resets it with a one-time code they were shown at registration (the owner:
-- "build the recovery code option but keep the email"). Additive.
--
-- One row per sign-in account. Only a salted scrypt hash of the code is kept,
-- never the code. Five wrong tries lock recovery for that account for an hour.
CREATE TABLE "public"."account_recovery" (
    "auth_user_id"    UUID         NOT NULL,
    "code_hash"       TEXT         NOT NULL,
    "failed_attempts" SMALLINT     NOT NULL DEFAULT 0,
    "locked_until"    TIMESTAMPTZ(6),
    "issued_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "used_at"         TIMESTAMPTZ(6),
    CONSTRAINT "account_recovery_pkey" PRIMARY KEY ("auth_user_id"),
    CONSTRAINT "account_recovery_attempts_nonnegative" CHECK ("failed_attempts" >= 0)
);

-- Deny-by-default backstop, as on every table: no policies, routes only.
ALTER TABLE "public"."account_recovery" ENABLE ROW LEVEL SECURITY;

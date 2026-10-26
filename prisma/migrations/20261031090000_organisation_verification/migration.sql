-- 2026-10-31 -- ONLY ORGANISATIONS ARE VERIFIED. The owner: "remove
-- verification from accounts. only organization needs to be verified by admin
-- and superadmin not individual." docs/DECISIONS.md, "Only organisations are
-- verified (2026-10-31)".
--
-- ADDITIVE: four columns on the organisational profile (team access,
-- 20261027090000). An organisation starts 'unverified' and works normally;
-- staff holding `organization.verify` (the Administrator and Super Admin
-- presets) may mark it 'verified', which shows a "Verified organisation"
-- badge, or remove the mark. Verification is a badge only: nothing reads it to
-- allow or refuse anything. The history is the audit trail
-- (organization.verified, organization.verification_removed); these columns
-- hold the current state. No audit CHECK change here: the integrator owns the
-- CHECK (the new keys are listed in the lane report).
--
-- Not touched: farmer.verification_status and verification_event, the
-- extension programme's internal field record that reach reports read
-- (farmer_verified_v); buyer_organization.verification_status, the buyer
-- organisation's existing review.

ALTER TABLE "public"."organization"
    ADD COLUMN "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    ADD COLUMN "verified_at" TIMESTAMPTZ,
    ADD COLUMN "verified_by" UUID,
    ADD COLUMN "verification_note" TEXT;

ALTER TABLE "public"."organization"
    ADD CONSTRAINT "organization_verification_status_check"
        CHECK ("verification_status" IN ('unverified', 'verified'));

-- A verified organisation always says when and by whom.
ALTER TABLE "public"."organization"
    ADD CONSTRAINT "organization_verified_has_actor"
        CHECK ("verification_status" <> 'verified'
               OR ("verified_at" IS NOT NULL AND "verified_by" IS NOT NULL));

ALTER TABLE "public"."organization"
    ADD CONSTRAINT "organization_verification_note_length"
        CHECK ("verification_note" IS NULL OR char_length("verification_note") <= 300);

ALTER TABLE "public"."organization"
    ADD CONSTRAINT "organization_verified_by_fkey"
        FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id");

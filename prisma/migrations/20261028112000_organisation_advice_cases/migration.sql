-- Migration 20261028112000 -- organisation advice cases (2026-10-28).
-- CORWADO's specification, infographic 8 panel 3: "Requests go directly to the
-- provider's authorized staff, who manage the conversation" -- an institution's
-- shared inbox, authorised staff members, assign and accept.
-- docs/DECISIONS.md, "Organisation advice cases (2026-10-28)".
--
-- WHAT IT ADDS
--   advice_provider.organization_id  the profile is an ORGANISATION's advice
--                                    profile. Requests to it go to that
--                                    organisation's shared advice inbox, read
--                                    only by active members holding
--                                    `advisory.handle` (the first reader of that
--                                    permission, created by 20261027090000).
--   advice_case.assigned_auth_user_id, assigned_by, assigned_at, accepted_at
--                                    which member a case is assigned to, who
--                                    assigned it, and when the member accepted.
--
-- ONE CONSTRAINT IS REPLACED, NOT DROPPED (as 20261027090000 did for the
-- conversation): the unique "advice_provider_one_per_account" becomes two
-- partial unique indexes. The personal one has exactly the old meaning for
-- every existing row (all have organization_id NULL): one personal profile per
-- account. The other allows one advice profile per organisation. A person may
-- therefore have their own profile AND set up their organisation's; the two
-- stay separate (personal requests never reach the organisation's inbox, and
-- the organisation's never reach the person's).
--
-- ADDITIVE OTHERWISE: nullable columns, CHECKs that every existing row already
-- satisfies (all four new columns NULL), indexes. No backfill. RLS is already
-- enabled on both tables with no policies; no new table. No audit CHECK here:
-- the new keys are listed in the lane's report and the integrator rebuilds it.
--
-- NOT APPLIED by the session that wrote it (the only database is production).

ALTER TABLE "public"."advice_provider" ADD COLUMN "organization_id" UUID;

ALTER TABLE "public"."advice_provider"
    ADD CONSTRAINT "advice_provider_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id");

ALTER TABLE "public"."advice_provider" DROP CONSTRAINT "advice_provider_one_per_account";

-- One PERSONAL profile per account: the old constraint's meaning, unchanged.
CREATE UNIQUE INDEX "advice_provider_one_personal"
    ON "public"."advice_provider" ("auth_user_id")
    WHERE "organization_id" IS NULL;

-- One advice profile per organisation.
CREATE UNIQUE INDEX "advice_provider_one_per_organization"
    ON "public"."advice_provider" ("organization_id")
    WHERE "organization_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Assignment on a case. Only an organisation's case is ever assigned; a
-- personal case has one provider, who is the person.
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."advice_case"
    ADD COLUMN "assigned_auth_user_id" UUID,
    ADD COLUMN "assigned_by"           UUID,
    ADD COLUMN "assigned_at"           TIMESTAMPTZ,
    ADD COLUMN "accepted_at"           TIMESTAMPTZ;

-- Assigned is all three facts or none of them.
ALTER TABLE "public"."advice_case"
    ADD CONSTRAINT "advice_case_assignment_complete" CHECK (
        ("assigned_auth_user_id" IS NULL AND "assigned_by" IS NULL AND "assigned_at" IS NULL)
        OR ("assigned_auth_user_id" IS NOT NULL AND "assigned_by" IS NOT NULL
            AND "assigned_at" IS NOT NULL)
    );

-- Only an assigned case can have been accepted.
ALTER TABLE "public"."advice_case"
    ADD CONSTRAINT "advice_case_accepted_needs_assignee" CHECK (
        "accepted_at" IS NULL OR "assigned_auth_user_id" IS NOT NULL
    );

-- "Assigned to me" in the organisation's inbox.
CREATE INDEX "advice_case_assignee_idx"
    ON "public"."advice_case" ("assigned_auth_user_id", "status", "created_at" DESC)
    WHERE "assigned_auth_user_id" IS NOT NULL;

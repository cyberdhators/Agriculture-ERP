-- 2026-10-28 -- STAFF SECURITY AND ADVISORY AUTHORIZATION (lane-security).
-- CORWADO's specification of 16 October: "Invitations, multiple roles ...";
-- "require strong staff authentication"; "Record account creation, first
-- successful sign-in, subsequent sign-ins, return sessions, last activity and
-- failed sign-ins"; "Separate listing removal, account status and advisory
-- authorization"; "Approved advisory channels, official content publication
-- ... require separately assigned permissions". docs/DECISIONS.md, the
-- 2026-10-28 entries.
--
-- ADDITIVE. Three new tables (staff_invitation, sign_in_attempt,
-- advisory_note), three nullable columns on adviser_application, and two
-- CHECK constraints WIDENED by one value each (access_log event:
-- 'sign_in_failed'; adviser_application status: 'suspended'). A widened
-- CHECK is dropped and re-added with every old value kept, so no existing
-- row can fail it. No column is dropped, retyped or emptied.
--
-- NO AUDIT CHECK HERE, deliberately, as in every lane migration: the new
-- audit keys are listed in the lane's report and the integrator writes the
-- combined CHECK. Until then the database refuses those keys, so every write
-- that needs one is refused rather than unlogged.
--
-- Row-level security is ON for every new table with NO policies: the
-- deny-by-default backstop. Only the API's own connection reads or writes.
--
-- NOT APPLIED by the session that wrote it (there is only production).

-- =============================================================================
-- 1. FAILED SIGN-INS IN THE ACCESS LOG
-- =============================================================================
--
-- The server sign-in route (POST /api/auth/sign-in) now sees every sign-in made
-- from the app's own screens, so a wrong password for a KNOWN account is
-- recorded against that account. An identifier with no account is not
-- recorded in the access log (there is no account to record it against); it
-- counts towards the rate limit only.

ALTER TABLE "public"."access_log" DROP CONSTRAINT "access_log_event_known";
ALTER TABLE "public"."access_log" ADD CONSTRAINT "access_log_event_known" CHECK ("event" IN (
    'account_created', 'first_sign_in', 'sign_in', 'return_session', 'reauth_failed',
    'sign_in_failed'
));

-- =============================================================================
-- 2. SIGN-IN ATTEMPTS -- the rate limit's memory
-- =============================================================================
--
-- One row per password attempt through the server sign-in route. The
-- identifier is stored ONLY as a SHA-256 hash of its normalised form, so this
-- table cannot be read back into a list of addresses or phone numbers. No IP
-- address, no user agent. A moving window, not a record: rows older than a
-- day may be deleted (the route does so opportunistically), which is why
-- this table is NOT append-only and is not audited.

CREATE TABLE "public"."sign_in_attempt" (
    "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
    "identifier_hash" TEXT        NOT NULL,
    "succeeded"       BOOLEAN     NOT NULL,
    "attempted_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "sign_in_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sign_in_attempt_hash_shape" CHECK ("identifier_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "sign_in_attempt_window_idx"
    ON "public"."sign_in_attempt" ("identifier_hash", "attempted_at" DESC);
CREATE INDEX "sign_in_attempt_age_idx"
    ON "public"."sign_in_attempt" ("attempted_at");

ALTER TABLE "public"."sign_in_attempt" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. STAFF INVITATIONS -- expiring, by email; the invitee sets the password
-- =============================================================================
--
-- An administrator holding "Manage staff permissions" invites an email
-- address to a role (and a state, for a supervisor or read-only account). The
-- link carries a random token; only its SHA-256 hash is stored. The invitee
-- opens the link, chooses their own password, and the account is created
-- then. Nobody else ever knows the password. The email address itself is
-- kept on the invitation (the `user` table has none, by design), because the
-- account is created for exactly that address; it is never returned by a
-- list route except to the staff who manage invitations.
--
-- Revocation is the soft delete: revoked_at/revoked_by set together and never
-- cleared. Accepted invitations keep the account they created.

CREATE TABLE "public"."staff_invitation" (
    "id"               UUID               NOT NULL DEFAULT gen_random_uuid(),
    "token_hash"       TEXT               NOT NULL,
    "email"            TEXT               NOT NULL,
    "name"             TEXT               NOT NULL,
    "role"             "public"."user_role" NOT NULL,
    "scope_state_id"   TEXT,
    "invited_by"       UUID               NOT NULL,
    "created_at"       TIMESTAMPTZ        NOT NULL DEFAULT now(),
    "expires_at"       TIMESTAMPTZ        NOT NULL,
    "accepted_at"      TIMESTAMPTZ,
    "accepted_user_id" UUID,
    "revoked_at"       TIMESTAMPTZ,
    "revoked_by"       UUID,

    CONSTRAINT "staff_invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_invitation_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "staff_invitation_invited_by_fkey"
        FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "staff_invitation_revoked_by_fkey"
        FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "staff_invitation_accepted_user_id_fkey"
        FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id"),
    CONSTRAINT "staff_invitation_scope_state_id_fkey"
        FOREIGN KEY ("scope_state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "staff_invitation_token_hash_shape" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "staff_invitation_email_shape" CHECK (
        char_length("email") BETWEEN 3 AND 254 AND "email" = lower("email") AND "email" LIKE '%_@_%'
    ),
    CONSTRAINT "staff_invitation_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
    -- The same pairing the user table enforces: an admin has no state; a
    -- supervisor or read-only account has exactly one.
    CONSTRAINT "staff_invitation_scope_matches_role" CHECK (
        ("role" = 'admin' AND "scope_state_id" IS NULL)
        OR ("role" <> 'admin' AND "scope_state_id" IS NOT NULL)
    ),
    CONSTRAINT "staff_invitation_expiry_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "staff_invitation_accepted_whole" CHECK (
        ("accepted_at" IS NULL) = ("accepted_user_id" IS NULL)
    ),
    CONSTRAINT "staff_invitation_revoked_whole" CHECK (
        ("revoked_at" IS NULL) = ("revoked_by" IS NULL)
    ),
    CONSTRAINT "staff_invitation_not_both" CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL)
);

-- One open invitation per address: a second Invite is refused by the database.
-- "Open" here ignores expiry (a CHECK cannot read the clock); the route
-- revokes an expired invitation for the same address before inviting again.
CREATE UNIQUE INDEX "staff_invitation_one_open"
    ON "public"."staff_invitation" ("email")
    WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "staff_invitation_created_idx"
    ON "public"."staff_invitation" ("created_at" DESC, "id" DESC);

ALTER TABLE "public"."staff_invitation" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. ADVISORY AUTHORIZATION: SUSPEND AND RESTORE, AND WHAT WAS CHECKED
-- =============================================================================
--
-- approved --(staff: suspend, reason, 1-365 days)--> suspended
-- suspended --(staff: restore, reason)--> approved
-- approved | suspended --(staff: revoke)--> revoked
-- A suspension LAPSES by itself at suspended_until: from then on the badge
-- shows again and the application reads as approved, without anyone writing.
--
-- The provider's approved_at / approved_application_id are NOT cleared by a
-- suspension (the approval still stands; it is paused), so no second
-- application can be approved meanwhile. Every reader of the badge also asks
-- "is the standing approval suspended right now?" (lib/api/adviser-approval.ts,
-- APPROVAL_SUSPENDED_SQL).
--
-- verified_checks: what the approving staff member says they checked, shown
-- to the public as "What CORWADO checked". Empty for approvals made before
-- this migration, which the page says plainly.

ALTER TABLE "public"."adviser_application"
    ADD COLUMN "suspended_until"   TIMESTAMPTZ,
    ADD COLUMN "suspension_reason" TEXT,
    ADD COLUMN "verified_checks"   TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "public"."adviser_application" DROP CONSTRAINT "adviser_application_status_known";
ALTER TABLE "public"."adviser_application" ADD CONSTRAINT "adviser_application_status_known" CHECK ("status" IN (
    'submitted', 'clarification_requested', 'approved', 'declined', 'revoked', 'withdrawn',
    'suspended'
));

ALTER TABLE "public"."adviser_application"
    -- A suspension always has its end and its reason; nothing else has an end.
    -- The reason of an ended suspension may stay as the latest one given.
    ADD CONSTRAINT "adviser_application_suspension_whole" CHECK (
        ("status" = 'suspended') = ("suspended_until" IS NOT NULL)
        AND ("status" <> 'suspended' OR "suspension_reason" IS NOT NULL)
    ),
    ADD CONSTRAINT "adviser_application_suspension_reason_length" CHECK (
        "suspension_reason" IS NULL OR char_length("suspension_reason") BETWEEN 5 AND 1000
    ),
    -- ADVISER_CHECKS in packages/shared/src/adviser-approval.ts.
    ADD CONSTRAINT "adviser_application_verified_checks_known" CHECK (
        "verified_checks" <@ ARRAY[
            'identity', 'experience', 'qualifications', 'affiliation', 'service_area',
            'languages', 'interests_disclosed'
        ]::TEXT[]
    );

-- One STANDING approval per provider, suspended or not. The existing
-- adviser_application_one_approved index stays: it is implied by this one.
CREATE UNIQUE INDEX "adviser_application_one_standing"
    ON "public"."adviser_application" ("provider_id")
    WHERE "status" IN ('approved', 'suspended') AND "deleted_at" IS NULL;

-- =============================================================================
-- 5. OFFICIAL ADVISORY NOTES -- the approved-adviser channel
-- =============================================================================
--
-- An APPROVED adviser (and only one: not suspended, not revoked) may submit a
-- short advisory note for official publication. It goes into staff review:
--   submitted --(staff content.moderate or content.publish: return)--> returned
--   returned --(adviser: edit and resubmit)--> submitted
--   submitted --(staff content.publish: publish)--> published
--   published --(staff content.publish: unpublish)--> unpublished
--   submitted | returned --(adviser: withdraw)--> withdrawn
-- Published notes appear on the adviser's public profile as "Reviewed by
-- CORWADO", and disappear while the approval is suspended or once revoked.
-- Nothing else on the account changes; ordinary advice profiles are untouched.

CREATE TABLE "public"."advisory_note" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "provider_id"    UUID        NOT NULL,
    -- The approval the note was submitted under.
    "application_id" UUID        NOT NULL,
    "auth_user_id"   UUID        NOT NULL,
    "title"          TEXT        NOT NULL,
    "topics"         TEXT[]      NOT NULL,
    "language"       TEXT        NOT NULL,
    "body"           TEXT        NOT NULL,
    "status"         TEXT        NOT NULL DEFAULT 'submitted',
    "review_note"    TEXT,
    "reviewed_by"    UUID,
    "reviewed_at"    TIMESTAMPTZ,
    "published_by"   UUID,
    "published_at"   TIMESTAMPTZ,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"     TIMESTAMPTZ,

    CONSTRAINT "advisory_note_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "advisory_note_provider_id_fkey"
        FOREIGN KEY ("provider_id") REFERENCES "public"."advice_provider"("id"),
    CONSTRAINT "advisory_note_application_id_fkey"
        FOREIGN KEY ("application_id") REFERENCES "public"."adviser_application"("id"),
    CONSTRAINT "advisory_note_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "advisory_note_published_by_fkey"
        FOREIGN KEY ("published_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "advisory_note_title_length" CHECK (char_length("title") BETWEEN 5 AND 200),
    CONSTRAINT "advisory_note_body_length" CHECK (char_length("body") BETWEEN 50 AND 5000),
    -- ADVICE_TOPICS in packages/shared/src/advice-topics.ts.
    CONSTRAINT "advisory_note_topics_known" CHECK (
        cardinality("topics") BETWEEN 1 AND 4 AND "topics" <@ ARRAY[
            'crops', 'livestock', 'soil_fertiliser', 'pests_diseases', 'water_irrigation',
            'post_harvest', 'marketing_prices', 'finance_business', 'climate_weather', 'other'
        ]::TEXT[]
    ),
    -- ADVICE_LANGUAGES in packages/shared/src/advice.ts.
    CONSTRAINT "advisory_note_language_known" CHECK ("language" IN (
        'en', 'ar', 'juba_arabic', 'dinka', 'nuer', 'bari', 'other'
    )),
    CONSTRAINT "advisory_note_status_known" CHECK ("status" IN (
        'submitted', 'returned', 'published', 'unpublished', 'withdrawn'
    )),
    CONSTRAINT "advisory_note_review_note_length" CHECK (
        "review_note" IS NULL OR char_length("review_note") BETWEEN 5 AND 1000
    ),
    CONSTRAINT "advisory_note_returned_has_note" CHECK (
        "status" <> 'returned' OR "review_note" IS NOT NULL
    ),
    CONSTRAINT "advisory_note_reviewed_whole" CHECK (
        ("reviewed_by" IS NULL) = ("reviewed_at" IS NULL)
    ),
    CONSTRAINT "advisory_note_published_whole" CHECK (
        "status" <> 'published' OR ("published_by" IS NOT NULL AND "published_at" IS NOT NULL)
    )
);

CREATE INDEX "advisory_note_provider_idx"
    ON "public"."advisory_note" ("provider_id", "updated_at" DESC)
    WHERE "deleted_at" IS NULL;
CREATE INDEX "advisory_note_queue_idx"
    ON "public"."advisory_note" ("status", "updated_at", "id")
    WHERE "deleted_at" IS NULL;

ALTER TABLE "public"."advisory_note" ENABLE ROW LEVEL SECURITY;

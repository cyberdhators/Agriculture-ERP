-- 2026-10-25 -- independent advice, part 3: photos on a question, and
-- referral with consent (CORWADO's 16 October specification: "Questions and
-- optional attachments remain private to the permitted participants. Share
-- case details and refer to another provider only with appropriate consent.").
-- docs/DECISIONS.md, "Advice: photos and referral with consent".
--
-- ADDITIVE: two new tables. No existing row or constraint changes.
--
-- NO AUDIT CHECK HERE, deliberately, as in 20261022090000_advice_requests.
-- This change adds six audit keys to AUDIT_ACTIONS (advice_attachment.added,
-- advice_attachment.removed, advice_referral.proposed, .accepted, .declined,
-- .withdrawn); one combined CHECK migration is written by the owner. Until it
-- is applied the database refuses these keys, so every write here is refused
-- rather than unlogged.
--
-- PRIVATE TO THE TWO PEOPLE IN THE CASE. A photo's bytes live in the private
-- bucket `advice-attachments` under the case's id; the API shows a photo to
-- the case's requester and provider only, through a read link that expires.
-- Staff have no read path, as for the question itself.

-- One photo on one case. The id is the upload id the grant was issued for;
-- the row is written only after the server has checked what arrived.
CREATE TABLE "public"."advice_case_attachment" (
    "id"           UUID        NOT NULL,
    "case_id"      UUID        NOT NULL,
    -- The sign-in that added it: the requester or the provider of the case.
    "uploaded_by"  UUID        NOT NULL,
    -- "<case id>/<upload id>.<ext>" in the advice-attachments bucket. Never
    -- leaves the API: the screens get a read link that expires.
    "storage_path" TEXT        NOT NULL,
    "content_type" TEXT        NOT NULL,
    "byte_size"    INTEGER     NOT NULL,
    -- Set on a copy made when the requester accepted a referral and chose to
    -- share their photos: the photo it was copied from, on the earlier case.
    "copied_from_id" UUID,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"   TIMESTAMPTZ,

    CONSTRAINT "advice_case_attachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "advice_case_attachment_case_id_fkey"
        FOREIGN KEY ("case_id") REFERENCES "public"."advice_case"("id"),
    CONSTRAINT "advice_case_attachment_copied_from_id_fkey"
        FOREIGN KEY ("copied_from_id") REFERENCES "public"."advice_case_attachment"("id"),
    CONSTRAINT "advice_case_attachment_path_unique" UNIQUE ("storage_path"),
    -- The path is under the case's own folder.
    CONSTRAINT "advice_case_attachment_path_in_case" CHECK (
        "storage_path" LIKE ("case_id"::text || '/%')
    ),
    -- ADVICE_ATTACHMENT_CONTENT_TYPES and ADVICE_ATTACHMENT_LIMITS.maxBytes
    -- in packages/shared/src/advice.ts.
    CONSTRAINT "advice_case_attachment_type_known" CHECK (
        "content_type" IN ('image/jpeg', 'image/png', 'image/webp')
    ),
    CONSTRAINT "advice_case_attachment_size_range" CHECK ("byte_size" BETWEEN 1 AND 2097152)
);

-- A case's photos, oldest first, as the case page reads them.
CREATE INDEX "advice_case_attachment_case_idx" ON "public"."advice_case_attachment" ("case_id", "created_at")
    WHERE "deleted_at" IS NULL;

-- A provider's proposal to pass a case to another published provider. Nothing
-- is shared until the requester accepts; then the earlier case closes as
-- 'referred' and a NEW case (to_case_id) opens with the other provider,
-- carrying the topic and the question -- and the requester's photos only if
-- they ticked "share my photos too" (share_attachments, off by default).
CREATE TABLE "public"."advice_referral" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "from_case_id"      UUID        NOT NULL,
    "to_provider_id"    UUID        NOT NULL,
    -- The provider's sign-in that proposed it.
    "proposed_by"       UUID        NOT NULL,
    "status"            TEXT        NOT NULL DEFAULT 'proposed',
    "share_attachments" BOOLEAN     NOT NULL DEFAULT false,
    "to_case_id"        UUID,
    "decided_at"        TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"        TIMESTAMPTZ,

    CONSTRAINT "advice_referral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "advice_referral_from_case_id_fkey"
        FOREIGN KEY ("from_case_id") REFERENCES "public"."advice_case"("id"),
    CONSTRAINT "advice_referral_to_provider_id_fkey"
        FOREIGN KEY ("to_provider_id") REFERENCES "public"."advice_provider"("id"),
    CONSTRAINT "advice_referral_to_case_id_fkey"
        FOREIGN KEY ("to_case_id") REFERENCES "public"."advice_case"("id"),
    CONSTRAINT "advice_referral_to_case_unique" UNIQUE ("to_case_id"),
    CONSTRAINT "advice_referral_status_known" CHECK (
        "status" IN ('proposed', 'accepted', 'declined', 'withdrawn')
    ),
    -- Only an accepted referral has a new case, and every accepted one does.
    CONSTRAINT "advice_referral_accepted_has_case" CHECK (
        ("status" = 'accepted') = ("to_case_id" IS NOT NULL)
    ),
    -- Photos are shared only by an acceptance.
    CONSTRAINT "advice_referral_share_only_accepted" CHECK (
        "status" = 'accepted' OR NOT "share_attachments"
    ),
    -- Every answer records when.
    CONSTRAINT "advice_referral_decided_recorded" CHECK (
        ("status" = 'proposed') = ("decided_at" IS NULL)
    ),
    CONSTRAINT "advice_referral_not_to_itself" CHECK ("to_case_id" IS NULL OR "to_case_id" <> "from_case_id")
);

-- ONE WAITING PROPOSAL PER CASE, and one acceptance: a second proposal from
-- another tab is refused by the database, not only by the route.
CREATE UNIQUE INDEX "advice_referral_one_proposed" ON "public"."advice_referral" ("from_case_id")
    WHERE "status" = 'proposed' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "advice_referral_one_accepted" ON "public"."advice_referral" ("from_case_id")
    WHERE "status" = 'accepted' AND "deleted_at" IS NULL;
CREATE INDEX "advice_referral_from_case_idx" ON "public"."advice_referral" ("from_case_id", "created_at" DESC);
CREATE INDEX "advice_referral_to_provider_idx" ON "public"."advice_referral" ("to_provider_id");

-- Deny-by-default backstop; every read and write goes through an API route.
ALTER TABLE "public"."advice_case_attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."advice_referral" ENABLE ROW LEVEL SECURITY;

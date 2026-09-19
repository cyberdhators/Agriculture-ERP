-- Migration 20260917120000 -- marketplace listing persistence and product reports
--
-- Approved by the developers on 2026-09-17 as an addition to the contracted
-- scope, after the position paper at
-- docs/positions/2026-09-17-communications-and-marketplace-reporting.md.
-- Shapes from docs/api/product-reports-contract.md.
--
-- WHY A LISTING TABLE IS HERE AT ALL. A report is about a listing, and the
-- marketplace has run on fixtures with a sessionStorage override since it was
-- built. Reporting cannot be persistent while the thing reported is not. This
-- creates the MINIMUM listing persistence a report can reference -- identity,
-- ownership, what is being sold, and lifecycle -- and deliberately not the
-- whole marketplace. Price, quantity, photos, availability, delivery and
-- pickup belong to the marketplace unit proper and are not invented here.
--
-- The four patterns from migration 5 are copied, not reinterpreted:
--   1. RLS enabled in the same migration, no policies.
--   2. Views WITH (security_invoker = true).
--   3. deleted_at / deleted_by on every table.
--   4. Denormalised state_id, enforced by a composite foreign key.

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE "public"."listing_status" AS ENUM ('draft', 'listed', 'withdrawn', 'sold');

CREATE TYPE "public"."listing_category" AS ENUM (
    'crop', 'vegetable', 'fruit', 'livestock', 'poultry',
    'dairy', 'fish', 'processed', 'seeds_inputs', 'other'
);

-- PROPOSED in the contract and approved for implementation. The code carries
-- the meaning; the optional description carries the detail -- the same shape
-- the rejection reasons use.
CREATE TYPE "public"."report_reason" AS ENUM (
    'prohibited_content',
    'misleading_listing',
    'counterfeit_or_fraud',
    'inappropriate_content',
    'duplicate_or_spam',
    'other'
);

CREATE TYPE "public"."report_status" AS ENUM ('new', 'reviewing', 'resolved', 'dismissed');

-- =============================================================================
-- produce_listing -- the minimum a report can point at
-- =============================================================================

CREATE TABLE "public"."produce_listing" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmer_id"    UUID NOT NULL,
    -- The name buyers see. A farm or stall name the farmer chose, NEVER their
    -- legal name: the scope's marketplace amendment says a listing publishes
    -- no personal data, and the admin moderation queue shows this as "vendor"
    -- for exactly that reason.
    "trading_name" TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "category"     "public"."listing_category" NOT NULL,
    "product_name" TEXT NOT NULL,
    "status"       "public"."listing_status" NOT NULL DEFAULT 'draft',
    -- Denormalised so a scope check is not a join, per extension 1.4. The
    -- composite foreign key below keeps it honest.
    "payam_id"     TEXT NOT NULL,
    "state_id"     TEXT NOT NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"   TIMESTAMPTZ,
    "deleted_by"   UUID,

    CONSTRAINT "produce_listing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "produce_listing_farmer_id_fkey"
        FOREIGN KEY ("farmer_id") REFERENCES "public"."farmer"("id"),
    CONSTRAINT "produce_listing_payam_state_fkey"
        FOREIGN KEY ("payam_id", "state_id")
        REFERENCES "public"."payam"("id", "state_id"),
    CONSTRAINT "produce_listing_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "produce_listing_trading_name_not_blank" CHECK (btrim("trading_name") <> ''),
    CONSTRAINT "produce_listing_title_not_blank" CHECK (btrim("title") <> '')
);

-- =============================================================================
-- product_report -- one report about one listing
-- =============================================================================

CREATE TABLE "public"."product_report" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id"  UUID NOT NULL,
    "reason"      "public"."report_reason" NOT NULL,
    -- Free text a member of the public wrote. It may name a person, so it is
    -- never written into an audit row and never returned in a list response.
    "description" TEXT,
    "status"      "public"."report_status" NOT NULL DEFAULT 'new',
    --
    -- NO REPORTER IDENTITY IS STORED.
    --
    -- A marketplace visitor holds no account (DECISIONS, 2026-09-09). Storing
    -- a name, a phone or an address would make a report personal data about
    -- the REPORTER as well as about the listing, with everything that follows
    -- -- and the owner has not decided that it should. `submission_digest` is
    -- a one-way hash of the submitting connection, kept ONLY so repeated
    -- submissions about the same listing can be refused. It identifies nobody,
    -- is never returned by any route, and is not reversible.
    "submission_digest" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"  TIMESTAMPTZ,
    "deleted_by"  UUID,

    CONSTRAINT "product_report_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_report_listing_id_fkey"
        FOREIGN KEY ("listing_id") REFERENCES "public"."produce_listing"("id"),
    CONSTRAINT "product_report_resolved_by_fkey"
        FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "product_report_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id"),
    CONSTRAINT "product_report_description_length" CHECK (char_length("description") <= 500),
    -- A resolution has both halves or neither.
    CONSTRAINT "product_report_resolution_complete" CHECK (
        ("resolved_by" IS NULL AND "resolved_at" IS NULL)
        OR ("resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
    )
);

-- =============================================================================
-- INDEXES -- the three questions the queue actually asks
-- =============================================================================

-- The queue: newest first, filtered by status. Partial on the live rows,
-- because a removed report is never listed.
CREATE INDEX "product_report_queue_idx"
    ON "public"."product_report" ("status", "created_at" DESC, "id" DESC)
    WHERE "deleted_at" IS NULL;

-- Every report about one listing, for the detail view and for refusing a
-- repeat submission.
CREATE INDEX "product_report_listing_idx"
    ON "public"."product_report" ("listing_id")
    WHERE "deleted_at" IS NULL;

-- The unread count reads this and nothing else.
CREATE INDEX "product_report_unread_idx"
    ON "public"."product_report" ("status")
    WHERE "deleted_at" IS NULL AND "status" = 'new';

CREATE INDEX "produce_listing_farmer_idx"
    ON "public"."produce_listing" ("farmer_id")
    WHERE "deleted_at" IS NULL;

CREATE INDEX "produce_listing_browse_idx"
    ON "public"."produce_listing" ("status", "created_at" DESC)
    WHERE "deleted_at" IS NULL;

-- =============================================================================
-- ROW LEVEL SECURITY -- enabled, with no policies, as a deny-by-default
-- backstop. Every read and write goes through a route that calls requireRole;
-- RLS is never the primary control (CLAUDE.md section 4).
-- =============================================================================

ALTER TABLE "public"."produce_listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_report"  ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS -- soft-deleted rows appear in no list, count, export or report.
-- security_invoker = true so the view carries the caller's rights, not the
-- definer's.
-- =============================================================================

CREATE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."product_report_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."product_report" WHERE "deleted_at" IS NULL;

-- =============================================================================
-- audit_event: five more action keys. Generated from AUDIT_ACTIONS in
-- packages/shared/src/audit.ts -- the list and this constraint change together
-- in one commit, which is what makes the pair reviewable.
-- =============================================================================

ALTER TABLE "public"."audit_event" DROP CONSTRAINT "audit_event_action_known";

ALTER TABLE "public"."audit_event" ADD CONSTRAINT "audit_event_action_known" CHECK (
    "action" IN (
        'user.created', 'user.updated', 'user.password_set', 'user.soft_deleted',
        'officer.created', 'officer.updated', 'officer.status_changed',
        'officer.password_set', 'officer.soft_deleted',
        'auth.disabled', 'auth.disable_failed', 'auth.account_orphaned',
        'location.created', 'location.renamed', 'location.soft_deleted',
        'farmer.created', 'farmer.updated', 'farmer.soft_deleted',
        'consent.recorded', 'farmer.verified', 'farmer.rejected', 'farmer.merged',
        'farmer.resubmitted', 'farmer.reassigned',
        'farm.created', 'farm.boundary_added', 'farm.boundary_superseded',
        'farm.crops_declared', 'farm.soft_deleted', 'farm.repointed',
        'visit.recorded', 'visit.corrected', 'visit.soft_deleted',
        'visit.attachment_declared', 'visit.attachment_arrived',
        'visit.attachment_failed', 'visit.attachment_link_issued', 'visit.repointed',
        'report.exported', 'system.restored',
        'directory_entry.created', 'directory_entry.updated', 'directory_entry.soft_deleted',
        'learning_resource.created', 'learning_resource.updated',
        'learning_resource.published', 'learning_resource.soft_deleted',
        'product_report.created',
        'product_report.status_changed',
        'product_report.listing_removed',
        'communication.email_sent',
        'communication.send_failed'
    ));

-- A NOTE FOR WHOEVER APPLIES THIS TO STAGING.
--
-- The list above equals AUDIT_ACTIONS exactly, which is what a fresh database
-- must end up with and what packages/shared/tests/audit-check-matches-migrations
-- asserts. Staging is a special case: B12 (PR #93, open, not merged) has already
-- been applied there and has written rows carrying `weather_location.created`.
-- Rebuilding this constraint against that data fails, because a CHECK is
-- validated against every existing row.
--
-- That key is NOT added here. It belongs to B12 and arrives with B12's own
-- change to AUDIT_ACTIONS, CONVENTIONS section 5.2.2 and its migration -- the
-- procedure this project requires for any new action key. Staging will accept
-- this migration once #93 merges, or once its test rows are gone.

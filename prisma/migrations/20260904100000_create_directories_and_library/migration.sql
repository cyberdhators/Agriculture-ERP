-- Migration 6 -- unit P1, the three directories and the learning library
--
-- Criteria C-13.1 to C-13.9 in docs/scope-and-acceptance.md.
-- Shapes from docs/data-model-extension.md sections 3 and 4.
--
-- Deliverables (i), (j) and (k) are ONE typed table, directory_entry, because
-- they are the same thing with a different label: a named place with a phone
-- number that a farmer can be sent to. Deliverable (m) is learning_resource.
--
-- Both are reference data maintained by an administrator and read by officers.
-- Neither is transactional. Nothing here holds a balance, a loan, an
-- enrolment or a score, and nothing here ever should -- see the scope note in
-- docs/scope-and-acceptance.md.
--
-- The four patterns from migration 5 are copied, not reinterpreted:
--   1. RLS enabled in the same migration, no policies.
--   2. Views WITH (security_invoker = true).
--   3. deleted_at / deleted_by on every table.
--   4. Denormalised state_id, enforced by a composite foreign key.
--
-- Three enum types created here are SHARED with later units and must not be
-- recreated there: `crop` (crop_declaration, B5/B7), `language` (consent, B5)
-- and nothing else. They are listed in docs/HANDOFF.md.

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE "public"."directory_entry_type" AS ENUM (
    'agro_dealer',
    'input_supplier',
    'financial_service'
);

-- Financial services only. A bank and a mobile-money agent are both places a
-- farmer can be sent to; the class is what tells the farmer which.
CREATE TYPE "public"."financial_provider_class" AS ENUM (
    'bank',
    'microfinance',
    'mobile_money',
    'cooperative_sacco',
    'other'
);

CREATE TYPE "public"."learning_topic" AS ENUM (
    'crop_production',
    'livestock',
    'pest_disease',
    'post_harvest',
    'marketing',
    'cooperative',
    'climate',
    'other'
);

-- SHARED. The five project crops from docs/data-model.md. crop_declaration
-- reuses this type; it does not create its own.
CREATE TYPE "public"."crop" AS ENUM (
    'sorghum',
    'groundnut',
    'sesame',
    'maize',
    'cowpea'
);

-- SHARED. The two interface languages from docs/data-model.md. consent reuses
-- this type. The hyphen in 'ar-juba' is deliberate and matches the model.
CREATE TYPE "public"."language" AS ENUM (
    'en',
    'ar-juba'
);

CREATE TYPE "public"."resource_format" AS ENUM (
    'pdf',
    'image',
    'audio',
    'video'
);

-- =============================================================================
-- PAYAM: the composite target every scoped table needs
-- =============================================================================
--
-- Migration 5 put UNIQUE (id, state_id) on county so that payam could carry a
-- composite foreign key proving its state matches its county's. Every table
-- below payam that carries a denormalised state_id (extension 1.4) needs the
-- same target on payam. This is the first such table, so the constraint is
-- added here, once. B5 (farmer), B8 (visit_note) and the rest reuse it.
--
-- Additive: a unique constraint on columns that are already unique together
-- (id is the primary key). It cannot fail against existing rows.

-- IDEMPOTENT ON PURPOSE, and this is not a style choice.
--
-- Both lanes wrote this ALTER independently: Lane 1 needed it in B3's migration
-- 6 so `officer` could carry a composite key to payam, and Lane 2 needed it
-- here for `directory_entry`. Neither could see the other, because
-- docs/HANDOFF.md -- the file whose shared-objects register exists to prevent
-- exactly this -- was not on main.
--
-- Whichever of the two applies second would fail with "constraint already
-- exists" and leave the migration history in a failed state. Guarding it means
-- this migration applies whether B3 landed before it or after it.
--
-- Do NOT copy this pattern for ordinary constraints. It is here because two
-- migrations legitimately need the same additive constraint and neither can
-- assume the other has run.
DO $$
BEGIN
    ALTER TABLE "public"."payam"
        ADD CONSTRAINT "payam_id_state_id_key" UNIQUE ("id", "state_id");
EXCEPTION
    WHEN duplicate_table OR duplicate_object THEN
        NULL;
END
$$;

-- =============================================================================
-- DIRECTORY ENTRY  (i) (j) (k)
-- =============================================================================

CREATE TABLE "public"."directory_entry" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "entry_type"       "public"."directory_entry_type" NOT NULL,
    "name"             TEXT        NOT NULL,
    "description"      TEXT,
    -- Free text tags: seeds, fertiliser, savings, microloan. Not an enum,
    -- because the set is CORWADO's to grow without a migration.
    "services"         TEXT[]      NOT NULL DEFAULT '{}',
    "contact_name"     TEXT,
    -- E.164, +211 and nine digits, the only form the API stores or returns.
    -- The CHECK mirrors parseSouthSudanMobile in packages/shared exactly; if
    -- one changes the other must change with it.
    "phone"            TEXT        NOT NULL,
    "alt_phone"        TEXT,
    "email"            TEXT,
    "physical_address" TEXT,
    -- Where the place is, for the map. Nullable: many entries will be entered
    -- from a list with no coordinates. geography, not geometry, so distance
    -- comes back in metres without a projection step.
    -- SCHEMA-QUALIFIED. Migration 1 installed PostGIS into the "extensions"
    -- schema, not public, because that is where Supabase's own tooling looks
    -- for it. An unqualified `geography` is not on the migration connection's
    -- search_path and fails with `type "geography" does not exist`.
    -- Every spatial column from here on must qualify the type the same way.
    "location"         extensions.geography(Point, 4326),
    "payam_id"         TEXT        NOT NULL,
    -- Denormalised, per extension 1.4, so a supervisor scope check is not a
    -- join. The composite foreign key below keeps it honest.
    "state_id"         TEXT        NOT NULL,
    "provider_class"   "public"."financial_provider_class",
    -- A directory is worth exactly as much as its freshness (extension 3).
    "last_verified_at" DATE        NOT NULL,
    -- No foreign key yet: user does not exist until B3, which adds the
    -- constraint with ALTER TABLE. Same reasoning as deleted_by in migration 5.
    "verified_by"      UUID,
    "active"           BOOLEAN     NOT NULL DEFAULT true,
    "deleted_at"       TIMESTAMPTZ,
    "deleted_by"       UUID,

    CONSTRAINT "directory_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "directory_entry_name_not_blank" CHECK (btrim("name") <> ''),
    CONSTRAINT "directory_entry_phone_e164"
        CHECK ("phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "directory_entry_alt_phone_e164"
        CHECK ("alt_phone" IS NULL OR "alt_phone" ~ '^\+211[0-9]{9}$'),
    CONSTRAINT "directory_entry_email_shape"
        CHECK ("email" IS NULL OR "email" ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
    -- provider_class belongs to financial services and to nothing else.
    -- Required there, forbidden elsewhere: an entry cannot be a financial
    -- service of no particular kind, and a seed dealer cannot be a bank.
    CONSTRAINT "directory_entry_provider_class_matches_type" CHECK (
        ("entry_type" = 'financial_service' AND "provider_class" IS NOT NULL)
        OR ("entry_type" <> 'financial_service' AND "provider_class" IS NULL)
    ),
    CONSTRAINT "directory_entry_state_id_fkey"
        FOREIGN KEY ("state_id") REFERENCES "public"."state"("id"),
    CONSTRAINT "directory_entry_payam_state_consistent_fkey"
        FOREIGN KEY ("payam_id", "state_id")
        REFERENCES "public"."payam"("id", "state_id")
);

-- =============================================================================
-- LEARNING RESOURCE  (m)
-- =============================================================================

CREATE TABLE "public"."learning_resource" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "title"        TEXT        NOT NULL,
    "topic"        "public"."learning_topic" NOT NULL,
    "crop"         "public"."crop",
    "language"     "public"."language" NOT NULL,
    "format"       "public"."resource_format" NOT NULL,
    -- Path within the Supabase Storage bucket. The file itself never enters
    -- Postgres.
    "storage_path" TEXT        NOT NULL,
    -- Shown next to every download. An officer on a metered phone deserves to
    -- know a file is 40 MB before tapping it (extension 4).
    "byte_size"    INTEGER     NOT NULL,
    "description"  TEXT,
    -- Unpublished resources are visible to administrators only. New rows start
    -- unpublished so a half-uploaded file is never offered to an officer.
    "published"    BOOLEAN     NOT NULL DEFAULT false,
    -- Foreign key added in B3, as above.
    "uploaded_by"  UUID,
    "uploaded_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deleted_at"   TIMESTAMPTZ,
    "deleted_by"   UUID,

    CONSTRAINT "learning_resource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_resource_title_not_blank" CHECK (btrim("title") <> ''),
    CONSTRAINT "learning_resource_storage_path_not_blank"
        CHECK (btrim("storage_path") <> ''),
    CONSTRAINT "learning_resource_byte_size_positive" CHECK ("byte_size" > 0)
);

-- One live resource per stored file. A soft-deleted row releases its path so
-- the same file can be re-registered, which is why this is partial.
CREATE UNIQUE INDEX "learning_resource_storage_path_active_key"
    ON "public"."learning_resource" ("storage_path") WHERE "deleted_at" IS NULL;

-- =============================================================================
-- INDEXES
-- =============================================================================
--
-- The directory lookup an officer makes is "financial services in this payam
-- that are still active", which is the extension 10 index exactly. Partial
-- copies on deleted_at IS NULL because every read goes through an _active view.

CREATE INDEX "directory_entry_lookup_idx"
    ON "public"."directory_entry" ("entry_type", "payam_id", "active");
CREATE INDEX "directory_entry_lookup_active_idx"
    ON "public"."directory_entry" ("entry_type", "payam_id", "active")
    WHERE "deleted_at" IS NULL;
CREATE INDEX "directory_entry_state_id_idx"
    ON "public"."directory_entry" ("state_id");
CREATE INDEX "directory_entry_state_id_active_idx"
    ON "public"."directory_entry" ("state_id") WHERE "deleted_at" IS NULL;

-- Spatial: "nearest agro-dealer to this farm". Not modelled in
-- prisma/schema.prisma, because the column is Unsupported there.
CREATE INDEX "directory_entry_location_gist_idx"
    ON "public"."directory_entry" USING GIST ("location");

CREATE INDEX "learning_resource_browse_active_idx"
    ON "public"."learning_resource" ("topic", "language", "published")
    WHERE "deleted_at" IS NULL;
CREATE INDEX "learning_resource_crop_active_idx"
    ON "public"."learning_resource" ("crop") WHERE "deleted_at" IS NULL;

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
--
-- Enabled with no policies: deny-by-default. Supabase reports
-- rls_enabled_no_policy at INFO. Intended. Do not add a permissive policy.

ALTER TABLE "public"."directory_entry"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."learning_resource" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- ACTIVE VIEWS
-- =============================================================================
--
-- _active means NOT SOFT-DELETED, exactly as in migration 5. It does not filter
-- directory_entry.active or learning_resource.published, which are
-- administrative flags a caller filters itself. security_invoker = true is
-- load-bearing; see migration 5.

CREATE VIEW "public"."directory_entry_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."directory_entry" WHERE "deleted_at" IS NULL;

CREATE VIEW "public"."learning_resource_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."learning_resource" WHERE "deleted_at" IS NULL;

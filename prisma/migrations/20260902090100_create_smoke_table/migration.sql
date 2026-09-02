-- Migration 2 -- unit B1.3
--
-- =============================================================================
-- RULE FOR EVERY MIGRATION THAT CREATES A TABLE, FROM NOW ON
-- =============================================================================
-- Create the table AND enable row-level security on it, in the same migration,
-- with no policies.
--
-- RLS with no policies is deny-by-default. It is the backstop against the anon
-- and authenticated Supabase keys, which reach the database directly from
-- clients. Our own server connects as owner and bypasses it deliberately;
-- authorisation there is enforced by requireRole in the API routes.
--
-- A table shipped without RLS is a hole that anyone holding the anon key can
-- read. This is not optional, and it is not a follow-up task. Same migration,
-- every time.
-- =============================================================================
--
-- _smoke is a throwaway table for this unit only. It holds one meaningless row,
-- is not part of the data model, and is dropped in migration 3.

CREATE TABLE "public"."_smoke" (
    "id"   SERIAL NOT NULL,
    "note" TEXT   NOT NULL,

    CONSTRAINT "_smoke_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."_smoke" ENABLE ROW LEVEL SECURITY;

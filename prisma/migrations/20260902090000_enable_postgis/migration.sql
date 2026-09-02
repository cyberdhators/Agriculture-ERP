-- Migration 1 -- unit B1.3
--
-- PostGIS goes in the "extensions" schema, NOT in public. That is where
-- Supabase expects it and where its own tooling looks for it. Installing it
-- into public works right up until Supabase tooling cannot find it.
--
-- The "extensions" schema already exists on a Supabase project; this
-- migration does not create it.

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

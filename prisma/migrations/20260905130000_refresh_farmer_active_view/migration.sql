-- Migration 12 (B6): farmer_active learns the column migration 11 added.
--
-- A `SELECT *` view freezes its column list at creation. farmer_active was
-- created in migration 10; migration 11 added farmer.pending_since; every
-- farmer query reads the view, and every one failed with "column
-- f.pending_since does not exist" (B6 run 1, 2026-09-05). CREATE OR REPLACE
-- may append columns, which is all this needs. The rule that follows: a
-- migration that adds a column to a table with an _active view recreates the
-- view in the same migration, and tests/views-track-tables.test.ts refuses
-- any view whose columns differ from its table's.
CREATE OR REPLACE VIEW "public"."farmer_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."farmer" WHERE "deleted_at" IS NULL;

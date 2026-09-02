-- Migration 3 -- unit B1.3
--
-- Drops the throwaway _smoke table. This is the proof the unit exists to
-- produce: that a migration applies and reverses.
--
-- =============================================================================
-- THIS DROP IS SPECIFICALLY AUTHORISED. THE AUTHORISATION DOES NOT GENERALISE.
-- =============================================================================
-- CLAUDE.md section 5 requires work to stop and ask before any migration that
-- drops a column or table, changes a type, or could lose data. That was done,
-- and this drop was authorised explicitly: _smoke is a throwaway table created
-- in this same unit, holding one meaningless row.
--
-- The authorisation covers THIS MIGRATION ONLY. It extends to no other table.
-- Any future drop is a fresh stop-and-ask, every time.
-- =============================================================================

DROP TABLE "public"."_smoke";

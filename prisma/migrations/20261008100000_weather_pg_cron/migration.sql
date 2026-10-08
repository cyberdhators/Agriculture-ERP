-- 2026-10-08: the hourly weather fetch runs from the database's own scheduler.
-- GitHub's scheduler ran the job every 4-8 hours in practice (OBSERVED in its
-- run history), so pg_cron calls POST /api/cron/weather every hour through
-- pg_net. Additive: two Supabase-provided extensions, nothing of ours changes.
-- The job itself carries a secret and is installed by
-- scripts/weather-cron-install.mjs, never by a migration file.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

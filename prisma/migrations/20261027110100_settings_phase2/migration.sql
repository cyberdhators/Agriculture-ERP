-- 2026-10-27 -- SETTINGS, PHASE 2 (CORWADO's 16 October specification, the
-- Settings table: language and region, registration and recovery, profile
-- privacy, marketplace and reference lists, notifications and moderation).
-- docs/DECISIONS.md, "Settings, phase 2".
--
-- ADDITIVE IN EFFECT: the known-key CHECK of setting_version is widened to
-- admit five more keys. Every key it admitted before is still admitted, in
-- the same order; no row changes, and nothing is seeded -- a key never saved
-- reads as its fallback (SETTING_DEFAULTS), which is what the code did before.
--
-- NO AUDIT CHECK HERE: a phase-2 save is audited as 'setting.changed', the
-- phase-1 key.

ALTER TABLE "public"."setting_version"
    DROP CONSTRAINT "setting_version_key_known";

-- SETTING_KEYS in packages/shared/src/settings.ts.
ALTER TABLE "public"."setting_version"
    ADD CONSTRAINT "setting_version_key_known" CHECK ("key" IN (
        'identity', 'support', 'maintenance', 'reason_codes', 'language_region', 'registration_recovery', 'profile_privacy', 'reference_lists', 'notifications_moderation'
    ));

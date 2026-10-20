/**
 * PUBLIC PROFILES V2 (2026-10-23): which profiles the public may see, as SQL
 * text over `account_profile ap`. In a module of its own, with no imports, so
 * that lib/api/market-posts.ts (the report targets) and lib/api/public-profile.ts
 * (which reads market posts) can both use it without importing each other.
 *
 * Read by apps/web/tests/public-profile-scan.test.ts.
 */

/** The account behind `ap` is live: a record not removed or suspended, and none suspended. */
export const PROFILE_ACCOUNT_LIVE = `(
  (EXISTS (SELECT 1 FROM public.farmer_active fa
            WHERE fa.auth_user_id = ap.auth_user_id AND fa.suspended_at IS NULL)
   OR EXISTS (SELECT 1 FROM public.buyer_active ba
               WHERE ba.auth_user_id = ap.auth_user_id AND ba.suspended_at IS NULL))
  AND NOT EXISTS (SELECT 1 FROM public.farmer_active fs
                   WHERE fs.auth_user_id = ap.auth_user_id AND fs.suspended_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.buyer_active bs
                   WHERE bs.auth_user_id = ap.auth_user_id AND bs.suspended_at IS NOT NULL)
)`;

/** What the public may see: published, and the account live. */
export const PUBLIC_PROFILE_WHERE = `ap.status = 'published' AND ${PROFILE_ACCOUNT_LIVE}`;

-- 2026-11-01 (lane-noticelinks, written 2026-10-26) -- AN EXACT "LAST SEEN".
-- docs/DECISIONS.md, "Online status: exact last seen, live in an open chat".
--
-- account_activity.last_seen_at moves at most every five minutes on API calls,
-- so "Active ... ago" could only be coarse. The app now tells the server the
-- moment it is closed or hidden (POST /api/account/presence/bye, at most once
-- per account per 30 seconds), and that exact time is kept here and preferred
-- over the coarse stamp unless the stamp is newer (shared presence.ts
-- lastSeenOf). Shown only under the reciprocal "Show when I'm active" rule.
--
-- ADDITIVE ONLY: one nullable column; every existing row keeps NULL and reads
-- as before. A time only: no device, address or page. No audit key.

ALTER TABLE "public"."account_activity"
    ADD COLUMN "presence_seen_at" TIMESTAMPTZ;

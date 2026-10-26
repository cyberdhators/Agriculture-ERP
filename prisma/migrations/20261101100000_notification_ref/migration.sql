-- 2026-11-01 (lane-noticelinks, written 2026-10-26) -- WHAT A STORED NOTICE
-- POINTS AT. docs/DECISIONS.md, "A stored notice opens the exact post or
-- conversation".
--
-- Live test: a match alert tapped in the NOTIFICATIONS LIST opened the
-- general market page, while the same notice's live pop opened the exact
-- buying request or listing -- the live event carries ref_kind/ref_id
-- (lib/api/notify.ts), the stored row did not. The row now keeps them.
--
-- ADDITIVE ONLY: two nullable columns on public.notification. Every existing
-- row keeps NULL and opens where it always did. Ids only: a post's or a
-- conversation's id, never its text. No view selects from notification, so
-- none is recreated. No audit key is added.

ALTER TABLE "public"."notification"
    ADD COLUMN "ref_kind" TEXT,
    ADD COLUMN "ref_id"   UUID;

-- The kinds are NOTICE_REF_KINDS in packages/shared/src/realtime.ts.
ALTER TABLE "public"."notification"
    ADD CONSTRAINT "notification_ref_kind_known" CHECK (
        "ref_kind" IS NULL OR "ref_kind" IN ('buying_request', 'listing', 'conversation')
    ),
    ADD CONSTRAINT "notification_ref_whole" CHECK (
        ("ref_kind" IS NULL) = ("ref_id" IS NULL)
    );

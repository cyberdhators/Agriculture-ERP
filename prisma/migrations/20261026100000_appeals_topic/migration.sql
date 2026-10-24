-- 2026-10-26 -- APPEALS (CORWADO's acceptance test of 24 October; the
-- specification: "Moderation and recovery: Suspend with reason/notification,
-- review appeal and restore"). docs/DECISIONS.md, "Notices for decisions,
-- restores, new conversations and advice updates".
--
-- An appeal is a "Contact CORWADO" message with the topic 'appeal' ("Appeal a
-- decision"). No new table, no ticket: helpdesk ticketing stays out of scope
-- (CLAUDE.md section 2).
--
-- DATA-SAFE: the topic CHECK is replaced by one that accepts every value the
-- old one did, plus 'appeal' (SUPPORT_TOPICS in packages/shared/src/support.ts).
-- Every existing row satisfies the new CHECK, so adding it cannot fail and no
-- row changes. Both statements run in the migration's one transaction, so
-- there is no moment without the CHECK.
--
-- NO AUDIT CHECK HERE: this change adds no audit key.

ALTER TABLE "public"."support_message"
    DROP CONSTRAINT "support_message_topic";

ALTER TABLE "public"."support_message"
    ADD CONSTRAINT "support_message_topic" CHECK (
        "topic" IN ('account', 'marketplace', 'messages', 'technical', 'appeal', 'other')
    );

-- The staff Appeals view reads new appeals first.
CREATE INDEX "support_message_appeal_created_idx"
    ON "public"."support_message" ("created_at" DESC)
    WHERE "topic" = 'appeal' AND "deleted_at" IS NULL;

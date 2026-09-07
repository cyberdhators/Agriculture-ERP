-- Migration 13: the four foreign keys owed on P1's tables since B3.
--
-- P1 (migration 6) created directory_entry and learning_resource before the
-- user table existed, so verified_by, uploaded_by and deleted_by were plain
-- uuids "until B3 adds the constraint" (DECISIONS, B2). B3 added user; B4
-- said the keys "land next"; nothing landed. Found by the pre-B7 audit on
-- 2026-09-05 by asking the catalogue, not the record. Additive.
ALTER TABLE "public"."directory_entry"
    ADD CONSTRAINT "directory_entry_verified_by_fkey"
        FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "directory_entry_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");
ALTER TABLE "public"."learning_resource"
    ADD CONSTRAINT "learning_resource_uploaded_by_fkey"
        FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id"),
    ADD CONSTRAINT "learning_resource_deleted_by_fkey"
        FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id");

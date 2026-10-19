-- 2026-10-20 -- phone numbers only if the poster chooses (CORWADO's 16 October
-- specification: "deliberate public contact choices"; the owner, 2026-10-19:
-- "Only if the seller chooses"). In-app messaging (20261020090000) is now the
-- default way to reach someone about a post.
--
-- ADDITIVE: one boolean per kind of post. EXISTING ROWS ARE TRUE, so a deal
-- already in progress keeps the phone both sides were promised under consent
-- text v1.2. NEW ROWS DEFAULT TO FALSE: a phone is shown only when the poster
-- ticks "Show my phone number". The poster can change it on any post.

ALTER TABLE "public"."produce_listing"
    ADD COLUMN "show_phone" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."produce_listing"
    ALTER COLUMN "show_phone" SET DEFAULT false;

ALTER TABLE "public"."buying_request"
    ADD COLUMN "show_phone" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."buying_request"
    ALTER COLUMN "show_phone" SET DEFAULT false;

ALTER TABLE "public"."service_listing"
    ADD COLUMN "show_phone" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."service_listing"
    ALTER COLUMN "show_phone" SET DEFAULT false;

-- Each table gained a column, and a SELECT * view froze its column list when
-- it was created (DECISIONS, "A view is a filter of its table"). Recreated, as
-- 20261019100000 did.
DROP VIEW IF EXISTS "public"."produce_listing_active";
CREATE VIEW "public"."produce_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."produce_listing" WHERE "deleted_at" IS NULL;

DROP VIEW IF EXISTS "public"."buying_request_active";
CREATE VIEW "public"."buying_request_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."buying_request" WHERE "deleted_at" IS NULL;

DROP VIEW IF EXISTS "public"."service_listing_active";
CREATE VIEW "public"."service_listing_active" WITH (security_invoker = true) AS
    SELECT * FROM "public"."service_listing" WHERE "deleted_at" IS NULL;

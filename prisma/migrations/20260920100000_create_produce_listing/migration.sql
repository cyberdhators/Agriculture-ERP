-- Deliverable (g): produce listings — the marketplace.
-- A farmer posts what they have; a buyer sees it; the extension officer
-- introduces them. The listing publishes no personal data: `trading_name` is a
-- farm or stall name the farmer chose, never their legal name.
--
-- The table and the listing_status/listing_category enums already exist from
-- migration 20260917, which created a simpler version. This migration adds the
-- marketplace columns and the listing_unit enum.

-- listing_unit is new.
DO $$ BEGIN
  CREATE TYPE listing_unit AS ENUM (
    'kg', 'bag_50kg', 'bag_100kg', 'sack', 'crate',
    'bunch', 'piece', 'head', 'litre', 'tin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add the marketplace columns the earlier migration did not include.
ALTER TABLE produce_listing
  ADD COLUMN IF NOT EXISTS description     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit            listing_unit NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS price_ssp       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_per       listing_unit NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS negotiable      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_storage_paths TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS available_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS available_until DATE,
  ADD COLUMN IF NOT EXISTS harvest_season  TEXT,
  ADD COLUMN IF NOT EXISTS pickup_notes    TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone   TEXT NOT NULL DEFAULT '+21100000000',
  ADD COLUMN IF NOT EXISTS delivery_available BOOLEAN NOT NULL DEFAULT false;

-- Add CHECK constraints (safe to add — they validate against defaults).
ALTER TABLE produce_listing
  ADD CONSTRAINT produce_listing_description_len
    CHECK (char_length(description) <= 1000);

ALTER TABLE produce_listing
  ADD CONSTRAINT produce_listing_quantity_positive
    CHECK (quantity > 0);

ALTER TABLE produce_listing
  ADD CONSTRAINT produce_listing_price_nonneg
    CHECK (price_ssp >= 0);

ALTER TABLE produce_listing
  ADD CONSTRAINT produce_listing_phone_format
    CHECK (contact_phone ~ '^\+211[0-9]{9}$');

-- RLS was likely already enabled; idempotent.
ALTER TABLE produce_listing ENABLE ROW LEVEL SECURITY;

-- Indexes already exist from migration 20260917 (produce_listing_farmer_idx,
-- produce_listing_browse_idx). No need to recreate.

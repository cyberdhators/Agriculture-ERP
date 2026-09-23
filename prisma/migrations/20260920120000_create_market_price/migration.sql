-- Deliverable (n): commodity prices. Staff record the going rate for a
-- commodity at a named market; farmers see the latest prices for their state.

CREATE TABLE market_price (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity   TEXT           NOT NULL,
  market_name TEXT           NOT NULL,
  price_ssp   NUMERIC(12,2)  NOT NULL CHECK (price_ssp >= 0),
  unit        listing_unit   NOT NULL,
  recorded_on DATE           NOT NULL,
  state_id    TEXT           NOT NULL REFERENCES state(id),
  created_by  UUID           REFERENCES "user"(id),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ(6),
  deleted_by  UUID           REFERENCES "user"(id)
);

ALTER TABLE market_price ENABLE ROW LEVEL SECURITY;

CREATE INDEX market_price_browse_idx
  ON market_price (state_id, recorded_on DESC)
  WHERE deleted_at IS NULL;

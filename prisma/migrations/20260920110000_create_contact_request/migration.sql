-- Deliverable (g): buyer–seller matching. A buyer leaves name, phone and what
-- they want; the farmer's caseload officer calls both and records the
-- introduction. The buyer holds no account — what they give at the moment of
-- interest IS the record.

CREATE TYPE contact_status AS ENUM ('new', 'introduced', 'declined', 'no_answer');

CREATE TABLE contact_request (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID           NOT NULL REFERENCES produce_listing(id),
  farmer_id   UUID           NOT NULL REFERENCES farmer(id),
  buyer_name  TEXT           NOT NULL CHECK (char_length(buyer_name) BETWEEN 2 AND 80),
  buyer_phone TEXT           NOT NULL CHECK (buyer_phone ~ '^\+211[0-9]{9}$'),
  message     TEXT           CHECK (message IS NULL OR char_length(message) <= 300),
  quantity    TEXT           CHECK (quantity IS NULL OR char_length(quantity) <= 40),
  status      contact_status NOT NULL DEFAULT 'new',
  note        TEXT,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  handled_at  TIMESTAMPTZ(6),
  handled_by  UUID           REFERENCES "user"(id)
);

ALTER TABLE contact_request ENABLE ROW LEVEL SECURITY;

CREATE INDEX contact_request_listing_idx
  ON contact_request (listing_id, created_at DESC);

CREATE INDEX contact_request_farmer_idx
  ON contact_request (farmer_id, created_at DESC);

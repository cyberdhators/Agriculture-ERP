-- Deliverable (p): notifications. In-app and SMS. A notification is created by
-- the system (weather alert, contact request, verification outcome) and
-- delivered to the farmer. SMS is sent via Bird when the channel is 'sms'.

CREATE TYPE notification_channel AS ENUM ('sms', 'in_app');

CREATE TABLE notification (
  id         UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id  UUID                 NOT NULL REFERENCES farmer(id),
  channel    notification_channel NOT NULL DEFAULT 'in_app',
  title      TEXT                 NOT NULL,
  body       TEXT                 NOT NULL,
  read_at    TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6)       NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ(6)
);

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;

CREATE INDEX notification_farmer_unread_idx
  ON notification (farmer_id, created_at DESC)
  WHERE deleted_at IS NULL AND read_at IS NULL;

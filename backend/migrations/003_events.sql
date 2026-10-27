-- STORY-01 (development-stories.md): local event queue + sync protocol.
-- client_event_id is the idempotency key offline-sync-spec.md §4 step 3
-- requires — a retried/duplicate flush after a dropped connection must not
-- double-insert. ts is the device-reported, authoritative timestamp;
-- ingested_at is server-side, for audit/debugging only (§4 step 2).

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  client_event_id TEXT NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  client_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  ts TIMESTAMPTZ NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_event_id)
);

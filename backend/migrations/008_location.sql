-- STORY-13 (development-stories.md): F4 location + geofence alerts.
-- offline-sync-spec.md §2: "Partial offline" — entry/exit is detected
-- locally on the device (this table is just the history log the agent
-- reports), the human-facing alert is a normal alert_event flushed
-- through the SAME EventQueue mechanism STORY-01 already built, not a
-- new one.

CREATE TABLE IF NOT EXISTS location_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  client_event_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  geofence_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_event_id)
);

-- geofence_rules shape: [{id, name, lat, lon, radius_meters}] — the agent
-- does the point-in-circle math itself against this, on-device, zero
-- round-trip (same local-first pattern as F1/F2/F3).
ALTER TABLE policies ADD COLUMN IF NOT EXISTS geofence_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Retention (STORY-13's review requirement, product-spec.md §9's data-
-- minimization principle): raw lat/lon history is exactly the kind of
-- sensitive data a stated retention window matters most for. Stated
-- here, NOT yet enforced — no auto-purge job exists for this table or
-- any other event table yet; that's a cross-cutting piece of work
-- (product-spec.md §9 names it generally), not something to build
-- narrowly for this one table as a side effect of this story. Target:
-- 90 days raw, matching the default usage-data retention employer-
-- tier-spec.md §6 already names for a comparable case.

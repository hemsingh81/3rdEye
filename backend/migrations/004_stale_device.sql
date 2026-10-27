-- STORY-03 (development-stories.md): X9 stale-device alert
-- (offline-sync-spec.md §5). A device can legitimately stay offline
-- indefinitely (local-first enforcement keeps working) but nothing was
-- proactively flagging the silence itself until now.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS stale_device_alert_threshold_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false;

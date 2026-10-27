-- STORY-09 (development-stories.md): ChildProfile + re-key Policy from
-- device to child. system-architecture-spec.md §3 specs Policy keyed by
-- child_profile_id; migration 002 diverged (device_id PK) because Phase 1
-- never needed more than one device per family. F7 (multi-child/multi-
-- device) is exactly the feature that makes that divergence matter: a
-- child with a phone and a laptop should share one set of rules.

CREATE TABLE IF NOT EXISTS child_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id),
  name TEXT NOT NULL,
  age_band TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS child_profile_id UUID REFERENCES child_profiles(id);

-- Re-key policies: drop the old device_id-keyed table and recreate it
-- keyed by child_profile_id instead. Guarded so this only runs once —
-- migrate.ts re-applies every migration file on every run (no tracking
-- table), so an unconditional DROP here would wipe policy data on every
-- restart, not just the first time this migration runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'policies' AND column_name = 'device_id'
  ) THEN
    DROP TABLE policies;
  END IF;
END $$;

-- Phase 1 has no real (pre-launch) data to preserve — dropping and
-- recreating is the smallest-complete move; a data-migrating ALTER would
-- be solving a problem that doesn't exist yet.
CREATE TABLE IF NOT EXISTS policies (
  child_profile_id UUID PRIMARY KEY REFERENCES child_profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 120,
  bedtime_start TIME,
  bedtime_end TIME,
  content_filter_categories TEXT[] NOT NULL DEFAULT ARRAY['adult', 'violence', 'gambling'],
  stale_device_alert_threshold_hours INTEGER NOT NULL DEFAULT 24,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

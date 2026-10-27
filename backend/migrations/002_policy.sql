-- Phase 1 scope only: F1 (screen time + lockout) and F2 (category-blocklist
-- content filtering). Per-app limits, custom filter lists, and geofencing are
-- deferred to Phase 2 (mvp-build-plan.md §4).

CREATE TABLE IF NOT EXISTS policies (
  device_id UUID PRIMARY KEY REFERENCES devices(id),
  version INTEGER NOT NULL DEFAULT 1,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 120,
  bedtime_start TIME,
  bedtime_end TIME,
  content_filter_categories TEXT[] NOT NULL DEFAULT ARRAY['adult', 'violence', 'gambling'],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

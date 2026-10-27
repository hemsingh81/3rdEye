-- STORY-10 (development-stories.md): F3 app control backend. Only the
-- install gate + block-from-running data model — remote uninstall is NOT
-- built here (not available on any platform without Fleet-tier MDM, per
-- feature-list.md's correction in commit 207e5a7).

ALTER TABLE policies ADD COLUMN IF NOT EXISTS app_control_mode TEXT NOT NULL DEFAULT 'default_deny';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS app_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb;

-- One row per (device, app) — the agent reports its inventory periodically;
-- UNIQUE lets a re-report upsert (update detected_at) instead of
-- duplicating. is_approved is deliberately NOT a stored column here: it's
-- derived from policies.app_allowlist at read time, so there's exactly one
-- source of truth for approval state, not two that could drift apart.
CREATE TABLE IF NOT EXISTS installed_app_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  app_id TEXT NOT NULL,
  install_source TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, app_id)
);

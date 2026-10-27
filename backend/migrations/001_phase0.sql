-- Phase 0 schema: only what the exit criterion needs —
-- enroll a device, show + record consent, list it in a dashboard.
-- ChildProfile/Policy/event tables arrive with Phase 1 (per mvp-build-plan.md §2-3).

CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'macos', 'windows')),
  enrollment_code TEXT NOT NULL UNIQUE,
  enrollment_status TEXT NOT NULL DEFAULT 'pending' CHECK (enrollment_status IN ('pending', 'enrolled')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  policy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by TEXT NOT NULL
);

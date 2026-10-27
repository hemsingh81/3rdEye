-- STORY-16 (development-stories.md): jurisdiction-aware consent gating,
-- groundwork for Employer tier (employer-tier-spec.md §6) reusing the same
-- mechanism later — generic by design, not Family-tier-specific wording.

-- Nullable: most jurisdictions have no mandatory-notice requirement for
-- Family tier today, so null is a valid "no gate needed" state, not
-- missing data.
ALTER TABLE families ADD COLUMN IF NOT EXISTS jurisdiction TEXT;

-- Data, not code — a jurisdiction's requirements changing shouldn't need a
-- deploy. Deliberately small for Family tier today (per this story's
-- Analyze note); Employer tier (Phase 4) hangs its own, larger table off
-- the same shape.
CREATE TABLE IF NOT EXISTS jurisdiction_notice_requirements (
  jurisdiction TEXT PRIMARY KEY,
  required_features TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO jurisdiction_notice_requirements (jurisdiction, required_features)
VALUES ('US-CA', ARRAY['location'])
ON CONFLICT (jurisdiction) DO NOTHING;

-- Reuses consent_records (Phase 0) rather than inventing a parallel
-- mechanism, per this story's Code note. NULL feature = the existing
-- device-enrollment consent semantics, untouched; a non-null feature marks
-- a jurisdiction-notice acceptance for that gated feature instead.
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS feature TEXT;

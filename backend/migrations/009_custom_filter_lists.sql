-- STORY-15 (development-stories.md): custom content-filter lists. Extends
-- implementation-plan.md §1.6's DNS-filter decision — custom domains are
-- matched the same way the embedded category sample list already is,
-- just parent-editable instead of hardcoded. An explicit allow always
-- wins over a category match (a parent overriding an over-broad category).

ALTER TABLE policies ADD COLUMN IF NOT EXISTS custom_blocked_domains TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS custom_allowed_domains TEXT[] NOT NULL DEFAULT '{}';

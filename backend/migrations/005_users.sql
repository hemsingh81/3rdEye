-- STORY-04 (development-stories.md): Admin Console auth. Closes a live
-- gap — GET /api/devices?family_id= previously returned any family's
-- devices to anyone who knew the UUID (system-architecture-spec.md §2.1).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

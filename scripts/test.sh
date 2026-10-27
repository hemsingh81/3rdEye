#!/usr/bin/env bash
# Runs the backend self-check (backend/src/test.ts) against an already-
# running dev server (start one with ./dev.sh in another terminal first).
set -euo pipefail
cd "$(dirname "$0")/../backend"
# STORY-03 added a direct-pool assertion to test.ts (backdating
# last_synced_at), so this needs DATABASE_URL too, not just BASE_URL.
export BASE_URL="${BASE_URL:-http://localhost:8097}"
export DATABASE_URL="${DATABASE_URL:-postgres://3rdeye:3rdeye@localhost:15432/3rdeye}"
# STORY-04: must match dev.sh's JWT_SECRET so test.ts's manually-crafted
# tokens are verified against the same secret the running server uses.
export JWT_SECRET="${JWT_SECRET:-dev-only-insecure-secret-do-not-use-in-production}"
npm test

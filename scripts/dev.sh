#!/usr/bin/env bash
# Full local dev loop: bring up Postgres (idempotent — safe if already up),
# migrate, then run the backend with auto-reload.
set -euo pipefail
cd "$(dirname "$0")"
./podman-up.sh
./migrate.sh
cd ../backend
export DATABASE_URL="${DATABASE_URL:-postgres://3rdeye:3rdeye@localhost:15432/3rdeye}"
# 8080 collides with Podman's own gvproxy on this machine (confirmed live —
# a request to :8080 silently hit gvproxy instead of this server); 8097 is
# deliberately uncommon.
export PORT="${PORT:-8097}"
# STORY-04: dev-only, insecure default — matches jwt.ts's own fallback, kept
# explicit here so dev.sh and test.sh are guaranteed to share one secret.
export JWT_SECRET="${JWT_SECRET:-dev-only-insecure-secret-do-not-use-in-production}"
npm run dev

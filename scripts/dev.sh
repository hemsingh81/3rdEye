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
npm run dev

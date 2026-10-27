#!/usr/bin/env bash
# Full local dev loop: bring up Postgres (idempotent — safe if already up),
# migrate, then run the backend with auto-reload.
set -euo pipefail
cd "$(dirname "$0")"
./podman-up.sh
./migrate.sh
cd ../backend
export DATABASE_URL="${DATABASE_URL:-postgres://3rdeye:3rdeye@localhost:15432/3rdeye}"
export PORT="${PORT:-8080}"
npm run dev

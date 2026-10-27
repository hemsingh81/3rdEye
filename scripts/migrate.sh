#!/usr/bin/env bash
# Applies backend/migrations/*.sql against the local 3rdEye Postgres
# container started by podman-up.sh.
set -euo pipefail
cd "$(dirname "$0")/../backend"
export DATABASE_URL="${DATABASE_URL:-postgres://3rdeye:3rdeye@localhost:15432/3rdeye}"
npm run migrate

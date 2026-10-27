#!/usr/bin/env bash
# Wipes ONLY the 3rdEye project's own Postgres data volume (3rdeye_pgdata) —
# never a bare `podman volume prune`, which would also hit other projects'
# volumes on this machine. Asks for confirmation; this is destructive to
# local dev data only, never anything running elsewhere.
set -euo pipefail
cd "$(dirname "$0")/../backend"
read -r -p "This deletes the local 3rdEye dev database. Continue? [y/N] " reply
if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
  echo "Cancelled."
  exit 0
fi
podman compose -f podman-compose.yml down -v
echo "3rdEye dev database wiped. Run podman-up.sh + migrate.sh to start fresh."

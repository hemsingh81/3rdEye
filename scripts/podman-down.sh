#!/usr/bin/env bash
# Stops ONLY the 3rdEye compose project — see podman-up.sh's comment.
# Data survives (the volume isn't removed); use podman-reset.sh to wipe it.
set -euo pipefail
cd "$(dirname "$0")/../backend"
podman compose -f podman-compose.yml down
echo "3rdEye Postgres stopped (data volume kept)."

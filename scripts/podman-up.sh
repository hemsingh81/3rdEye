#!/usr/bin/env bash
# Starts (or resumes) ONLY the 3rdEye Postgres container, scoped by compose
# project name "3rdeye" (backend/podman-compose.yml's `name:` field). This
# machine runs several unrelated projects' containers side by side — every
# script here operates strictly through this named compose project, never a
# broad `podman stop/rm` across all containers, so it can't touch them.
set -euo pipefail
cd "$(dirname "$0")/../backend"
podman compose -f podman-compose.yml up -d
echo "3rdEye Postgres is up on localhost:15432 (project: 3rdeye)."

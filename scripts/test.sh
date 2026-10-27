#!/usr/bin/env bash
# Runs the backend self-check (backend/src/test.ts) against an already-
# running dev server (start one with ./dev.sh in another terminal first).
set -euo pipefail
cd "$(dirname "$0")/../backend"
export BASE_URL="${BASE_URL:-http://localhost:8097}"
npm test

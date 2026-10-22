#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12 or newer is required. Install Node.js LTS, then run npm start." >&2
  exit 1
fi
exec node "$ROOT/scripts/start.mjs"

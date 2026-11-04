#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Install Node.js 22 or later from nodejs.org first."; exit 1; }
if [ ! -d node_modules/ws ]; then npm ci; fi
export HOST=127.0.0.1
if [ "${1:-}" = "--lan" ]; then
  export HOST=0.0.0.0
  echo "LAN mode exposes this temporary service to your local network. Use a trusted network."
fi
echo "Open http://localhost:8787 in Chrome. Press Ctrl+C to stop."
exec node server.mjs

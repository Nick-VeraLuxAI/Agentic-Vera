#!/usr/bin/env bash
# One-command production-style bring-up (install deps, optional memory migrations, start API).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Agentic-Vera prod-up =="
if [[ ! -f package.json ]]; then
  echo "package.json not found; run from repo root." >&2
  exit 1
fi

npm ci

echo "== Touch DB / run migrations =="
node -e "require('./memory/db').getDb(); console.log('SQLite ready:', require('./memory/db').getDbPath());"

echo "== Start server (Ctrl+C to stop) =="
exec npm start

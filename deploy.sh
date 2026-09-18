#!/usr/bin/env bash
# Build + run GMS PrjManagement on this machine, no Docker required.
# Builds the React client, copies it into server/public, builds the server,
# then starts one process serving both the UI and the API on $PORT (default 4000).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f server/.env ]; then
  echo "⚠️  server/.env not found — copying server/.env.example."
  echo "    Fill in ATLASSIAN_CLIENT_ID / ATLASSIAN_CLIENT_SECRET / SESSION_ENCRYPTION_KEYS"
  echo "    before starting: there is no mock mode, and the server exits at boot without them."
  cp server/.env.example server/.env
fi

echo "==> Building client..."
(cd client && npm install && npm run build)

echo "==> Copying client build into server/public..."
rm -rf server/public
cp -r client/dist server/public

echo "==> Building server..."
(cd server && npm install && npm run build)

echo "==> Starting server on http://localhost:${PORT:-4000}"
(cd server && npm start)

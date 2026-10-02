#!/bin/bash
# stage.sh — build _deploy/ from an allowlist of the files the app serves.
#
# app/ also holds docs, tests, fixtures and tools. None of those may be served,
# so the deployed directory is an explicit allowlist, never the app root.
#
# CSP notes (see _headers): 'wasm-unsafe-eval' lets the SQLite wasm (iMessage
# import) compile; style 'unsafe-inline' is for style attributes the views set;
# connect-src allows https: because LLM providers and Bluesky repositories
# (any PDS host) are reached only when the user asks.
#
# Usage:  tools/stage.sh && npx wrangler deploy

set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _deploy
mkdir -p _deploy
cp _headers index.html _deploy/
for item in assets src vendor; do cp -R "$item" _deploy/; done
find _deploy \( -name '.DS_Store' -o -name 'Icon' -o -name 'Icon?' -o -name '._*' \) -delete 2>/dev/null || true
# The mock services are a development aid; they stay out of the deployed build.
rm -f _deploy/src/ui/services/mock.js

if ! grep -q 'Content-Security-Policy' _deploy/_headers || ! grep -q 'X-Content-Type-Options' _deploy/_headers; then
  echo "ERROR: _deploy/_headers missing or incomplete; refusing to stage." >&2
  exit 1
fi
echo "_deploy/ staged: $(find _deploy -type f | wc -l | tr -d ' ') files, $(du -sh _deploy | cut -f1)"
echo "Next: npx wrangler deploy"

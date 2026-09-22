#!/bin/bash
# stage.sh — rebuild _deploy/ from the allowlist below.
#
# The project root also holds LOG.md, README.md, TESTING.md, test.js and a
# superseded single-file monolith. None of those may ever be served, so the
# deployed directory is an explicit allowlist, never the project root.
#
# Usage:  ./stage.sh && npx wrangler deploy

set -euo pipefail
cd "$(dirname "$0")"

rm -rf _deploy
mkdir -p _deploy
cp _headers _deploy/
for item in index.html css js vendor orgsignal_demo_hr.csv orgsignal_demo_slack_export.zip; do cp -R "$item" _deploy/; done
find _deploy \( -name '.DS_Store' -o -name 'Icon' -o -name 'Icon?' -o -name '._*' \) -delete 2>/dev/null || true

# Refuse to ship without the security headers.
if [ ! -s _deploy/_headers ] || ! grep -q 'X-Content-Type-Options' _deploy/_headers; then
  echo "ERROR: _deploy/_headers missing or incomplete — refusing to stage." >&2
  exit 1
fi

echo "_deploy/ staged:"
find _deploy -type f | sort | sed 's/^/  /'
echo "Next: npx wrangler deploy"

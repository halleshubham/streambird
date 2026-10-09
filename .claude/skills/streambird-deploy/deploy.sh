#!/usr/bin/env bash
# Deploys the latest published image of an app through Coolify and verifies it.
#
#   COOLIFY_API_TOKEN=... .claude/skills/streambird-deploy/deploy.sh [streambird|landing]
#
# The token comes from the environment ONLY. Never write it into a file, a commit or a PR.
# Optional: COOLIFY_URL (default admin.shackyapps.in).
set -euo pipefail

: "${COOLIFY_API_TOKEN:?set COOLIFY_API_TOKEN (Coolify -> Keys & Tokens -> API tokens)}"
COOLIFY_URL="${COOLIFY_URL:-admin.shackyapps.in}"
TARGET="${1:-streambird}"

case "$TARGET" in
  streambird) UUID=gb8rghmifpq7hb5y6gkkcf6e; CHECK_URL=https://streambird.app/health ;;
  landing)    UUID=qywy4fxyjk1yowjsfnoowbb9; CHECK_URL=https://shackyapps.in/ ;;
  *) echo "unknown target '$TARGET' (streambird|landing)"; exit 2 ;;
esac

API="https://${COOLIFY_URL}/api/v1"
AUTH="Authorization: Bearer ${COOLIFY_API_TOKEN}"

# A 401 here means the token is expired or rotated: ask the user for a fresh one, do not retry.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$API/applications/$UUID")
[ "$code" = 200 ] || { echo "Coolify answered HTTP $code for the app (401 = bad/expired token)"; exit 1; }

resp=$(curl -s -X POST -H "$AUTH" "$API/deploy?uuid=$UUID&force=true")
dep=$(echo "$resp" | grep -o '"deployment_uuid":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$dep" ] || { echo "no deployment started: $resp"; exit 1; }
echo "deployment $dep"

status=""
for _ in $(seq 1 90); do
  status=$(curl -s -H "$AUTH" "$API/deployments/$dep" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status'))")
  case "$status" in finished|failed|cancelled*) break ;; esac
  sleep 10
done
echo "status $status"
[ "$status" = finished ] || exit 1

curl -s -o /dev/null -w "health %{http_code}\n" "$CHECK_URL"
curl -s -H "$AUTH" "$API/applications/$UUID" | python3 -c "import sys,json;print('app status:', json.load(sys.stdin).get('status'))"

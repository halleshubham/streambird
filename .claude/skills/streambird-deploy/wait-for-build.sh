#!/usr/bin/env bash
# Waits until the "Build and publish container image" workflow has finished for a commit on main
# (that run is what publishes the image Coolify deploys). Exit 0 = image published, 1 = build failed.
#
#   .claude/skills/streambird-deploy/wait-for-build.sh [<commit sha, default: origin/main>]
#
# Uses the public GitHub API (no token), so it is rate limited; it polls every 20 s.
set -euo pipefail
REPO="halleshubham/streambird"
SHA="${1:-$(git rev-parse origin/main)}"

for _ in $(seq 1 90); do
  line=$(curl -s "https://api.github.com/repos/$REPO/actions/runs?head_sha=$SHA&per_page=10" | python3 -c "
import sys, json
runs = [r for r in json.load(sys.stdin).get('workflow_runs', []) if r['name'] == 'Build and publish container image']
print(f\"{runs[0]['status']} {runs[0]['conclusion']} #{runs[0]['run_number']}\" if runs else 'none')")
  echo "$(date +%H:%M:%S) $line"
  case "$line" in
    completed\ success*) exit 0 ;;
    completed*) echo "build did not succeed"; exit 1 ;;
  esac
  sleep 20
done
echo "timed out waiting for the build"; exit 1

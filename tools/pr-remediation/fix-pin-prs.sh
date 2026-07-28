#!/bin/bash
set -uo pipefail
declare -A MAP=(
  [17]="fix/unified-remediation-phases-1-7"
  [8]="dependabot/github_actions/actions/upload-artifact-7.0.1"
  [9]="dependabot/npm_and_yarn/pino-10.3.1"
  [10]="dependabot/npm_and_yarn/types/node-26.1.1"
  [12]="dependabot/npm_and_yarn/openai-6.48.0"
  [14]="dependabot/npm_and_yarn/zod-4.4.3"
  [15]="dependabot/npm_and_yarn/vitest-4.1.10"
  [11]="dependabot/npm_and_yarn/eslint-10.7.0"
  [13]="dependabot/npm_and_yarn/typescript-7.0.2"
  [16]="feature/llm-control-plane-phase0-1"
)
for pr in 17 8 9 10 12 14 15 11 13 16; do
  br="${MAP[$pr]}"
  git fetch -q origin "$br" || { echo "PR#$pr FETCH_FAIL"; continue; }
  git checkout -q -B tmp-pin-fix FETCH_HEAD
  if ! grep -q '54a2f2fc8d060674d544fab14388bb5eff6b8e78' .github/workflows/l9-analysis.yml 2>/dev/null; then
    echo "PR#$pr SKIP (no stale pin)"; continue
  fi
  sed -i 's/54a2f2fc8d060674d544fab14388bb5eff6b8e78/f88116503430aa18992b70d8d31063e34ff97ef1/g' .github/workflows/l9-analysis.yml
  git add .github/workflows/l9-analysis.yml
  git -c user.name="Igor Beylin" -c user.email="31744795+cryptoxdog@users.noreply.github.com" commit -q -m "fix(ci): bump stale l9-ci-core pin 54a2f2f -> f881165 (fixes Provision immutable SDK yaml failure)"
  if git push -q origin "tmp-pin-fix:refs/heads/$br"; then echo "PR#$pr PUSHED $(git rev-parse --short HEAD)"; else echo "PR#$pr PUSH_FAIL"; fi
done
git checkout -q fix/l9-core-pin-f881165

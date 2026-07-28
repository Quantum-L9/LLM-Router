#!/usr/bin/env bash
# Push pack remediation branches to their corresponding live PR branches.
# Order: canonical merge order from pack MANIFEST.
# Uses --force-with-lease against recorded live head SHAs for safety.
set -uo pipefail
cd /home/ubuntu/LLM-Router

declare -a MAP=(
  "02|fix/unified-remediation-phases-1-7|175d7130"
  "08|dependabot/github_actions/actions/upload-artifact-7.0.1|bf4a97b"
  "09|dependabot/npm_and_yarn/pino-10.3.1|13062ce"
  "10|dependabot/npm_and_yarn/types/node-26.1.1|a9479f9"
  "12|dependabot/npm_and_yarn/openai-6.48.0|4440b24"
  "14|dependabot/npm_and_yarn/zod-4.4.3|7990d9d"
  "15|dependabot/npm_and_yarn/vitest-4.1.10|cfd0547"
  "11|dependabot/npm_and_yarn/eslint-10.7.0|152cb0d"
  "13|dependabot/npm_and_yarn/typescript-7.0.2|7c906a2"
  "16|feature/llm-control-plane-phase0-1|4337c23"
)

RESULTS=/home/ubuntu/LLM-Router/push-results.txt
: > "$RESULTS"

for entry in "${MAP[@]}"; do
  IFS='|' read -r num branch lease <<< "$entry"
  prnum=$((10#$num))
  src="refs/remediation/remediation/pr-${num}-ready"
  livehead=$(git rev-parse "refs/prheads/${prnum}")
  echo "=== PR #${prnum}: pushing ${src} -> ${branch} (lease on ${livehead}) ==="
  if git push origin "+${src}:refs/heads/${branch}" --force-with-lease="refs/heads/${branch}:${livehead}" 2>&1; then
    echo "PR#${prnum} PUSH OK $(git rev-parse --short ${src})" >> "$RESULTS"
  else
    echo "PR#${prnum} PUSH FAILED" >> "$RESULTS"
  fi
done

echo "=== RESULTS ==="
cat "$RESULTS"

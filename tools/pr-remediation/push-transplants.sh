#!/usr/bin/env bash
# Push each transplanted branch to its live PR head branch (PAT already in origin URL).
# Canonical order: 02 -> 08 -> 09 -> 10 -> 12 -> 14 -> 15 -> 11 -> 13 -> 16.
set -uo pipefail
cd /home/ubuntu/LLM-Router

declare -A BRANCH=(
  [02]="fix/unified-remediation-phases-1-7"
  [08]="dependabot/github_actions/actions/upload-artifact-7.0.1"
  [09]="dependabot/npm_and_yarn/pino-10.3.1"
  [10]="dependabot/npm_and_yarn/types/node-26.1.1"
  [12]="dependabot/npm_and_yarn/openai-6.48.0"
  [14]="dependabot/npm_and_yarn/zod-4.4.3"
  [15]="dependabot/npm_and_yarn/vitest-4.1.10"
  [11]="dependabot/npm_and_yarn/eslint-10.7.0"
  [13]="dependabot/npm_and_yarn/typescript-7.0.2"
  [16]="feature/llm-control-plane-phase0-1"
)

RESULTS=/home/ubuntu/push-results.txt
: > "$RESULTS"
for p in 02 08 09 10 12 14 15 11 13 16; do
  tgt="${BRANCH[$p]}"
  sha=$(git rev-parse "transplant/pr-$p")
  if git push origin "+${sha}:refs/heads/${tgt}" > /tmp/push-$p.log 2>&1; then
    echo "pr-$p -> $tgt : PUSHED $sha" >> "$RESULTS"
  else
    echo "pr-$p -> $tgt : FAILED (see /tmp/push-$p.log)" >> "$RESULTS"
    tail -3 /tmp/push-$p.log >> "$RESULTS"
  fi
done
cat "$RESULTS"

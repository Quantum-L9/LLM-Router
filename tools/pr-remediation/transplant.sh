#!/usr/bin/env bash
# Transplant pack remediation commits onto live main history.
# For each pack branch (stacked order), construct a new commit whose tree =
# pack tree + preserved main-only files, parented on the previous transplant
# commit (chain rooted at origin/main).
set -euo pipefail
cd /home/ubuntu/LLM-Router

ORDER=(02 08 09 10 12 14 15 11 13 16)
PARENT=$(git rev-parse origin/main)

# Paths that exist on live main but are out of the pack's remediation scope.
# These must be preserved so required checks (l9-lint-test-node.yml) and
# governance/config remain intact on every PR branch.
PRESERVE=(
  ".github/CODEOWNERS"
  ".github/ISSUE_TEMPLATE"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/dependabot.yml"
  ".github/governance"
  ".github/workflows/l9-analysis.yml"
  ".github/workflows/l9-governance.yml"
  ".github/workflows/l9-lint-test-node.yml"
  ".github/workflows/l9-nightly.yml"
  ".github/workflows/l9-node-ts-monorepo.yml"
  ".github/workflows/l9-pr-pipeline.yml"
  ".github/workflows/l9-pre-commit.yml"
  ".github/workflows/l9-release.yml"
  ".github/workflows/l9-sbom.yml"
  ".github/workflows/l9-scorecard.yml"
  ".github/workflows/l9-security.yml"
  "CODE_OF_CONDUCT.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "SUPPORT.md"
)

export GIT_AUTHOR_NAME="Igor Beylin"
export GIT_AUTHOR_EMAIL="ib718@icloud.com"
export GIT_COMMITTER_NAME="Igor Beylin"
export GIT_COMMITTER_EMAIL="ib718@icloud.com"

for p in "${ORDER[@]}"; do
  PACK_REF="refs/remediation/remediation/pr-${p}-ready"
  PACK_COMMIT=$(git rev-parse "$PACK_REF")

  # Build tree in a temp index: start from pack tree, overlay preserved paths from main.
  TMPIDX=$(mktemp /tmp/idx-XXXX)
  rm -f "$TMPIDX"
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$PACK_REF^{tree}"
  for path in "${PRESERVE[@]}"; do
    # Copy path entries from origin/main into the index (dir or file).
    GIT_INDEX_FILE="$TMPIDX" git ls-tree -r origin/main -- "$path" | \
      GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
  done
  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"

  # Reuse the pack commit's message, annotated with provenance.
  MSG=$(git log -1 --format=%B "$PACK_COMMIT")
  NEW=$(printf '%s\n\nTransplanted-From: %s (remediation pack 2026-07-20)\n' "$MSG" "$PACK_COMMIT" | \
        git commit-tree "$TREE" -p "$PARENT")

  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: pack=$PACK_COMMIT -> transplant=$NEW (parent=$PARENT)"
  PARENT="$NEW"
done
echo "DONE"

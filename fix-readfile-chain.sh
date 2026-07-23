#!/usr/bin/env bash
# Rebuild the transplant chain removing the unused `readFile` import from
# scripts/verify-package.mjs wherever the file exists. No other changes.
set -euo pipefail
cd /home/ubuntu/LLM-Router

ORDER=(02 08 09 10 12 14 15 11 13 16)
PARENT=$(git rev-parse origin/main)

export GIT_AUTHOR_NAME="Igor Beylin"
export GIT_AUTHOR_EMAIL="ib718@icloud.com"
export GIT_COMMITTER_NAME="Igor Beylin"
export GIT_COMMITTER_EMAIL="ib718@icloud.com"

for p in "${ORDER[@]}"; do
  OLD=$(git rev-parse "transplant/pr-${p}")
  TMPIDX=$(mktemp -u /tmp/idx3-XXXX)
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD^{tree}"

  if git cat-file -e "$OLD:scripts/verify-package.mjs" 2>/dev/null; then
    git show "$OLD:scripts/verify-package.mjs" | \
      sed "s/import { mkdtemp, readFile, rm, writeFile } from 'node:fs\/promises';/import { mkdtemp, rm, writeFile } from 'node:fs\/promises';/" > /tmp/vp-$p.mjs
    if grep -q 'readFile' /tmp/vp-$p.mjs; then
      echo "pr-$p: readFile still present after sed — inspect!" >&2
      exit 1
    fi
    BLOB=$(git hash-object -w /tmp/vp-$p.mjs)
    printf '100644 blob %s\tscripts/verify-package.mjs\n' "$BLOB" | GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
  fi

  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"

  MSG=$(git log -1 --format=%B "$OLD")
  NEW=$(printf '%s' "$MSG" | git commit-tree "$TREE" -p "$PARENT")
  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: $OLD -> $NEW"
  PARENT="$NEW"
done
echo DONE

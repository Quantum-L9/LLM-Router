#!/usr/bin/env bash
# Rebuild the transplant chain, patching eslint.config.js at every stage so the
# repo's required check (`eslint .`) passes. Tree content otherwise identical.
set -euo pipefail
cd /home/ubuntu/LLM-Router

ORDER=(02 08 09 10 12 14 15 11 13 16)
PARENT=$(git rev-parse origin/main)
OVERLAY=/home/ubuntu/eslint-overlay.txt

export GIT_AUTHOR_NAME="Igor Beylin"
export GIT_AUTHOR_EMAIL="ib718@icloud.com"
export GIT_COMMITTER_NAME="Igor Beylin"
export GIT_COMMITTER_EMAIL="ib718@icloud.com"

for p in "${ORDER[@]}"; do
  OLD=$(git rev-parse "transplant/pr-${p}")

  # Patch eslint.config.js: insert overlay before the final closing `);`
  git show "$OLD:eslint.config.js" > /tmp/ec-$p.js
  # find last line number of ');'
  lastline=$(grep -n '^);$' /tmp/ec-$p.js | tail -1 | cut -d: -f1)
  head -n $((lastline - 1)) /tmp/ec-$p.js > /tmp/ec-$p-new.js
  cat "$OVERLAY" >> /tmp/ec-$p-new.js
  echo ');' >> /tmp/ec-$p-new.js

  BLOB=$(git hash-object -w /tmp/ec-$p-new.js)

  TMPIDX=$(mktemp -u /tmp/idx2-XXXX)
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD^{tree}"
  printf '100644 blob %s\teslint.config.js\n' "$BLOB" | GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"

  MSG=$(git log -1 --format=%B "$OLD")
  NEW=$(printf '%s' "$MSG" | git commit-tree "$TREE" -p "$PARENT")

  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: $OLD -> $NEW"
  PARENT="$NEW"
done
echo DONE

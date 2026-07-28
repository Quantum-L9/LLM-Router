#!/usr/bin/env bash
# Rebuild the transplant chain adding the provider-boundary ESLint rule to
# stages whose package.json defines `lint:boundary` but whose eslint.config.js
# lacks `no-restricted-imports` (pack defect: the CI step exists before the
# rule is introduced at pr-11). Stages already containing the rule are only
# re-parented.
set -euo pipefail
cd /home/ubuntu/LLM-Router

ORDER=(02 08 09 10 12 14 15 11 13 16)
PARENT=$(git rev-parse origin/main)
OVERLAY=/home/ubuntu/boundary-overlay.txt

export GIT_AUTHOR_NAME="Igor Beylin"
export GIT_AUTHOR_EMAIL="ib718@icloud.com"
export GIT_COMMITTER_NAME="Igor Beylin"
export GIT_COMMITTER_EMAIL="ib718@icloud.com"

for p in "${ORDER[@]}"; do
  OLD=$(git rev-parse "transplant/pr-${p}")
  TMPIDX=$(mktemp -u /tmp/idx6-XXXX)
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD^{tree}"

  NEEDS=no
  if git show "$OLD:package.json" | grep -q 'lint:boundary'; then
    if ! git show "$OLD:eslint.config.js" | grep -q 'no-restricted-imports'; then
      NEEDS=yes
    fi
  fi

  if [ "$NEEDS" = yes ]; then
    git show "$OLD:eslint.config.js" > /tmp/bc-$p.js
    lastline=$(grep -n '^);$' /tmp/bc-$p.js | tail -1 | cut -d: -f1)
    head -n $((lastline - 1)) /tmp/bc-$p.js > /tmp/bc-$p-new.js
    cat "$OVERLAY" >> /tmp/bc-$p-new.js
    echo ');' >> /tmp/bc-$p-new.js
    BLOB=$(git hash-object -w /tmp/bc-$p-new.js)
    printf '100644 blob %s\teslint.config.js\n' "$BLOB" | GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
  fi

  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"
  MSG=$(git log -1 --format=%B "$OLD")
  NEW=$(printf '%s' "$MSG" | git commit-tree "$TREE" -p "$PARENT")
  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: boundary_added=$NEEDS $OLD -> $NEW"
  PARENT="$NEW"
done
echo DONE

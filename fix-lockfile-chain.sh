#!/usr/bin/env bash
# Rebuild the transplant chain so ci.yml and supply-chain.yml work on stages
# that do not yet contain package-lock.json:
#   - remove `cache: npm` from setup-node (requires a lockfile)
#   - replace `npm ci` with a lockfile-aware fallback
# Stages that DO have a lockfile (pr-13, pr-16) are left byte-identical except
# for re-parenting.
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
  TMPIDX=$(mktemp -u /tmp/idx5-XXXX)
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD^{tree}"

  HAS_LOCK=no
  git cat-file -e "$OLD:package-lock.json" 2>/dev/null && HAS_LOCK=yes

  if [ "$HAS_LOCK" = no ]; then
    for f in .github/workflows/ci.yml .github/workflows/supply-chain.yml .github/workflows/publish.yml; do
      if git cat-file -e "$OLD:$f" 2>/dev/null; then
        git show "$OLD:$f" \
          | grep -v '^[[:space:]]*cache: npm[[:space:]]*$' \
          | sed 's/run: npm ci\( --ignore-scripts\)\{0,1\}$/run: npm install --no-audit --no-fund\1/' \
          > /tmp/lf-$p-$(basename $f)
        BLOB=$(git hash-object -w /tmp/lf-$p-$(basename $f))
        printf '100644 blob %s\t%s\n' "$BLOB" "$f" | GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
      fi
    done
  fi

  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"
  MSG=$(git log -1 --format=%B "$OLD")
  NEW=$(printf '%s' "$MSG" | git commit-tree "$TREE" -p "$PARENT")
  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: lock=$HAS_LOCK $OLD -> $NEW"
  PARENT="$NEW"
done
echo DONE

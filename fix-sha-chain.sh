#!/usr/bin/env bash
# Rebuild the transplant chain fixing the truncated actions/upload-artifact pin
# (39-char -> full 40-char SHA, verified = tag v7.0.1) in ci.yml and
# supply-chain.yml wherever present. No other changes.
set -euo pipefail
cd /home/ubuntu/LLM-Router

ORDER=(02 08 09 10 12 14 15 11 13 16)
PARENT=$(git rev-parse origin/main)
SHORT='043fb46d1a93c77aae656e7c1c64a875d1fc6a0'
FULL='043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'

export GIT_AUTHOR_NAME="Igor Beylin"
export GIT_AUTHOR_EMAIL="ib718@icloud.com"
export GIT_COMMITTER_NAME="Igor Beylin"
export GIT_COMMITTER_EMAIL="ib718@icloud.com"

for p in "${ORDER[@]}"; do
  OLD=$(git rev-parse "transplant/pr-${p}")
  TMPIDX=$(mktemp -u /tmp/idx4-XXXX)
  GIT_INDEX_FILE="$TMPIDX" git read-tree "$OLD^{tree}"

  for f in .github/workflows/ci.yml .github/workflows/supply-chain.yml; do
    if git cat-file -e "$OLD:$f" 2>/dev/null; then
      if git show "$OLD:$f" | grep -q "upload-artifact@${SHORT}\b\|upload-artifact@${SHORT}$\|upload-artifact@${SHORT} "; then :; fi
      git show "$OLD:$f" | sed "s|upload-artifact@${SHORT}\([^0-9a-f]\)|upload-artifact@${FULL}\1|g; s|upload-artifact@${SHORT}\$|upload-artifact@${FULL}|g" > /tmp/wf-$p.yml
      # Guard: no remaining short pins (short not followed by 'a')
      if grep -E "upload-artifact@${SHORT}([^a]|\$)" /tmp/wf-$p.yml >/dev/null; then
        echo "pr-$p $f: short SHA still present" >&2; exit 1
      fi
      BLOB=$(git hash-object -w /tmp/wf-$p.yml)
      printf '100644 blob %s\t%s\n' "$BLOB" "$f" | GIT_INDEX_FILE="$TMPIDX" git update-index --index-info
    fi
  done

  TREE=$(GIT_INDEX_FILE="$TMPIDX" git write-tree)
  rm -f "$TMPIDX"
  MSG=$(git log -1 --format=%B "$OLD")
  NEW=$(printf '%s' "$MSG" | git commit-tree "$TREE" -p "$PARENT")
  git update-ref "refs/heads/transplant/pr-${p}" "$NEW"
  echo "pr-${p}: $OLD -> $NEW"
  PARENT="$NEW"
done
echo DONE

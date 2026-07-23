#!/usr/bin/env bash
# Applies SonarCloud remediation per PR branch, stage-appropriately.
# Usage: ./sonar-fix.sh <branch> [flags: base|late|pr16|pr18]
set -euo pipefail
cd /home/ubuntu/LLM-Router

BR="$1"; STAGE="$2"   # STAGE in {base, late, pr16, pr18}
WT="/tmp/wt-sonar"
git worktree remove -f "$WT" 2>/dev/null || true
git fetch -q origin "$BR"
git worktree add -f "$WT" "origin/$BR" -b "sfix-tmp" 2>/dev/null || { git branch -D sfix-tmp 2>/dev/null; git worktree add -f "$WT" "origin/$BR" -b "sfix-tmp"; }
cd "$WT"

########################################
# 1. S8544: pin pip + semgrep in l9-analysis.yml (all stages)
########################################
if grep -q 'python -m pip install --upgrade pip semgrep' .github/workflows/l9-analysis.yml; then
  sed -i "s|python -m pip install --upgrade pip semgrep|python -m pip install 'pip==26.1.2' 'semgrep==1.170.1'|" .github/workflows/l9-analysis.yml
fi

if [ "$STAGE" != "pr18" ]; then
########################################
# 2. S6959: perplexity.ts reduce() initial value (all code stages)
########################################
if [ -f src/providers/perplexity.ts ]; then
  # single-line style (base stage) and multi-line style (late stages) share the same expression
  sed -i 's|best: successes\.reduce((best, candidate) => candidate\.content\.length > best\.content\.length ? candidate : best)|best: successes.reduce((best, candidate) => candidate.content.length > best.content.length ? candidate : best, successes[0])|' src/providers/perplexity.ts
  # 3. S2871: citations sort comparator (late stages only; no-op if absent)
  sed -i 's|citations: \[\.\.\.new Set(responses\.flatMap(response => response\.citations ?? \[\]))\]\.sort()|citations: [...new Set(responses.flatMap(response => response.citations ?? []))].sort((left, right) => left.localeCompare(right))|' src/providers/perplexity.ts
fi

########################################
# 4. S2871 control-plane (pr16 only)
########################################
if [ "$STAGE" = "pr16" ]; then
  # contracts.ts:9 — deterministic code-unit comparator (behavior-preserving vs default sort for these string arrays)
  sed -i 's|const expected = \[\.\.\.new Set(serialized)\]\.sort();|const expected = [...new Set(serialized)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);|' src/control-plane/contracts.ts
  # builders.ts:52 sortedUniqueStrings
  sed -i 's|function sortedUniqueStrings(values: string\[\]): string\[\] { return \[\.\.\.new Set(values\.map(normalizeString))\]\.sort(); }|function sortedUniqueStrings(values: string[]): string[] { return [...new Set(values.map(normalizeString))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0); }|' src/control-plane/builders.ts
fi

########################################
# 5. S4036: verify-package.mjs absolute npm invocation (stages with scripts/)
########################################
if [ -f scripts/verify-package.mjs ]; then
  python3 - << 'PYEOF'
import re
p = 'scripts/verify-package.mjs'
s = open(p).read()
if 'runNpm' not in s:
    s = s.replace(
        "import { execFileSync } from 'node:child_process';",
        "import { execFileSync } from 'node:child_process';\n"
        "import { delimiter } from 'node:path';\n"
    , 1)
    helper = (
        "const root = fileURLToPath(new URL('..', import.meta.url));\n"
        "// Invoke npm via the absolute Node binary + npm CLI script (avoids PATH lookup; sonar javascript:S4036).\n"
        "const npmCliPath = process.env.npm_execpath;\n"
        "const fixedPath = ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);\n"
        "const runNpm = (args, options = {}) => npmCliPath\n"
        "  ? execFileSync(process.execPath, [npmCliPath, ...args], options)\n"
        "  : execFileSync('npm', args, { ...options, env: { ...(options.env ?? process.env), PATH: fixedPath } });\n"
    )
    s = s.replace("const root = fileURLToPath(new URL('..', import.meta.url));\n", helper, 1)
    s = s.replace("execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })",
                  "runNpm(['pack', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })")
    s = s.replace("execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--registry=${registry}`, tarball], { cwd: workspace, stdio: 'inherit', env: process.env });",
                  "runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--registry=${registry}`, tarball], { cwd: workspace, stdio: 'inherit', env: process.env });")
    open(p, 'w').write(s)
    print('patched verify-package.mjs')
else:
    print('already patched')
PYEOF
fi

########################################
# 6+7. S8543/S8564: add package-lock.json where missing; switch npm install -> npm ci
########################################
if [ ! -f package-lock.json ]; then
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
  [ -f package-lock.json ] || { echo "LOCKFILE GENERATION FAILED for $BR"; exit 1; }
  for wf in .github/workflows/ci.yml .github/workflows/publish.yml .github/workflows/supply-chain.yml; do
    [ -f "$wf" ] && sed -i 's|npm install --no-audit --no-fund --ignore-scripts|npm ci --ignore-scripts|' "$wf"
  done
  # restore npm cache hint if we removed it earlier? keep simple: leave setup-node as-is.
fi

fi  # end non-pr18

git add -A
git commit -q -m "fix(quality): resolve SonarCloud new-code findings

- pin pip/semgrep versions in l9-analysis.yml (githubactions:S8544)
- add initial value to consensus reduce() (typescript:S6959)
- use explicit comparators for sorts (typescript:S2871)
- invoke npm without PATH lookup in verify-package.mjs (javascript:S4036)
- commit package-lock.json and restore npm ci (githubactions:S8543, text:S8564)" || echo "NOTHING TO COMMIT for $BR"
NEW=$(git rev-parse HEAD)
echo "$BR -> $NEW"
cd /home/ubuntu/LLM-Router
git worktree remove -f "$WT"
git branch -D sfix-tmp 2>/dev/null || true
git update-ref "refs/sfix/$STAGE-$(echo "$BR" | tr '/' '_')" "$NEW"

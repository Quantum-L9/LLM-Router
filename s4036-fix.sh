#!/usr/bin/env bash
# Fix javascript:S4036 in scripts/verify-package.mjs on every open PR branch:
# remove the bare-'npm' fallback spawn; resolve the npm CLI script path absolutely.
set -euo pipefail
cd /home/ubuntu/LLM-Router

BRANCHES=(
  fix/unified-remediation-phases-1-7
  dependabot/github_actions/actions/upload-artifact-7.0.1
  dependabot/npm_and_yarn/pino-10.3.1
  dependabot/npm_and_yarn/types/node-26.1.1
  dependabot/npm_and_yarn/openai-6.48.0
  dependabot/npm_and_yarn/zod-4.4.3
  dependabot/npm_and_yarn/vitest-4.1.10
  dependabot/npm_and_yarn/eslint-10.7.0
  dependabot/npm_and_yarn/typescript-7.0.2
  feature/llm-control-plane-phase0-1
)

git fetch -q origin

for br in "${BRANCHES[@]}"; do
  safe=${br//\//_}
  git worktree remove -f /tmp/wt-s4036 2>/dev/null || true
  git branch -D s4036-tmp 2>/dev/null || true
  git worktree add -f /tmp/wt-s4036 -b s4036-tmp "origin/$br" >/dev/null
  pushd /tmp/wt-s4036 >/dev/null

  if [ ! -f scripts/verify-package.mjs ]; then
    echo "$br: no verify-package.mjs, skipping"
    popd >/dev/null; continue
  fi

  python3 - << 'PYEOF'
import re
p = 'scripts/verify-package.mjs'
src = open(p).read()

old_block = """// Invoke npm via the absolute Node binary + npm CLI script (avoids PATH lookup; sonar javascript:S4036).
const npmCliPath = process.env.npm_execpath;
const fixedPath = ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);
const runNpm = (args, options = {}) => npmCliPath
  ? execFileSync(process.execPath, [npmCliPath, ...args], options)
  : execFileSync('npm', args, { ...options, env: { ...(options.env ?? process.env), PATH: fixedPath } });"""

new_block = """// Invoke npm via the absolute Node binary + an absolute npm CLI script path.
// No bare-name spawn and no PATH lookup anywhere (sonar javascript:S4036).
const resolveNpmCli = () => {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const candidates = [
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error('Unable to locate the npm CLI script; set npm_execpath.');
};
const npmCliPath = resolveNpmCli();
const runNpm = (args, options = {}) => execFileSync(process.execPath, [npmCliPath, ...args], options);"""

assert old_block in src, 'old block not found'
src = src.replace(old_block, new_block)

# imports: drop delimiter, add dirname + existsSync
src = src.replace("import { delimiter } from 'node:path';\n", "")
src = src.replace(
    "import { basename, join } from 'node:path';",
    "import { basename, dirname, join } from 'node:path';\nimport { existsSync } from 'node:fs';"
)

open(p, 'w').write(src)
print('patched', p)
PYEOF

  node --check scripts/verify-package.mjs
  git add scripts/verify-package.mjs
  git -c user.name='L9 Remediator' -c user.email='remediator@quantum-l9.dev' commit -q -m "fix(quality): remove PATH-dependent npm fallback in verify-package.mjs

Resolve the npm CLI script to an absolute path (npm_execpath or the npm
installation shipped alongside the Node binary) and always spawn it via
process.execPath. Eliminates the bare-name 'npm' spawn flagged by Sonar
javascript:S4036 (OS command search path vulnerability)."
  git update-ref "refs/s4036/$safe" HEAD
  echo "$br -> $(git rev-parse --short HEAD)"
  popd >/dev/null
  git worktree remove -f /tmp/wt-s4036
  git branch -D s4036-tmp
done
echo DONE

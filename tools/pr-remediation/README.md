# PR Remediation Tooling (Historical)

These scripts were used to rebuild and push a stacked chain of pack-remediation
commits across a set of open pull requests against `Quantum-L9/LLM-Router`
(referenced PR numbers: 2, 8-17, 18). They fix historical defects such as:

- `fix-boundary-chain.sh` — adds the provider-boundary ESLint rule to PR stages
  that lacked it.
- `fix-eslint-chain.sh` — patches `eslint.config.js` so the required `eslint .`
  check passes on affected stages.
- `fix-lockfile-chain.sh` — fixes CI steps on stages missing `package-lock.json`.
- `fix-pin-prs.sh` — maps PR numbers to branch names for the transplant chain.
- `fix-readfile-chain.sh` — removes an unused `readFile` import from
  `scripts/verify-package.mjs`.
- `fix-sha-chain.sh` — fixes truncated `actions/upload-artifact` SHA pins in
  `ci.yml` / `supply-chain.yml`.
- `push-remediation.sh`, `push-transplants.sh` — push remediation/transplant
  branches to their live PR head branches.
- `s4036-fix.sh` — fixes SonarCloud rule `javascript:S4036` in
  `scripts/verify-package.mjs`.
- `sonar-fix.sh` — applies SonarCloud remediation per PR branch.
- `transplant.sh` — rebuilds the canonical transplant-commit chain onto `main`.
- `push-results.txt` — recorded outcome of one push run (mixed
  success/failure across PR branches).

Relocated from the repository root (2026-07-28) per the L9 repository
instantiation audit and remediation plan: these files had no consumer in
`package.json`, GitHub Actions workflows, or documentation, and their
presence at root implied they were part of the shipped project surface.
They are retained here, out of the package root, pending confirmation that
all referenced pull requests are merged or closed, at which point they can
be deleted.

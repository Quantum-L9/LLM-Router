# L9 CI Convergence — @quantum-l9/llm-router

This repo is a **TypeScript / npm** package. The L9 shared CI target model is
authored around Python repos, so convergence here is an *adaptation*: the routing
architecture (classifier-first, one canonical gate, namespaced labels, blocking
vs advisory policy) is adopted verbatim, while the gates themselves map to this
repo's own npm scripts instead of `ruff`/`pytest`/`semgrep`.

## What was implemented in-repo (file plane)

| Area | File | Notes |
|---|---|---|
| Classifier | `.github/scripts/classify_pr.py` | Python 3 stdlib; TS-aware surfaces (src/providers, src/vision, src/budget, src/control-plane). Emits the full L9 output set + `run_*` routing booleans. Unknown diffs **fail closed**. |
| Canonical gate | `.github/workflows/pr-pipeline.yml` | Job **`PR Pipeline Gate`** aggregates classify → lint → build → test → security using this repo's npm scripts. `if: always()`, `contents: read`, `concurrency` + `cancel-in-progress`. |
| Routing policy | `.github/governance/routing_policy.yaml` | Changed-files primary, labels secondary, evidence-beats-labels. |
| Blocking policy | `.github/governance/blocking_policy.yaml` | Hard-block-if-touched surfaces (transport boundary, image ingress, budget reservation, control-plane contracts); inherited debt advisory. |
| Comment protocol | `.github/governance/comment_protocol.yaml` | Stable markers, update-in-place, no duplicates. |
| Label taxonomy | `.github/labels.yml` | Namespaced source of truth (`automation:` / `type:` / `area:` / `risk:`). |
| Workflow standard | all `.github/workflows/*.yml` | `actions/checkout` upgraded v4 → **v6** (`d23441a…`), SHA-pinned to preserve Scorecard hardening. |

The classifier and every npm gate (`lint`, `lint:boundary`, `build`,
`verify:types`, `verify:declarations`, `test`, `npm audit`, `verify:package`)
were run locally and pass.

## Settings plane — requires GitHub admin, NOT changed by this branch

These cannot be set from repo files and were **not** modified. Apply with
explicit approval.

### 1. Provision namespaced labels
Create every label in `.github/labels.yml`; delete the deprecated plain labels
(`ci`, `security`, `testing`, `typing`, `docker`, `python`, `dependencies`,
`github-actions`). Suggested colors are in the manifest.

### 2. Branch protection on `main`
- Required check: **`PR Pipeline Gate`** (add others after they stabilize:
  CodeQL / Gitleaks / GitGuardian / SonarCloud / Supply Chain).
- Require PR before merge; ≥1 approval; dismiss stale approvals; require
  CODEOWNERS; require conversation resolution; require branches up to date;
  linear history; disallow force-push and deletion.
- Merge strategy: squash-only; auto-delete head branches.

> Status: **Unknown / unenforced.** Do not claim `PR Pipeline Gate` is enforced
> until GitHub → Settings → Branches confirms it is a required check.

### 3. Secrets / variables (names only)
- Platform/org preferred: `SONAR_TOKEN`, `GITGUARDIAN_API_KEY`, `CODECOV_TOKEN`.
- Repo publish: `NODE_AUTH_TOKEN` (GitHub Packages, already used by `publish.yml`).

## Known divergences deferred (roadmap)

- **`l9-pr-pipeline.yml` / `l9-governance.yml`** call the org `l9-ci-core`
  reusable kernels with `python-version: "3.12"` / a Python trio-governance
  model. These are **language-mismatched** for a TS package. Left in place to
  avoid breaking org wiring; resolving them belongs at the `l9-ci-core` org
  level (a Node/TS kernel or a documented no-op path for TS repos).
- **GitGuardian / Gitleaks / SonarCloud / CodeQL** are `recommended_optional`
  and deferred until the canonical gate is enforced and their tokens exist.
- Agent-review loop is **prepared, not enabled** — the foundation (stable
  classifier outputs, machine-readable gate summary, marker protocol,
  namespaced labels) is now in place.

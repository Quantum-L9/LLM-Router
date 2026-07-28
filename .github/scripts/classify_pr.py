#!/usr/bin/env python3
"""L9 PR classifier for @quantum-l9/llm-router.

Adapted from the L9 shared CI model for a TypeScript / Node package. The routing
logic is language-agnostic; the file-pattern surfaces are tuned to this repo
(TypeScript source under src/, Vitest tests under tests/, npm dependency
manifests, Control Plane contracts).

Contract (see .github/governance/routing_policy.yaml and the l9-github-ci kernel):
  - Changed files are the primary signal. Labels are secondary hints only and may
    never downgrade a touched security surface.
  - Unknown diffs fail closed: conservative core gates run.

Emits both the rich L9 classifier outputs (pr_class + *_changed surfaces) and the
run_* routing booleans consumed by pr-pipeline.yml. Standard library only.
"""

from __future__ import annotations

import fnmatch
import os
import subprocess
import sys

# --- surface patterns (primary signal) -------------------------------------

PATTERNS = {
    "docs": ["*.md", "docs/**", "LICENSE", "*.txt", ".github/ISSUE_TEMPLATE/**"],
    "workflows": [".github/workflows/**"],
    "scripts": ["scripts/**", ".github/scripts/**"],
    "app": ["src/**"],
    "tests": ["tests/**", "*.test.ts", "*.spec.ts", "**/*.test.ts", "**/*.spec.ts"],
    "docker": ["Dockerfile", "Dockerfile.*", "*.dockerfile", "docker/**", ".dockerignore"],
    "dependency": ["package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc"],
    "dependency_types": ["**/@types/**"],
    "contracts": [
        "src/control-plane/**",
        "src/matrices/**",
        "fixtures/control-plane/**",
        "tests/control-plane/**",
        ".github/governance/**",
    ],
    "security_sensitive": [
        "src/providers/**",
        "src/vision/**",
        "src/budget/**",
        "scripts/verify-eslint-boundary.mjs",
        "eslint.config.js",
        ".github/workflows/**security*",
        ".github/workflows/supply-chain.yml",
    ],
    "typing_sensitive": ["tsconfig*.json", "**/*.d.ts", "src/**/types.ts", "src/**/*.types.ts"],
    "transport_sensitive": ["src/providers/**"],
    "ingress_sensitive": ["src/vision/**"],
    "python": ["*.py", "**/*.py"],
}


def _match(path: str, globs: list[str]) -> bool:
    for g in globs:
        if fnmatch.fnmatch(path, g):
            return True
        # support "dir/**" prefix matching for nested paths
        if g.endswith("/**") and (path == g[:-3] or path.startswith(g[:-2])):
            return True
    return False


def changed_files() -> list[str]:
    """Resolve the PR's changed files. Prefer an explicit CHANGED_FILES env
    (newline separated), otherwise diff against the base ref."""
    explicit = os.environ.get("CHANGED_FILES", "").strip()
    if explicit:
        return [f.strip() for f in explicit.splitlines() if f.strip()]

    base = os.environ.get("GITHUB_BASE_REF") or "main"
    for ref in (f"origin/{base}", base):
        try:
            out = subprocess.run(
                ["git", "diff", "--name-only", f"{ref}...HEAD"],
                capture_output=True, text=True, check=True,
            ).stdout
            files = [f.strip() for f in out.splitlines() if f.strip()]
            if files:
                return files
        except subprocess.CalledProcessError:
            continue
    return []


def classify(files: list[str], labels: list[str]) -> dict:
    surfaces = {name: False for name in PATTERNS}
    matched_any = {f: False for f in files}

    for f in files:
        for name, globs in PATTERNS.items():
            if _match(f, globs):
                surfaces[name] = True
                matched_any[f] = True

    # A file that matched no known surface makes the diff unknown -> fail closed.
    diff_unknown = (not files) or any(not m for m in matched_any.values())

    # Label hints may UPGRADE relevance but never downgrade a touched security
    # surface. Evidence beats labels.
    label_set = {l.lower() for l in labels}
    if "risk:security" in label_set or "type:security" in label_set:
        surfaces["security_sensitive"] = surfaces["security_sensitive"] or True

    # pr_class precedence: most safety-critical wins.
    if surfaces["security_sensitive"]:
        pr_class = "security"
    elif surfaces["contracts"]:
        pr_class = "compliance"
    elif surfaces["docker"]:
        pr_class = "docker"
    elif surfaces["dependency_types"] and not (surfaces["app"] or surfaces["contracts"]):
        pr_class = "dependency_types"
    elif surfaces["dependency"] and not (surfaces["app"] or surfaces["contracts"]):
        pr_class = "dependency"
    elif surfaces["app"]:
        pr_class = "app_code"
    elif surfaces["tests"] and not surfaces["app"]:
        pr_class = "tests_only"
    elif surfaces["workflows"] and not (surfaces["app"] or surfaces["scripts"]):
        pr_class = "ci_workflow"
    elif surfaces["scripts"]:
        pr_class = "app_code"
    elif surfaces["docs"] and not diff_unknown:
        pr_class = "docs_only"
    elif diff_unknown:
        pr_class = "unknown_diff"
    else:
        pr_class = "unknown"

    is_docs_only = pr_class == "docs_only"

    # run_* routing (consumed by pr-pipeline.yml). Fail closed on unknown.
    fail_closed = pr_class in ("unknown_diff", "unknown")
    run_lint = not is_docs_only or fail_closed
    run_build = surfaces["app"] or surfaces["contracts"] or surfaces["typing_sensitive"] \
        or surfaces["dependency"] or surfaces["scripts"] or fail_closed
    run_test = surfaces["app"] or surfaces["tests"] or surfaces["contracts"] \
        or surfaces["dependency"] or fail_closed
    run_security = surfaces["security_sensitive"] or surfaces["dependency"] \
        or surfaces["app"] or fail_closed
    run_infrastructure = surfaces["workflows"] or surfaces["docker"]
    requires_human_review = pr_class in ("security", "compliance", "unknown_diff")

    semgrep_relevant = surfaces["app"] or surfaces["scripts"] or surfaces["security_sensitive"]
    sbom_relevant = surfaces["dependency"] or surfaces["app"]
    scorecard_relevant = surfaces["workflows"] or surfaces["dependency"]

    return {
        "pr_class": pr_class,
        "all_changed_files": ";".join(files),
        "changed_count": str(len(files)),
        "diff_unknown": str(diff_unknown).lower(),
        "labels": ",".join(labels),
        "detected_labels": ",".join(labels),
        "python_changed": str(surfaces["python"]).lower(),
        "app_changed": str(surfaces["app"]).lower(),
        "tests_changed": str(surfaces["tests"]).lower(),
        "docs_changed": str(surfaces["docs"]).lower(),
        "workflows_changed": str(surfaces["workflows"]).lower(),
        "scripts_changed": str(surfaces["scripts"]).lower(),
        "docker_changed": str(surfaces["docker"]).lower(),
        "dependency_changed": str(surfaces["dependency"]).lower(),
        "contracts_changed": str(surfaces["contracts"]).lower(),
        "security_sensitive_changed": str(surfaces["security_sensitive"]).lower(),
        "typing_sensitive_changed": str(surfaces["typing_sensitive"]).lower(),
        "transport_sensitive_changed": str(surfaces["transport_sensitive"]).lower(),
        "ingress_sensitive_changed": str(surfaces["ingress_sensitive"]).lower(),
        "semgrep_relevant": str(semgrep_relevant).lower(),
        "sbom_relevant": str(sbom_relevant).lower(),
        "scorecard_relevant": str(scorecard_relevant).lower(),
        # routing booleans
        "run_lint": str(run_lint).lower(),
        "run_build": str(run_build).lower(),
        "run_test": str(run_test).lower(),
        "run_security": str(run_security).lower(),
        "run_infrastructure": str(run_infrastructure).lower(),
        "is_docs_only": str(is_docs_only).lower(),
        "requires_human_review": str(requires_human_review).lower(),
    }


def main() -> int:
    labels_env = os.environ.get("PR_LABELS", "").strip()
    labels = [l.strip() for l in labels_env.replace("\n", ",").split(",") if l.strip()]
    files = changed_files()
    result = classify(files, labels)

    # Emit to GITHUB_OUTPUT if present, else stdout (local runs).
    out_path = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{k}={v}" for k, v in result.items()]
    if out_path:
        with open(out_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")

    print("L9 PR classifier")
    print(f"  changed files : {result['changed_count']}")
    print(f"  pr_class      : {result['pr_class']}")
    print(f"  diff_unknown  : {result['diff_unknown']}")
    print(f"  run_lint/build/test/security: "
          f"{result['run_lint']}/{result['run_build']}/"
          f"{result['run_test']}/{result['run_security']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

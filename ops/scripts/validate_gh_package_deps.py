#!/usr/bin/env python3
"""Consumer-side hook target for governance `gh-package-deps-preflight`.

Cursor-Governance runs that hook with cwd=this workspace. This package no
longer installs @quantum-l9/* from GitHub Packages: graphiti-memory-client is
`file:packages/graphiti-memory-client`. Fail if any scoped dep still resolves
to npm.pkg.github.com.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SCOPE = "@quantum-l9/"
DEFAULT_PKG = "package.json"
DEFAULT_LOCK = "package-lock.json"


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def scoped_deps(package: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for kind in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        deps = package.get(kind) or {}
        if not isinstance(deps, dict):
            continue
        for name, spec in deps.items():
            if str(name).startswith(SCOPE):
                out[str(name)] = str(spec)
    return out


def lock_entries(lock: dict[str, Any]) -> dict[str, dict[str, Any]]:
    packages = lock.get("packages") or {}
    out: dict[str, dict[str, Any]] = {}
    if isinstance(packages, dict):
        for key, entry in packages.items():
            if (
                isinstance(key, str)
                and isinstance(entry, dict)
                and key.startswith("node_modules/@")
            ):
                out[key.removeprefix("node_modules/")] = entry
    return out


def spec_is_local_or_git(spec: str) -> bool:
    return spec.startswith(("file:", "git+", "github:", "git:"))


def entry_problems(name: str, spec: str, entry: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    resolved = str(entry.get("resolved") or "")
    if "npm.pkg.github.com" in resolved:
        problems.append(f"{name}: lock resolved still uses GitHub Packages: {resolved!r}")
    if not spec_is_local_or_git(spec):
        problems.append(
            f"{name}: spec {spec!r} is not file: or git+; hosted install would hit a registry"
        )
    if spec.startswith("file:") and not entry.get("link"):
        problems.append(f"{name}: file: spec must be a lockfile link:true entry")
    return problems


def main() -> int:
    package = _load_json(Path(DEFAULT_PKG))
    lock = _load_json(Path(DEFAULT_LOCK))
    if package is None:
        print(f"validate_gh_package_deps: {DEFAULT_PKG} unreadable; skipping", file=sys.stderr)
        return 0
    deps = scoped_deps(package)
    if not deps:
        return 0
    entries = lock_entries(lock or {})
    problems: list[str] = []
    for name, spec in sorted(deps.items()):
        entry = entries.get(name)
        if not entry:
            problems.append(f"{name}: declared ({spec}) but missing from package-lock.json")
            continue
        problems.extend(entry_problems(name, spec, entry))
    for problem in problems:
        print(f"validate_gh_package_deps: {problem}", file=sys.stderr)
    if problems:
        print(f"validate_gh_package_deps: {len(problems)} problem(s) found", file=sys.stderr)
        return 1
    print(f"validate_gh_package_deps: {len(deps)} @quantum-l9 dep(s) are file:/git+ (no Packages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

## Summary

<!-- One-sentence description of what this PR does. -->

## Type of Change

- [ ] Bug fix
- [ ] Feature / enhancement
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] CI / governance change
- [ ] Breaking change (see rollback plan below)

---

## Governance Checklist

- [ ] **Governance setup verified** — ran `setup_workspace_symlinks.sh`, symlinks resolve ([§2](https://github.com/Quantum-L9/Cursor-Governance/blob/main/CANONICAL_LAW.md#2-symlink-contract))
- [ ] **Symlinks validated** — `ls -la .cursor/rules .cursor/skills .cursor/commands` all resolve
- [ ] **All CI gates green** — no required checks failing or bypassed
- [ ] **Anti-patterns checked** — reviewed [CANONICAL_LAW.md §7](https://github.com/Quantum-L9/Cursor-Governance/blob/main/CANONICAL_LAW.md#7-anti-patterns) — none violated
- [ ] **CODEOWNERS notified** — blast-radius files trigger auto-request; confirmed reviewers assigned
- [ ] **Workspace wiring intact** — [§8](https://github.com/Quantum-L9/Cursor-Governance/blob/main/CANONICAL_LAW.md#8) wiring requirements satisfied
- [ ] **TRACEABILITY_MAP.yaml updated** — if this PR resolves an open unknown, mark as RESOLVED
- [ ] **Kernel ref discipline** — thin callers use `@v1`, never `@main` or bare SHA

---

## Breaking Change

- [ ] This is a breaking change

If checked, describe the impact and migration path:

<!-- What breaks? Who is affected? How do they migrate? -->

## Rollback Plan

<!-- For blast-radius changes (health files, workflow-templates, kernel interfaces): -->
<!-- Describe the exact rollback procedure if this change causes incidents. -->

---

## Related Issues

Closes #<!-- issue number -->

---
name: context-orientation
description: Orient through the Contextum AI context layer before any coding, review, planning, or debugging task. Use first to read the smallest reliable context set and avoid full-repository rediscovery.
---

# context-orientation

Use this skill at the start of every coding, review, planning, or debugging task in a repository that uses Contextum.

## Purpose

Orient the agent through persistent engineering memory before touching source code. The goal is to read the smallest reliable context set, verify it against code, and avoid full-repository rediscovery unless the context is stale or insufficient.

## Required read order

1. `AGENTS.md`
2. `ai-context/README.md`
3. `ai-context/context.yml`
4. `ai-context/code-map.md`
5. `ai-context/integrations.md`
6. `ai-context/business-features.md`
7. `ai-context/change-impact.md` for risky changes
8. `ai-context/repository-boundaries.md` when scope is unclear
9. `ai-context/decisions.md` when architecture is involved
10. `ai-context/unknowns.md` when facts are missing

## Task routing

- Feature work: read business-features, code-map, change-impact, repository-boundaries.
- Integration work: read integrations, runtime, data-model, change-impact.
- Runtime or deployment work: read runtime, integrations, architecture-flows, freshness.
- Data changes: read data-model, change-impact, decisions, unknowns.
- Review work: read change-impact, decisions, integrations, modified files only.
- Context maintenance: read freshness, lifecycle, unknowns, context.yml.

## Operating rules

- Do not treat generated context as truth until verified against source code.
- Prefer low confidence over invented certainty.
- Add unknowns to `ai-context/unknowns.md` instead of guessing.
- Update the relevant context files after behavior, contracts, architecture, or structure changes.

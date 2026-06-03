# AGENTS.md — Canonical AI Instructions

This repository uses **Contextum** — a persistent AI context layer.
**This file is the single source of truth.** All other agent files
(`CLAUDE.md`, `CODEX.md`, `GEMINI.md`, Cursor/Copilot rules, etc.) are thin
wrappers that point here.

> Repository: **task-api** · type: node · language: JavaScript

## Before changing code

1. Read `AGENTS.md` (this file).
2. Read `ai-context/README.md`.
3. Read `ai-context/context.yml`.
4. Read `ai-context/code-map.md`.
5. Read `ai-context/integrations.md`.
6. Read `ai-context/business-features.md`.
7. Read `ai-context/change-impact.md` **if the task is risky**.
8. Read `ai-context/repository-boundaries.md` **if unsure about scope**.

**Do not scan the full repository** unless the context is stale or insufficient.
**Always verify context against the actual code** — context can drift.

## After implementing

- Update `ai-context/freshness.md` (and the changelog section there).
- Update `ai-context/integrations.md` if any contract changed.
- Update `ai-context/business-features.md` if behavior changed.
- Update `ai-context/code-map.md` if structure changed.
- Update `ai-context/decisions.md` if an architectural decision was made.

## Trust & honesty rules

- Prefer **low confidence** over hallucinated certainty.
- Treat **unknowns as first-class** — log them in `ai-context/unknowns.md`.
- Never fabricate integrations, contracts, or runtime behavior.

Run `contextum validate` and `contextum doctor` to check this layer.

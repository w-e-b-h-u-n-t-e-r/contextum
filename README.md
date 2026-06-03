# Contextum

**Persistent engineering memory for AI-native software development.**

Contextum builds and maintains a structured, machine-readable **AI Context Layer**
inside any repository, so AI coding agents — Claude, Codex, Cursor, Copilot, Gemini,
and others — stop rediscovering the same codebase on every session.

It is **not** a docs generator, **not** RAG, and **not** repository indexing. It is the
foundation layer that makes an existing engineering system safe and cheap for AI agents
to work in:

```
add Contextum to your repo  →  agents read ai-context/  →  faster, safer, cheaper changes
```

---

## Why it exists

Without a context layer, every agent session re-spends tokens and time inferring the
same things: what the repo does, where features live, which integrations exist, which
contracts must not break, which files are high-risk. That causes wasted tokens, unstable
reasoning, duplicated code, and unsafe edits.

Contextum captures the answers **once**, keeps them in Git next to the code, and makes
agents read them before they act — then keep them up to date afterwards.

---

## Install

```bash
npm install -g contextum
# or run without installing
npx contextum init
```

Requires Node.js 18+.

---

## Quick start

```bash
contextum init --agent-pack   # write AGENTS.md + ai-context/ + tool wrappers + Claude agent pack
contextum fill --agent claude # let an AI agent fill the context from the real code (optional)
contextum doctor              # honest readiness scorecard
contextum validate            # structural validation (CI-friendly; exits non-zero on errors)
```

---

## What Contextum builds

Contextum produces several layers. Each one answers a different question an agent (or a
new teammate) would otherwise have to re-derive.

### 1. The context layer — `ai-context/`

Human- and machine-readable engineering memory. Markdown files for understanding plus a
machine-readable index:

| File | Answers |
| --- | --- |
| `context.yml` | Machine-readable index: repo type, language, package manager, signals, runtime commands. |
| `README.md` | Human summary of the layer. |
| `code-map.md` | Where things live. |
| `business-features.md` | What the system does, by capability. |
| `integrations.md` | Inbound/outbound systems and the contracts that must not break. |
| `runtime.md` | How to install, build, test, run, deploy. |
| `data-model.md` | Data stores, schemas, and data invariants. |
| `architecture-flows.md` | Runtime flows (Mermaid). |
| `change-impact.md` | Blast radius of risky changes. |
| `repository-boundaries.md` | What belongs here vs. elsewhere. |
| `decisions.md` | Architecture Decision Records (ADRs). |
| `relationships.md` | Non-obvious cross-cutting relationships (see below). |
| `unknowns.md` | Open questions — engineering backlog, not failure. |
| `lifecycle.md` | Trust state: auto_generated → reviewed → trusted → stale → deprecated. |
| `freshness.md` | When/how the layer was last validated, plus a changelog. |
| `agent-workflows.md` | How multiple agents cooperate. |

### 2. The agent pack — `AGENTS.md` + wrappers + `.claude/`

`AGENTS.md` is the **single source of truth**. Every tool-specific file (`CLAUDE.md`,
`CODEX.md`, `GEMINI.md`, Cursor/Copilot/JetBrains rules, …) is a short wrapper that points
back to it — instructions are never duplicated.

With `--agent-pack`, Contextum also writes a Claude-compatible pack under `.claude/`:

- `.claude/skills/context-orientation/SKILL.md` — an orientation skill that tells an agent
  which context to read, in what order, for a given task, instead of scanning everything.
- `.claude/agents/*.md` — role prompts (context-auditor, implementation-agent, a
  **review-only** reviewer, context-maintainer).

### 3. The code graph + symbol map — `ai-context/diagrams/`

- `code-graph.json` / `code-graph.mmd` — a real dependency graph built with
  **dependency-cruiser** (file-level edges in JSON, a directory-bucketed Mermaid overview),
  with a zero-dependency heuristic fallback when dependency-cruiser is unavailable.
- `code-symbols.json` — a semantic symbol index: which functions, classes, types, and
  constants are exported by each file, so an agent can find code by name.

Agents are told to navigate via these instead of scanning the whole repository.

### 4. The relationship layer — `ai-context/relationships.md`

First-class, self-contained entries for the **non-obvious** connections that are not
visible from imports or types: shared invariants, implicit contracts, cause/effect across
modules, hidden coupling, and cross-domain analogies. Structural import edges are *not*
duplicated here — those live in the code graph. This is the understanding an experienced
engineer carries in their head; Contextum gives it a home.

### 5. The context index — `ai-context/context-index.json` (vector-DB-ready)

A unified document set assembled from the symbol map, the code graph, and the relationship
layer. Every document is a discrete unit with an empty embedding slot:

```jsonc
{
  "schema": "contextum-context-index/v1",
  "embedding": { "model": null, "dimensions": null, "status": "pending" },
  "documents": [
    { "id": "file:src/store.js", "kind": "file", "level": 0, "text": "...", "tags": ["store"], "embedding": null },
    { "id": "rel:1", "kind": "relationship", "level": 0, "non_obvious": true, "embedding": null },
    { "id": "triad:1", "kind": "triad", "level": 1, "derived": true, "closed": false, "embedding": null }
  ],
  "adjacency": { "nodes": ["..."], "edges": [{ "from": "...", "to": "...", "weight": 1 }] }
}
```

- **Leaf documents** (level 0): files and authored relationships.
- **Triads** (level 1): higher-order bridges derived **algebraically** from pairwise
  relationships that share a node — no embedding calls. Marked `closed` (closed triangle)
  vs. open bridge.
- **No database is created.** The empty `embedding` slots make the export ready to feed into
  a vector or graph database later. `--format ndjson` emits one document per line for bulk
  ingest.

---

## Commands

| Command | What it does |
| --- | --- |
| `contextum init` | Generate `ai-context/`, write canonical `AGENTS.md` + common tool wrappers, and build the code graph/symbol map. `--agent-pack` also writes the Claude skills + role prompts. Idempotent. |
| `contextum generate` | Generate/update the `ai-context/` documents only. |
| `contextum agents` | Write `AGENTS.md` (source of truth) + every tool-specific wrapper. |
| `contextum skills` | Write the Claude-compatible orientation skill and role prompts under `.claude/`. |
| `contextum graph` | Build the dependency graph (`code-graph.mmd` + `.json`) and the symbol map (`code-symbols.json`). |
| `contextum index` | Build the vector-DB-ready context index (`context-index.json`). No database required. |
| `contextum fill` | Use an AI coding agent to fill the context from the real repository (see below). |
| `contextum validate` | Validate structure: required files, valid `context.yml`, freshness, diagrams, links. Exits `1` on errors. |
| `contextum doctor` | Print structure readiness, context quality, agent readiness, trust state, and recommended next actions. |

**Common flags:** `--cwd <dir>` (target repo root), `--force` (overwrite existing files).
`contextum index` supports `--format json|ndjson`. `contextum fill` supports
`--agent claude|codex`, `--agent-command <cmd>`, `--agent-sandbox <mode>`,
`--bypass-agent-sandbox`, and `--dry-run`.

---

## Filling the context from real code

`contextum init` writes honest templates with `TODO`s. `contextum fill` hands an AI coding
agent a strict prompt and lets it turn those templates into accurate, source-verified
context:

```bash
contextum fill --agent claude          # drive Claude Code
contextum fill --agent codex           # drive Codex
contextum fill --agent claude --dry-run  # print the prompt, run nothing
```

The fill prompt:

- discovers and reconciles **existing repository docs** (README, `docs/`, ADRs, OpenAPI, …),
- points the agent at the **code graph + symbol map** for navigation,
- forbids fabrication — unknowns stay `UNKNOWN` and go to `unknowns.md`,
- asks the agent to author **non-obvious relationships**, and
- keeps the trust state at `auto_generated` until a human reviews it.

After a successful fill, the code graph and context index are rebuilt automatically.

---

## What gets created

```
AGENTS.md                      # canonical instructions (source of truth)
CLAUDE.md / CODEX.md / GEMINI.md
.cursor/rules/contextum.mdc
.github/copilot-instructions.md
.aiassistant/rules.md
.claude/
  skills/context-orientation/SKILL.md
  agents/{context-auditor,implementation-agent,reviewer,context-maintainer}.md
ai-context/
  context.yml
  README.md  code-map.md  business-features.md  integrations.md
  runtime.md  data-model.md  architecture-flows.md  change-impact.md
  repository-boundaries.md  decisions.md  relationships.md  unknowns.md
  lifecycle.md  freshness.md  agent-workflows.md
  context-index.json           # vector-DB-ready export
  diagrams/
    runtime-flow.mmd  dependency-graph.mmd  blast-radius.mmd
    code-graph.mmd  code-graph.json  code-symbols.json
```

---

## Try it on the bundled example

This repository ships `examples/task-api` — a small, zero-dependency REST API — with a full
Contextum layer applied, so you can see every artifact end to end:

```bash
cd examples/task-api
node src/server.js               # the app runs
curl -s localhost:3000/tasks     # it works

contextum doctor                 # 100% structure, agent-ready
cat ai-context/context-index.json
```

---

## How `doctor` scores

Contextum separates **structure** from **trust** — having files is not proof of quality:

- **Structure readiness** — are the required files present?
- **Context quality** — penalizes unfilled `TODO` placeholders. An honest `UNKNOWN`
  (e.g. `Owner: UNKNOWN`) is *not* a defect; only `context.yml` field placeholders are.
- **Agent readiness** — `AGENTS.md`, core wrappers, orientation skill, and role prompts.
- **Trust state** — `auto_generated` until a human reviews and promotes it.

---

## Design principles

1. **Be honest.** Mark unknowns; prefer low confidence over hallucinated certainty.
2. **Be lightweight.** Updating context must be cheaper than rediscovering the repo.
3. **Be tool-compatible.** One canonical file, many thin wrappers.
4. **Be repository-first.** Git is the source of truth.
5. **Be runtime-aware.** Operational behavior, not just code structure.
6. **Be extensible.** Profiles and adapters per stack and language.

---

## Develop

```bash
npm install
npm run build       # bundle to dist/ via tsup
npm test            # vitest
npm run typecheck   # tsc --noEmit
node dist/cli.js doctor --cwd /path/to/some/repo
```

---

## Status & roadmap

Available today: the context layer, the agent pack, the dependency graph + symbol map, the
relationship layer, the vector-DB-ready context index (with algebraically-derived triads),
and the agent-driven `fill` workflow.

Deliberately **not** built yet: the database itself. The context index ships with empty
embedding slots so it can later be loaded into a vector or graph database without changing
the on-disk format.

MIT licensed.

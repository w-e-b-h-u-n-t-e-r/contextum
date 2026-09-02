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
contextum setup               # one-command setup: context + center + project MCP config
contextum center init         # create local multi-agent coordination state
contextum mcp install         # write project .mcp.json for Claude/Codex shared memory
contextum mcp                 # start MCP server over stdio
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

## Multi-Agent Center

`contextum center init` creates a local coordination directory for multi-agent work:

```text
.contextum/
  README.md
  center.yml
  project.json
  tasks.json
  agents.json
  locks.json
  execution-state.json
  events.jsonl
  schemas/
```

Use this as operational state for agents: task ownership, active sessions, temporary locks, and handoff notes. Keep durable engineering facts in `AGENTS.md` and `ai-context/`; `.contextum/` is the coordination layer, not the source of truth.

The local store is project-scoped by default: every repository gets its own `.contextum/project.json` and state files. This avoids memory bleed between unrelated projects and keeps the same behavior on Windows, Ubuntu, and macOS.

The center also writes JSON Schemas for the operational entities under `.contextum/schemas/`: task, agent, lock, event, and execution state. These are intentionally small, file-based primitives that can later be exposed through MCP without changing the repository's source-of-truth documents.

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
| `contextum setup` | Interactive one-command setup: generate Contextum files, create `.contextum/`, install project MCP config, and recommend the Claude author + Codex reviewer workflow. |
| `contextum center init` | Create `.contextum/` local coordination state for multi-agent tasks, sessions, locks, and handoffs. |
| `contextum mcp install` | Write/update project `.mcp.json` so MCP-capable agents can connect to the same repository memory. Existing entries are preserved; `contextum` is only replaced with `--force`. |
| `contextum mcp` | Start the MCP server over stdio for context, center inspection, task/lock coordination, handoffs, and execution-state updates. |
| `contextum fill` | Use an AI coding agent to fill the context from the real repository (see below). |
| `contextum validate` | Validate structure: required files, valid `context.yml`, freshness, diagrams, links. Exits `1` on errors. |
| `contextum doctor` | Print structure readiness, context quality, agent readiness, trust state, and recommended next actions. |

**Common flags:** `--cwd <dir>` (target repo root), `--force` (overwrite existing files).
`contextum index` supports `--format json|ndjson`. `contextum center init` and `contextum mcp install` support `--force`. `contextum setup` supports `--yes` for non-interactive installs. `contextum fill` supports
`--agent claude|codex`, `--agent-command <cmd>`, `--agent-sandbox <mode>`,
`--bypass-agent-sandbox`, and `--dry-run`.

---

## SKILL.state-inspired execution state

Contextum's multi-agent center includes `.contextum/execution-state.json`, inspired by the SKILL.state paper's separation of immutable procedure, mutable execution state, and latest observation.

In Contextum terms:

```text
Immutable procedure       -> AGENTS.md + relevant ai-context files
Mutable execution state   -> .contextum/execution-state.json
Latest observation        -> latest tool result / terminal output / review finding
Long-term repo memory     -> ai-context/
Operational event history -> .contextum/events.jsonl
```

The intent is to let long-running agents keep compact, explicit state instead of relying on ever-growing transcript history. Durable facts still move into `ai-context/` after review.

Patch semantics are explicit, so a turn that records one new fact does not erase the rest:

```jsonc
{ "id": "run-1", "patch": { "facts_add": ["router has 4 routes"] } }  // append
{ "id": "run-1", "patch": { "facts": ["only this"] } }                 // replace
```

---

## One-command setup

For a new or existing repository, the recommended install path is:

```bash
contextum setup --cwd <repo-path>
```

For CI, templates, or scripted onboarding:

```bash
contextum setup --cwd <repo-path> --yes
```

The setup command is intentionally conservative. It generates the context layer, installs the agent pack, creates `.contextum/`, and writes project MCP config. Existing Contextum-managed files are skipped unless `--force` is provided. Existing unrelated `.mcp.json` servers are preserved.

If you only need MCP config after a manual install:

```bash
contextum mcp install --cwd <repo-path>
```

Use `--force` only when you intentionally want to replace the existing `contextum` server entry in `.mcp.json`.

The installer writes a launcher that actually resolves on the current machine: a global
`contextum` when it is on `PATH`, `npx contextum` when the repository has it in
`node_modules`, and an `npx -y contextum@<version>` fallback with a warning otherwise.
Pass `--command <path>` to point at a local checkout instead.

## Tango workflow: Claude authors, Codex reviews

Contextum recommends the two-agent review loop by default:

1. Claude implements the change in the repo or in a Claude worktree.
2. Codex reviews the actual diff in a review-only stance. Findings come first, with file/line references.
3. Claude or the original author fixes the findings.
4. Accepted architecture or memory changes are recorded into `ai-context/`; transient task state stays in `.contextum/`.

Both agents should use the same Contextum MCP server for the same repository:

```bash
contextum mcp --cwd <repo-path>
```

Claude Code can consume the project `.mcp.json` written by `contextum mcp install`. Codex or any other MCP-capable reviewer should be configured to use the same stdio command when its client supports MCP. The important invariant is that all reviewers and authors read and update the same project-scoped memory: `AGENTS.md`, `ai-context/`, and `.contextum/`.

## Multi-account Claude setup

For two Claude Code accounts on one machine, keep account state separate but point both accounts to the same project MCP server.

Example local commands:

```text
claude    -> primary Claude account
claude-b  -> secondary Claude account using CLAUDE_CONFIG_DIR
```

Both profiles should connect to the same MCP server command for the repository. `contextum mcp install --cwd <repo-path>` writes the project `.mcp.json` entry for Claude Code; manual clients can use:

```bash
contextum mcp --cwd <repo-path>
```

Result:

```text
primary Claude account   -> same repo MCP -> same ai-context/ + .contextum/
secondary Claude account -> same repo MCP -> same ai-context/ + .contextum/
```

The accounts do not share credentials or Claude session history. They share only repository memory exposed by MCP:

```text
Durable memory      -> AGENTS.md + ai-context/
Coordination memory -> .contextum/tasks.json, agents.json, locks.json, events.jsonl
Execution state     -> .contextum/execution-state.json
Search/index layer  -> ai-context/context-index.json
```

---

## Cross-platform storage model

Contextum uses a file-backed, project-scoped store by default:

```text
<repo-path>/.contextum/
```

This is intentionally portable across Windows, Ubuntu, and macOS because all runtime code uses Node path APIs and the MCP server is started with an explicit repository root:

```bash
contextum mcp --cwd <repo-path>
```

Project memory separation is based on repository-local state, not a global shared database. Two repositories never share tasks, locks, agents, or execution state unless a future deployment explicitly opts into a shared remote backend.

Default storage rule:

```text
one repository -> one .contextum/ store -> one project memory namespace
```

`center init` also writes `.contextum/.gitignore`, so configuration and schemas stay in
Git while volatile runtime state does not:

```text
tracked:  center.yml, project.json, mcp.json, schemas/, README.md
ignored:  tasks.json, agents.json, locks.json, execution-state.json, events.jsonl, .lock/
```

`project.json` holds a stable random project id and no machine paths, so the file survives
being committed and cloned onto another operating system.

---

## MCP foundation

`contextum mcp` starts a Model Context Protocol server over stdio:

```bash
contextum mcp --cwd <repo-path>
```

Initial tools:

| Tool | Purpose |
| --- | --- |
| `contextum.repo_status` | Summarize whether `AGENTS.md`, `ai-context/`, and `.contextum/` exist. |
| `contextum.list_context_files` | List whitelisted context files available to read. |
| `contextum.shared_memory_status` | Explain the project-scoped shared memory model for connected agents. |
| `contextum.search_context` | Search whitelisted context files and `context-index.json`; a single incidental term match is filtered out as noise. |
| `contextum.read_context` | Read a whitelisted `AGENTS.md` or `ai-context/` file. |
| `contextum.list_tasks` | Read `.contextum/tasks.json`. |
| `contextum.list_agents` | Read `.contextum/agents.json`. |
| `contextum.list_locks` | Read `.contextum/locks.json`. |
| `contextum.list_events` | Read recent events and handoffs back from `.contextum/events.jsonl`. |
| `contextum.read_execution_state` | Read `.contextum/execution-state.json`. |
| `contextum.create_task` | Create a task and append a task event. |
| `contextum.claim_task` | Claim a task with ownership conflict checks. |
| `contextum.update_task` | Move a task through `open → claimed → review → done` (or `blocked`/`cancelled`) and update its metadata. |
| `contextum.release_task` | Release a task back to open state. |
| `contextum.register_agent` | Register or refresh an agent session. |
| `contextum.acquire_lock` | Acquire a cooperative lock over a path or context area. |
| `contextum.release_lock` | Release a cooperative lock by id or scope. |
| `contextum.record_handoff` | Append a handoff event. |
| `contextum.patch_execution_state` | Upsert compact execution state; `<field>` replaces a list, `<field>_add` appends to it. |

Read operations cover `AGENTS.md`, `ai-context/`, and `.contextum/`. Write operations are intentionally narrow and only modify `.contextum/`; they do not rewrite product source or source-of-truth context files.

Tools carry `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so a client can gate the mutating ones. Protocol errors (unknown tool, malformed call) come back as JSON-RPC errors; business-logic failures such as "task is already claimed" come back as `isError: true` tool results, so the model can read the reason and self-correct.

### Concurrency and durability

Two agents run as two processes against one repository, so every mutation takes a
single-writer lock (`.contextum/.lock`, an atomic `mkdir`) and every file is replaced
atomically (temp file + rename). That is what makes `claim_task` and `acquire_lock`
actual mutual exclusion rather than an advisory check:

```text
20 parallel create_task across 4 processes -> 20 persisted, 0 lost
2 simultaneous claims of one task          -> exactly 1 accepted
2 simultaneous locks on one scope          -> exactly 1 holder
```

A stale lock left by a crashed process is broken automatically after 30s.

---

## Research-informed design principles

Contextum's multi-agent direction follows a few current agent-runtime patterns:

1. **Explicit execution state over transcript accumulation.** SKILL.state argues that long-running agents should receive an immutable procedure, current structured execution state, and latest observation, rather than an ever-growing dialogue history. Contextum maps this to `AGENTS.md` + `ai-context/` as the procedure/context layer and `.contextum/execution-state.json` as compact mutable run state.
2. **Durable memory and operational state are separate.** Durable repository facts live in Git-reviewed `ai-context/`. Task claims, active agents, locks, handoffs, and current execution state live in `.contextum/`.
3. **MCP writes are narrow and repo-local.** MCP standardizes access to tools, resources, and prompts. Contextum read tools expose only whitelisted context files, while write tools only update `.contextum/` operational state.
4. **Writes require explicit commands and conflict checks.** MCP write tools are narrow: create or claim a task, release a task, register an agent, acquire or release a lock, append a handoff, or patch execution state. Each write records an event in `.contextum/events.jsonl`.
5. **Shared operational memory is untrusted input.** Tasks, handoffs, and execution state
   are written by one agent and read by another, so they are data, not instructions. Agents
   should treat `.contextum/` content as untrusted; reviewed facts belong in `ai-context/`,
   which passes through Git review.
6. **Human control remains part of the workflow.** MCP tool use can expose powerful actions, so Contextum keeps source-of-truth changes in files that can be reviewed through normal Git diff and code review.

References:

- SKILL.state: Scalable Long-Horizon Agent Skills: https://arxiv.org/abs/2608.26263
- Model Context Protocol specification: https://modelcontextprotocol.io/specification/2025-06-18
- MCP server tools specification: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Claude Code MCP documentation: https://code.claude.com/docs/en/mcp

---

## Safe adoption on existing AI-driven repos

Contextum is designed to be installed on repositories that already have AI instructions, Claude skills, Cursor rules, or an existing `ai-context/` layer.

Default behavior is conservative:

- existing files are skipped, not overwritten
- `--force` is required to replace existing files
- `AGENTS.md` remains the canonical instruction file when present
- tool-specific files such as `CLAUDE.md`, `CODEX.md`, and Cursor rules should be wrappers, not competing sources of truth
- existing `.claude/agents` and `.claude/skills` files are preserved unless `--force` is used
- unknown or conflicting facts should be recorded in `ai-context/unknowns.md`, not guessed

Recommended adoption flow for an existing AI-driven repository:

```bash
contextum doctor --cwd <repo-path>
contextum init --cwd <repo-path> --agent-pack
contextum validate --cwd <repo-path>
git diff
```

Review the diff before committing. If the repository already had strong AI rules, keep them and use Contextum to add missing structure around them.

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

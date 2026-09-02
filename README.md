# Contextum

[![npm](https://img.shields.io/npm/v/contextum)](https://www.npmjs.com/package/contextum)
[![node](https://img.shields.io/node/v/contextum)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/contextum)](./LICENSE)

**Persistent engineering memory and a multi-agent coordination center for AI-native development.**

Contextum builds a structured, machine-readable **AI Context Layer** inside any repository,
then exposes it — plus a shared task/lock/state store — over **MCP**, so several coding
agents (two Claude profiles, a Codex reviewer, Cursor, Copilot, Gemini) work from the same
memory instead of rediscovering the codebase on every session.

It is **not** a docs generator, **not** RAG, and **not** repository indexing.

```
contextum setup  →  agents read ai-context/  →  agents coordinate through .contextum/
                 →  faster, safer, cheaper changes
```

---

## Why it exists

Without a context layer, every agent session re-spends tokens inferring the same things:
what the repo does, where features live, which contracts must not break, which files are
high-risk. Without a coordination layer, two agents in one repository silently overwrite
each other's work and each other's assumptions.

Contextum captures the answers **once**, keeps them in Git next to the code, and gives
agents a durable place to record what they are doing right now.

---

## Install

Requires **Node.js 18+**. Works on Linux, macOS, and Windows.

### Globally (recommended)

```bash
npm install -g contextum
contextum --version        # contextum/0.2.0
```

A global install also produces the shortest MCP config: the generated launcher is a bare
`contextum`, with no `npx` round-trip on every agent start.

### Without installing

```bash
npx contextum setup --cwd .
```

Every command works the same way through `npx contextum …`.

### As a project dev dependency

```bash
npm install -D contextum
npx contextum setup
```

The installer detects the local binary and writes `npx contextum` as the launcher, so
teammates get the same version pinned by your lockfile.

### Set up a repository

```bash
cd <your-repo>
contextum setup            # interactive; add --yes for CI
contextum doctor           # see where the context stands
```

Safe on repositories that already have `AGENTS.md`, `CLAUDE.md`, `.claude/`, Cursor rules,
or their own `ai-context/` — existing files are skipped, never overwritten. See
[Safe adoption](#13-safe-adoption-on-an-existing-ai-driven-repo).

### Connect the MCP server

`contextum setup` already wrote `.mcp.json` in the repository. Open Claude Code there and
run `/mcp` to approve and inspect the server — nothing else is required, and every Claude
profile opened in that repository picks up the same config.

To register it explicitly, or in another scope:

```bash
claude mcp add --scope project contextum -- contextum mcp --cwd "$PWD"
claude mcp add --scope user    contextum -- contextum mcp --cwd "$PWD"
```

For a second Claude account on the same machine, start it with its own config directory —
the project `.mcp.json` is shared, the credentials are not:

```bash
CLAUDE_CONFIG_DIR="$HOME/.config/claude-profiles/secondary" claude
```

Codex and any other MCP-capable client connect to the same stdio command:

```bash
contextum mcp --cwd <repo-path>
```

### Verify the install

```bash
contextum doctor --cwd <repo-path>

printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | contextum mcp --cwd <repo-path>          # expect 19 tools
```

### Update and remove

```bash
npm update -g contextum
npm uninstall -g contextum     # leaves ai-context/ and .contextum/ untouched
```

---

## Quick start

One command sets up everything and is safe to run on a repository that already has AI files:

```bash
contextum setup --cwd <repo-path>          # interactive
contextum setup --cwd <repo-path> --yes    # CI / scripted
```

It writes the context layer, the agent pack, the multi-agent center, and the project MCP
config. Existing files are **skipped**, never overwritten, unless you pass `--force`.

Then check the result and let an agent fill the templates from real code:

```bash
contextum doctor     # readiness scorecard
contextum fill --agent claude
contextum validate   # exits non-zero on structural errors (CI-friendly)
```

---

## What gets created

```text
AGENTS.md                       # canonical instructions (source of truth)
CLAUDE.md / CODEX.md / GEMINI.md
.cursor/rules/contextum.mdc
.github/copilot-instructions.md
.aiassistant/rules.md
.mcp.json                       # project MCP server, shared by every agent
.claude/
  skills/context-orientation/SKILL.md
  agents/{context-auditor,implementation-agent,reviewer,context-maintainer}.md
ai-context/                     # durable engineering memory (in Git)
  context.yml
  README.md  code-map.md  business-features.md  integrations.md
  runtime.md  data-model.md  architecture-flows.md  change-impact.md
  repository-boundaries.md  decisions.md  relationships.md  unknowns.md
  lifecycle.md  freshness.md  agent-workflows.md
  context-index.json            # vector-DB-ready export
  diagrams/
    runtime-flow.mmd  dependency-graph.mmd  blast-radius.mmd
    code-graph.mmd  code-graph.json  code-symbols.json
.contextum/                     # operational state (mostly gitignored)
  center.yml  project.json  mcp.json  .gitignore
  tasks.json  agents.json  locks.json  execution-state.json  events.jsonl
  schemas/
```

---

## Feature map — what each piece is for

| Capability | Problem it solves | Where it lives |
| --- | --- | --- |
| **Context layer** | Agents re-derive the same architecture every session | `ai-context/` |
| **Agent pack** | Every tool needs its own instruction file, and they drift apart | `AGENTS.md` + thin wrappers + `.claude/` |
| **Code graph + symbol map** | Agents scan the whole repo to find one function | `ai-context/diagrams/` |
| **Relationship layer** | Non-obvious coupling lives only in a senior engineer's head | `ai-context/relationships.md` |
| **Context index** | You want semantic retrieval later without re-modelling anything | `ai-context/context-index.json` |
| **Multi-agent center** | Two agents claim the same work and overwrite each other | `.contextum/` |
| **Execution state** | Long sessions blow up the context window with transcript history | `.contextum/execution-state.json` |
| **MCP server** | Each agent has its own private view of the repository | `contextum mcp` |
| **Doctor / validate** | "We have docs" is not the same as "the docs are true" | `contextum doctor`, `contextum validate` |

---

## Commands

| Command | What it does |
| --- | --- |
| `contextum setup` | One command: context layer + agent pack + `.contextum/` + project MCP config. Interactive unless `--yes`. |
| `contextum init` | Generate `ai-context/`, canonical `AGENTS.md`, tool wrappers, code graph, symbol map. `--agent-pack` adds Claude skills + role prompts. Idempotent. |
| `contextum generate` | Generate/update the `ai-context/` documents only. |
| `contextum agents` | Write `AGENTS.md` (source of truth) + every tool-specific wrapper. |
| `contextum skills` | Write the Claude-compatible orientation skill and role prompts under `.claude/`. |
| `contextum graph` | Build the dependency graph (`code-graph.mmd` + `.json`) and the symbol map. |
| `contextum index` | Build the vector-DB-ready context index. No database required. |
| `contextum center init` | Create `.contextum/` — tasks, agent sessions, locks, execution state, events, schemas. |
| `contextum mcp install` | Write/update project `.mcp.json` with a launcher that resolves on this machine. |
| `contextum mcp` | Start the MCP server over stdio. |
| `contextum fill` | Drive an AI agent to fill the context from the real repository. |
| `contextum validate` | Validate structure: required files, valid `context.yml`, freshness, diagrams, links. Exits `1` on errors. |
| `contextum doctor` | Structure readiness, context quality, agent readiness, trust state, next actions. |

**Flags**

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--cwd <dir>` | all | Target repository root (default: current directory) |
| `--force` | `init`, `generate`, `agents`, `skills`, `graph`, `index`, `center init`, `mcp install`, `setup` | Overwrite existing Contextum-managed files |
| `--yes` | `setup` | Run non-interactively |
| `--command <cmd>` | `setup`, `mcp install` | Launcher to write into `.mcp.json` instead of the detected one |
| `--agent-pack` | `init` | Also write Claude skills and role prompts |
| `--format json\|ndjson` | `index` | Output format for the context index |
| `--agent claude\|codex`, `--agent-command`, `--agent-sandbox`, `--bypass-agent-sandbox`, `--dry-run` | `fill` | Which agent to drive and how |

---

## 1. The context layer — `ai-context/`

Human- and machine-readable engineering memory, kept in Git next to the code.

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
| `decisions.md` | Architecture Decision Records. |
| `relationships.md` | Non-obvious cross-cutting relationships. |
| `unknowns.md` | Open questions — engineering backlog, not failure. |
| `lifecycle.md` | Trust state: `auto_generated → reviewed → trusted → stale → deprecated`. |
| `freshness.md` | When/how the layer was last validated, plus a changelog. |
| `agent-workflows.md` | How multiple agents cooperate. |

---

## 2. The agent pack — `AGENTS.md` + wrappers + `.claude/`

`AGENTS.md` is the **single source of truth**. `CLAUDE.md`, `CODEX.md`, `GEMINI.md`,
Cursor/Copilot/JetBrains rules are short wrappers that point back to it, so instructions
are never duplicated and never drift.

With `--agent-pack`, Contextum also writes:

- `.claude/skills/context-orientation/SKILL.md` — tells an agent which context to read, in
  what order, for a given task, instead of scanning everything.
- `.claude/agents/*.md` — role prompts: `context-auditor`, `implementation-agent`, a
  **review-only** `reviewer`, and `context-maintainer`.

---

## 3. The code graph + symbol map — `ai-context/diagrams/`

- `code-graph.json` / `code-graph.mmd` — a real dependency graph built with
  **dependency-cruiser** (file-level edges in JSON, a directory-bucketed Mermaid overview),
  with a zero-dependency heuristic fallback.
- `code-symbols.json` — which functions, classes, types, and constants each file exports,
  so an agent can find code by name.

Agents are instructed to navigate via these instead of scanning the repository.

---

## 4. The relationship layer — `ai-context/relationships.md`

First-class entries for the **non-obvious** connections that imports and types cannot show:
shared invariants, implicit contracts, cause/effect across modules, hidden coupling,
cross-domain analogies. Structural import edges are *not* duplicated here — those live in
the code graph.

```markdown
### reservation-lock ⇄ money-precision
- Type: shared-invariant
- Why it matters: both protect no-double-sale
- Evidence: src/vault.ts, src/pricing.ts
- Confidence: high
- Non-obvious: yes
```

---

## 5. The context index — `ai-context/context-index.json`

A unified document set assembled from the symbol map, the code graph, and the relationship
layer, with empty embedding slots so it can be loaded into a vector or graph database later
without changing the on-disk format.

```jsonc
{
  "schema": "contextum-context-index/v1",
  "embedding": { "model": null, "dimensions": null, "status": "pending" },
  "documents": [
    { "id": "file:src/store.js", "kind": "file",         "level": 0, "embedding": null },
    { "id": "rel:1",             "kind": "relationship", "level": 0, "non_obvious": true },
    { "id": "triad:1",           "kind": "triad",        "level": 1, "derived": true, "closed": false }
  ],
  "adjacency": { "nodes": ["..."], "edges": [{ "from": "...", "to": "...", "weight": 1 }] }
}
```

**Triads** (level 1) are higher-order bridges derived *algebraically* from pairwise
relationships that share a node — no embedding calls. `--format ndjson` emits one document
per line for bulk ingest.

---

## 6. The multi-agent center — `.contextum/`

```bash
contextum center init --cwd <repo-path>
```

```text
.contextum/
  README.md               # how this directory is meant to be used
  .gitignore              # keeps volatile runtime state out of Git
  center.yml              # configuration and policies
  project.json            # portable project identity
  mcp.json                # how agents should connect to this project
  tasks.json              # cooperative task board
  agents.json             # active agent sessions
  locks.json              # cooperative leases over paths / context areas
  execution-state.json    # compact state for long-running runs
  events.jsonl            # append-only history: claims, handoffs, reviews, notes
  schemas/                # JSON Schema for each entity
```

The split matters:

```text
AGENTS.md + ai-context/   durable, reviewed engineering memory   → in Git, code-reviewed
.contextum/               operational state for the current work → runtime, mostly ignored
```

### Entities

**Task** — a unit of work an agent can claim and move through a lifecycle.

```jsonc
{
  "id": "task_360ec0f2-…",
  "title": "Add rate limiting",
  "status": "review",              // open | claimed | blocked | review | done | cancelled
  "owner_agent_id": "claude-a",
  "priority": "high",
  "context_areas": ["integrations", "change-impact"],
  "affected_paths": ["src/router.js"],
  "acceptance_checks": ["429 returned after the limit", "existing tests pass"]
}
```

**Agent** — a registered session: which tool, which profile, which worktree, which task.

**Lock** — a cooperative lease over a path or context area, optionally with `ttl_seconds`.

**Event** — append-only history, including handoffs between agents.

**Execution state** — see below.

---

## 7. Execution state — compact memory for long runs

Inspired by [SKILL.state](https://arxiv.org/abs/2608.26263), which separates the immutable
procedure, the mutable execution state, and the latest observation instead of growing the
transcript forever. In Contextum terms:

```text
Immutable procedure       -> AGENTS.md + relevant ai-context files
Mutable execution state   -> .contextum/execution-state.json
Latest observation        -> latest tool result / terminal output / review finding
Long-term repo memory     -> ai-context/
Operational history       -> .contextum/events.jsonl
```

Patch semantics are explicit, so recording one new fact does not erase the rest:

```jsonc
{ "id": "run-1", "patch": { "facts_add": ["router has 4 routes"] } }   // append + dedupe
{ "id": "run-1", "patch": { "facts": ["only this"] } }                 // replace the list
```

`_add` works for `facts`, `decisions`, `open_questions`, `risks`, `touched_paths`, and
`next_actions`. Scalars (`current_goal`, `phase`, `latest_observation`, `status`) always
replace.

---

## 8. The MCP server

```bash
contextum mcp install --cwd <repo-path>   # write .mcp.json
contextum mcp --cwd <repo-path>           # run the server over stdio
```

`mcp install` picks a launcher that actually resolves on this machine — a global
`contextum` on `PATH`, `npx contextum` when the repository has it in `node_modules`, or an
`npx -y contextum@<version>` fallback with a warning. Override it with `--command <path>`
for a local checkout.

```jsonc
// .mcp.json — committed, shared by every agent opened in this repository
{
  "mcpServers": {
    "contextum": {
      "type": "stdio",
      "command": "contextum",
      "args": ["mcp", "--cwd", "${CLAUDE_PROJECT_DIR:-.}"]
    }
  }
}
```

### Read tools

| Tool | Purpose |
| --- | --- |
| `contextum.repo_status` | Does this repo have `AGENTS.md`, `ai-context/`, `.contextum/`? |
| `contextum.list_context_files` | Which context files this server may read. |
| `contextum.shared_memory_status` | The project's shared-memory model and connection rule. |
| `contextum.search_context` | Lexical search over context files and the context index. |
| `contextum.read_context` | Read one whitelisted `AGENTS.md` / `ai-context/` file. |
| `contextum.list_tasks` | The task board. |
| `contextum.list_agents` | Active agent sessions. |
| `contextum.list_locks` | Held locks. |
| `contextum.list_events` | Recent events and handoffs, with filters. |
| `contextum.read_execution_state` | Compact state of long-running runs. |

### Write tools

| Tool | Purpose |
| --- | --- |
| `contextum.create_task` | Put work on the board. |
| `contextum.claim_task` | Take ownership; exactly one agent can win. |
| `contextum.update_task` | Move through `open → claimed → review → done` (or `blocked`/`cancelled`). |
| `contextum.release_task` | Hand work back to the board. |
| `contextum.register_agent` | Register or heartbeat a session; only the fields you pass are updated. |
| `contextum.acquire_lock` | Lease a path or context area, optionally with a TTL. |
| `contextum.release_lock` | Release a lease by id or scope. |
| `contextum.record_handoff` | Leave a message for the next agent. |
| `contextum.patch_execution_state` | Update compact run state. |

**Boundaries.** Reads are limited to a path whitelist — `read_context` refuses anything
outside `AGENTS.md` and `ai-context/`, including traversal attempts. Writes only ever touch
`.contextum/`; the server never rewrites product source or source-of-truth context files,
and every write appends an event.

**Protocol behaviour.** Tools carry `annotations` (`readOnlyHint`, `destructiveHint`,
`idempotentHint`) so a client can gate the mutating ones. Unknown tools and malformed calls
return JSON-RPC errors; business failures such as *"task is already claimed"* return
`isError: true` tool results, so the model reads the reason and self-corrects. Notifications
are never answered, and the protocol version is negotiated with the client.

---

## 9. Worked example — Claude authors, Codex reviews

The recommended two-agent loop, expressed entirely through shared memory.

**Setup once, in the repository:**

```bash
contextum setup --cwd <repo-path> --yes
```

**1. The author registers and takes the work.**

```jsonc
{ "name": "contextum.register_agent",
  "arguments": { "id": "claude-a", "tool": "claude", "profile": "primary",
                 "role": "implementer", "worktree": "rate-limiting" } }

{ "name": "contextum.create_task",
  "arguments": { "title": "Add rate limiting", "priority": "high",
                 "affected_paths": ["src/router.js"],
                 "acceptance_checks": ["429 after the limit", "tests pass"] } }

{ "name": "contextum.claim_task",
  "arguments": { "task_id": "task_360ec0f2-…", "agent_id": "claude-a" } }
```

**2. It leases the risky area so the other agent stays out of it.**

```jsonc
{ "name": "contextum.acquire_lock",
  "arguments": { "scope": "src/router.js", "owner_agent_id": "claude-a",
                 "reason": "editing the request pipeline", "ttl_seconds": 3600 } }
```

A second agent asking for the same scope gets a tool error, not a silent overwrite:

```text
Lock src/router.js is already held by claude-a
```

**3. It keeps run state compact instead of re-reading its own transcript.**

```jsonc
{ "name": "contextum.patch_execution_state",
  "arguments": { "id": "rate-limiting",
                 "patch": { "current_goal": "add rate limiting",
                            "facts_add": ["router has 4 routes", "store is an in-memory Map"],
                            "next_actions_add": ["ask Codex to review"] } } }
```

**4. It hands off for review.**

```jsonc
{ "name": "contextum.update_task",
  "arguments": { "task_id": "task_360ec0f2-…", "agent_id": "claude-a", "status": "review" } }

{ "name": "contextum.record_handoff",
  "arguments": { "message": "Diff ready: token bucket in src/router.js, 429 on overflow",
                 "task_id": "task_360ec0f2-…",
                 "from_agent_id": "claude-a", "to_agent_id": "codex-reviewer" } }
```

**5. The reviewer picks it up from the same store.**

```jsonc
{ "name": "contextum.list_events", "arguments": { "type": "handoff.recorded", "limit": 5 } }
{ "name": "contextum.read_execution_state", "arguments": {} }
{ "name": "contextum.read_context", "arguments": { "path": "ai-context/change-impact.md" } }
```

The reviewer reviews the diff, then records the outcome:

```jsonc
{ "name": "contextum.record_handoff",
  "arguments": { "message": "2 findings: limiter is per-process; no test for the 429 path",
                 "task_id": "task_360ec0f2-…",
                 "from_agent_id": "codex-reviewer", "to_agent_id": "claude-a" } }
```

**6. The author fixes, closes, and promotes durable facts.**

```jsonc
{ "name": "contextum.update_task",
  "arguments": { "task_id": "task_360ec0f2-…", "agent_id": "claude-a", "status": "done" } }

{ "name": "contextum.release_lock",
  "arguments": { "scope": "src/router.js", "owner_agent_id": "claude-a" } }
```

Anything worth remembering beyond this task — a new contract, a decision, a non-obvious
relationship — moves into `ai-context/` and goes through normal code review. `.contextum/`
keeps only what is true right now.

> A non-owner cannot close someone else's task: `update_task` from `codex` on a task owned
> by `claude-a` is rejected with *"Task … is owned by claude-a, not codex"*.

---

## 10. Two Claude accounts on one machine

Keep the accounts separate, point both at the same project server.

```text
claude    -> primary account   (default Claude config)
claude-b  -> secondary account (CLAUDE_CONFIG_DIR-based profile)
```

Both read the project `.mcp.json` written by `contextum mcp install`, so:

```text
primary Claude account   ─┐
secondary Claude account ─┼─→ same repo MCP ─→ same ai-context/ + .contextum/
Codex / other reviewer   ─┘
```

They share **repository memory only** — never credentials or session history:

```text
Durable memory      -> AGENTS.md + ai-context/
Coordination memory -> .contextum/tasks.json, agents.json, locks.json, events.jsonl
Execution state     -> .contextum/execution-state.json
Search/index layer  -> ai-context/context-index.json
```

---

## 11. Concurrency and durability

Agents run as separate processes against one repository, so every mutation takes a
single-writer lock (`.contextum/.lock`, an atomic `mkdir`) and every file is replaced
atomically (temp file + rename). That is what makes `claim_task` and `acquire_lock` real
mutual exclusion rather than an advisory check:

```text
20 parallel create_task across 4 processes -> 20 persisted, 0 lost
2 simultaneous claims of one task          -> exactly 1 accepted
2 simultaneous locks on one scope          -> exactly 1 holder
```

A lock left behind by a crashed process is broken automatically after 30 seconds. If a state
file is ever damaged by something outside Contextum, tools fail with a recovery hint rather
than a raw parse error:

```text
.contextum/tasks.json is not valid JSON (…).
Restore it from Git or reset it with `contextum center init --force`.
```

---

## 12. Storage model and Git hygiene

The store is file-backed and **project-scoped**: one repository, one `.contextum/`, one
memory namespace. Two repositories never share tasks, locks, agents, or execution state.

```text
one repository -> one .contextum/ store -> one project memory namespace
```

`center init` writes `.contextum/.gitignore`, so configuration is reviewable and runtime
noise is not:

```text
tracked:  README.md, center.yml, project.json, mcp.json, schemas/
ignored:  tasks.json, agents.json, locks.json, execution-state.json, events.jsonl, .lock/
```

`project.json` holds a stable random id and no machine paths, so it survives being committed
and cloned onto another operating system. All runtime code uses Node path APIs and the
server is started with an explicit `--cwd`, which is what keeps Linux, macOS, and Windows on
the same behaviour.

---

## 13. Safe adoption on an existing AI-driven repo

Contextum is designed to be installed on repositories that already have AI instructions,
Claude skills, Cursor rules, or their own `ai-context/`.

Default behaviour is conservative:

- existing files are **skipped**, not overwritten; `--force` is required to replace them
- `AGENTS.md` stays the canonical instruction file when it already exists
- existing `.claude/agents` and `.claude/skills` files are preserved
- an existing `.mcp.json` keeps its other servers; the `contextum` entry is only replaced
  with `--force`
- conflicting facts go to `ai-context/unknowns.md` instead of being guessed

Recommended flow:

```bash
contextum doctor --cwd <repo-path>     # see where you stand first
contextum setup  --cwd <repo-path>
contextum validate --cwd <repo-path>
git diff                               # review before committing
```

Running `setup` on the bundled example, which already ships a full context layer, skips all
35 existing files and adds only the center and the MCP config.

---

## 14. Filling the context from real code

`init` writes honest templates with `TODO`s. `fill` hands an AI coding agent a strict prompt
and lets it turn those templates into accurate, source-verified context:

```bash
contextum fill --agent claude            # drive Claude Code
contextum fill --agent codex             # drive Codex
contextum fill --agent claude --dry-run  # print the prompt, run nothing
```

The fill prompt discovers and reconciles **existing repository docs** (README, `docs/`,
ADRs, OpenAPI), points the agent at the code graph and symbol map for navigation, forbids
fabrication (unknowns stay `UNKNOWN` and go to `unknowns.md`), asks for non-obvious
relationships, and keeps the trust state at `auto_generated` until a human reviews it.

After a successful fill, the code graph and context index are rebuilt automatically.

---

## 15. Try it on the bundled example

`examples/task-api` is a small zero-dependency REST API with the full layer applied:

```bash
cd examples/task-api
node src/server.js               # the app runs
curl -s localhost:3000/tasks     # it works

contextum doctor                 # 100% structure, agent-ready
contextum validate
cat ai-context/context-index.json
```

Talk to the MCP server directly, without any client:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"contextum.search_context","arguments":{"query":"in-memory store tasks","limit":2}}}' \
  | contextum mcp --cwd .
```

---

## 16. How `doctor` scores

Contextum separates **structure** from **trust** — having files is not proof of quality:

- **Structure readiness** — are the required files present?
- **Context quality** — penalizes unfilled `TODO` placeholders. An honest `UNKNOWN`
  (e.g. `Owner: UNKNOWN`) is *not* a defect; only `context.yml` field placeholders are.
- **Agent readiness** — `AGENTS.md`, core wrappers, orientation skill, role prompts.
- **Trust state** — `auto_generated` until a human reviews and promotes it.

---

## 17. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Claude Code shows the server as failed | The launcher in `.mcp.json` is not installed | `npm i -g contextum`, or `contextum mcp install --force --command <path>` |
| `Missing .contextum. Run 'contextum center init' first.` | Center not created in this repo | `contextum center init --cwd <repo-path>` |
| `Timed out waiting for the Contextum center lock` | Another agent is mid-write, or a lock was orphaned | Wait — stale locks clear after 30s; remove `.contextum/.lock` only if no agent is running |
| `Task … is already claimed by …` | Another agent owns the work | Pick another task, or ask the owner to `release_task` |
| `Path is not readable through Contextum MCP` | Path outside the read whitelist | Read it with your normal file tools; MCP only serves `AGENTS.md` and `ai-context/` |
| `.contextum/tasks.json is not valid JSON` | The file was edited or damaged outside Contextum | Restore from Git, or `contextum center init --force` |
| `.mcp.json already defines contextum` | Idempotent guard | Add `--force` if you really want to replace the entry |

---

## Design principles

1. **Be honest.** Mark unknowns; prefer low confidence over hallucinated certainty.
2. **Be lightweight.** Updating context must be cheaper than rediscovering the repo.
3. **Be tool-compatible.** One canonical file, many thin wrappers.
4. **Be repository-first.** Git is the source of truth.
5. **Separate durable memory from operational state.** Reviewed facts in `ai-context/`,
   current work in `.contextum/`.
6. **Make writes narrow and auditable.** Every MCP write is scoped to `.contextum/` and
   records an event.
7. **Treat shared operational memory as untrusted input.** Tasks, handoffs, and execution
   state are written by one agent and read by another — data, never instructions.
8. **Keep the human in the loop.** Everything that matters is a file you can read in a diff.

References: [SKILL.state](https://arxiv.org/abs/2608.26263) ·
[MCP specification](https://modelcontextprotocol.io/specification/2025-06-18) ·
[MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) ·
[Claude Code MCP](https://code.claude.com/docs/en/mcp)

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

Available today: the context layer, the agent pack, the dependency graph and symbol map,
the relationship layer, the vector-DB-ready context index with algebraically-derived
triads, the agent-driven `fill` workflow, the multi-agent center with a
concurrency-safe store, and the MCP server with 19 tools.

Deliberately **not** built yet: the database itself. The context index ships with empty
embedding slots so it can later be loaded into a vector or graph database without changing
the on-disk format. The MCP server targets protocol revision `2025-06-18`; moving to a newer
revision is a transport-level change, not a feature gap.

MIT licensed.

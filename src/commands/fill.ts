import { spawnSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import { CANONICAL_AGENT_FILE, CONTEXT_DIR, DIAGRAMS_DIR } from "../core/constants.js";
import { discoverExistingContext } from "../core/discover.js";
import { log } from "../core/log.js";
import { graph } from "./graph.js";
import { index } from "./indexCmd.js";

export type FillAgent = "claude" | "codex";

export type FillAgentSandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface FillOptions {
  root: string;
  dryRun?: boolean;
  agent?: FillAgent | string;
  agentCommand?: string;
  agentSandbox?: FillAgentSandbox | string;
  bypassAgentSandbox?: boolean;
}

export async function fill(opts: FillOptions): Promise<void> {
  const agent = normalizeAgent(opts.agent);
  const command = resolveAgentCommand(agent, opts.agentCommand);
  const agentSandbox = normalizeAgentSandbox(opts.agentSandbox);
  await assertContextLayer(opts.root);

  log.title("contextum fill");
  log.dim(`  root: ${opts.root}`);
  log.dim(`  agent: ${agent}`);

  const existingContext = await discoverExistingContext(opts.root);
  const hasCodeGraph = opts.dryRun
    ? await fs.pathExists(path.join(opts.root, DIAGRAMS_DIR, "code-graph.json"))
    : (await graph({ root: opts.root, force: true, quiet: true })).length > 0;

  if (existingContext.length) {
    log.dim(`  existing context discovered: ${existingContext.length} file(s)`);
  }
  if (hasCodeGraph) log.dim("  code graph: ai-context/diagrams/code-graph.mmd");

  const prompt = buildFillPrompt(agent, { existingContext, hasCodeGraph });

  if (opts.dryRun) {
    console.log(prompt);
    return;
  }

  assertCommandAvailable(command, agent);
  const result = spawnSync(
    command,
    agentArgs(agent, prompt, {
      agentSandbox,
      bypassAgentSandbox: opts.bypassAgentSandbox ?? false,
    }),
    {
      cwd: opts.root,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }

  await graph({ root: opts.root, force: true, quiet: true });
  await index({ root: opts.root, force: true, quiet: true });

  log.ok(`${agent} fill completed. Rebuilt graph + context index. Run \`contextum doctor\` and review the diff.`);
}

export interface FillPromptOptions {
  existingContext?: string[];
  hasCodeGraph?: boolean;
}

export function buildFillPrompt(
  agent: FillAgent = "claude",
  options: FillPromptOptions = {},
): string {
  const existingContext = options.existingContext ?? [];

  const discoverySection = existingContext.length
    ? [
        "Existing documentation already in this repository (READ and reconcile — do not ignore or duplicate it):",
        ...existingContext.map((file) => `- ${file}`),
        "Treat these as primary evidence: prefer them over guessing, mine them for business intent, architecture, runtime, and decisions, but still verify each claim against code. Record any contradiction between docs and code in `ai-context/unknowns.md`.",
        "",
      ]
    : [
        "No pre-existing documentation was detected outside the Contextum layer. Derive context from source code, config, and tests.",
        "",
      ];

  const graphSection = options.hasCodeGraph
    ? [
        "A code/dependency graph has been generated at `ai-context/diagrams/code-graph.mmd` and `ai-context/diagrams/code-graph.json`, plus a symbol index at `ai-context/diagrams/code-symbols.json`.",
        "Use the graph to trace imports and the symbol index to locate where functions, classes, and types are defined by name — navigate via these instead of scanning the whole repository, and reference them from `ai-context/code-map.md` and `ai-context/architecture-flows.md`.",
        "",
      ]
    : [];

  return [
    `You are running as ${agent} to fill a Contextum AI Context Layer for an existing repository.`,
    "",
    "Goal: turn the generated context files into accurate, repository-specific engineering memory by inspecting the real codebase.",
    "",
    ...discoverySection,
    ...graphSection,
    "Hard rules:",
    "- Do not modify product source code unless it is strictly necessary to keep context references valid.",
    "- Prefer low confidence over invented certainty.",
    "- Do not fabricate business features, integrations, runtime behavior, owners, data stores, or contracts.",
    "- Keep unverified facts as UNKNOWN and record them in `ai-context/unknowns.md`.",
    "- Verify every concrete claim against files in the repository.",
    "- Keep `context_maturity.level` as `auto_generated` and `needs_human_review: true` unless a human explicitly reviewed it.",
    "- Preserve Contextum structure and filenames.",
    "",
    "Required read order:",
    "1. `AGENTS.md`",
    "2. `ai-context/README.md`",
    "3. `ai-context/context.yml`",
    "4. `ai-context/code-map.md`",
    "5. `ai-context/integrations.md`",
    "6. `ai-context/business-features.md`",
    "7. `ai-context/runtime.md`",
    "8. `ai-context/data-model.md`",
    "9. `ai-context/change-impact.md`",
    "10. `ai-context/repository-boundaries.md`",
    "11. `ai-context/decisions.md`",
    "12. `ai-context/unknowns.md`",
    "13. `ai-context/freshness.md`",
    "",
    "Fill or improve these files when evidence exists:",
    "- `ai-context/context.yml`",
    "- `ai-context/README.md`",
    "- `ai-context/code-map.md`",
    "- `ai-context/business-features.md`",
    "- `ai-context/integrations.md`",
    "- `ai-context/runtime.md`",
    "- `ai-context/data-model.md`",
    "- `ai-context/architecture-flows.md`",
    "- `ai-context/change-impact.md`",
    "- `ai-context/repository-boundaries.md`",
    "- `ai-context/decisions.md`",
    "- `ai-context/relationships.md`",
    "- `ai-context/unknowns.md`",
    "- `ai-context/lifecycle.md`",
    "- `ai-context/freshness.md`",
    "- `ai-context/agent-workflows.md`",
    "- Mermaid diagrams in `ai-context/diagrams/`",
    "",
    "Process:",
    "1. Read the existing documentation listed above first, then inspect repository structure, package/runtime files, tests, CI, infra, API entrypoints, data access, and integration boundaries. Use the code graph to navigate instead of scanning everything.",
    "2. Replace TODO/UNKNOWN only when the fact is verified from source code or config.",
    "3. Add compact file/path evidence for important claims.",
    "4. Keep documents concise and useful for future agents.",
    "5. Populate `ai-context/relationships.md` with non-obvious, cross-cutting relationships (shared invariants, implicit contracts, hidden coupling, cross-domain analogies). Do not duplicate structural import edges already in the code graph; capture only links that require understanding to see, each with evidence, confidence, and whether it is non-obvious.",
    "6. Update `ai-context/freshness.md` changelog with this fill operation.",
    "7. End with a short summary of files changed and remaining unknowns.",
    "",
    "After editing, run `contextum validate` if the command is available. Do not hide validation failures.",
  ].join("\n") + "\n";
}

function normalizeAgent(agent: FillOptions["agent"]): FillAgent {
  if (agent === undefined) return "claude";
  if (agent === "claude" || agent === "codex") return agent;
  throw new Error(`Unsupported fill agent: ${agent}. Use claude or codex.`);
}

function normalizeAgentSandbox(sandbox: FillOptions["agentSandbox"]): FillAgentSandbox {
  if (sandbox === undefined) return "workspace-write";
  if (
    sandbox === "read-only" ||
    sandbox === "workspace-write" ||
    sandbox === "danger-full-access"
  ) {
    return sandbox;
  }
  throw new Error(
    `Unsupported agent sandbox: ${sandbox}. Use read-only, workspace-write, or danger-full-access.`,
  );
}

function resolveAgentCommand(agent: FillAgent, override?: string): string {
  if (override) return override;
  if (agent === "codex") return process.env.CONTEXTUM_CODEX_COMMAND ?? "codex";
  return process.env.CONTEXTUM_CLAUDE_COMMAND ?? "claude";
}

interface AgentArgOptions {
  agentSandbox: FillAgentSandbox;
  bypassAgentSandbox: boolean;
}

function agentArgs(
  agent: FillAgent,
  prompt: string,
  opts: AgentArgOptions,
): string[] {
  if (agent === "codex") {
    if (opts.bypassAgentSandbox) {
      return ["exec", "--dangerously-bypass-approvals-and-sandbox", prompt];
    }
    return ["exec", "--sandbox", opts.agentSandbox, prompt];
  }

  if (opts.bypassAgentSandbox) {
    return ["--dangerously-skip-permissions", "-p", prompt];
  }
  return ["--permission-mode", claudePermissionMode(opts.agentSandbox), "-p", prompt];
}

function claudePermissionMode(sandbox: FillAgentSandbox): string {
  if (sandbox === "read-only") return "plan";
  if (sandbox === "danger-full-access") return "bypassPermissions";
  return "acceptEdits";
}

async function assertContextLayer(root: string): Promise<void> {
  const required = [CANONICAL_AGENT_FILE, CONTEXT_DIR, path.join(CONTEXT_DIR, "context.yml")];
  for (const rel of required) {
    if (!(await fs.pathExists(path.join(root, rel)))) {
      throw new Error(`Missing ${rel}. Run \`contextum init\` first.`);
    }
  }
}

function assertCommandAvailable(command: string, agent: FillAgent): void {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error) {
    throw new Error(
      `${agent} command not found: ${command}. Install the CLI or pass --agent-command <cmd>.`,
    );
  }
}

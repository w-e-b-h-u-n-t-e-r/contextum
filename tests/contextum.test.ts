import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "fs-extra";
import { init } from "../src/commands/init.js";
import { generate } from "../src/commands/generate.js";
import { agents } from "../src/commands/agents.js";
import { skills } from "../src/commands/skills.js";
import { buildFillPrompt } from "../src/commands/fill.js";
import { centerInit } from "../src/commands/center.js";
import {
  acquireLock,
  claimTask,
  createTask,
  listEvents,
  patchExecutionState,
  recordHandoff,
  registerAgent,
  updateTask,
} from "../src/core/centerStore.js";
import { installMcp, resolveServerLauncher } from "../src/commands/mcpInstall.js";
import { setup } from "../src/commands/setup.js";
import { handleMcpMessage, handleWireMessage, listMcpTools } from "../src/mcp/server.js";
import { validate } from "../src/commands/validate.js";
import { computeScore } from "../src/core/score.js";
import { detectRepo } from "../src/core/detect.js";
import { discoverExistingContext } from "../src/core/discover.js";
import { buildSymbolMap } from "../src/core/symbols.js";
import { buildContextIndex, parseRelationships, toNdjson } from "../src/core/contextIndex.js";
import {
  CANONICAL_AGENT_FILE,
  CONTEXT_DIR,
  CONTEXT_MARKDOWN_FILES,
  CONTEXTUM_VERSION,
} from "../src/core/constants.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "contextum-test-"));
});

afterEach(async () => {
  await fs.remove(root);
});

async function seedTsRepo() {
  await fs.writeJson(path.join(root, "package.json"), {
    name: "fixture-repo",
    dependencies: {},
  });
  await fs.writeFile(path.join(root, "tsconfig.json"), "{}");
  await fs.ensureDir(path.join(root, "src/commands"));
  await fs.ensureDir(path.join(root, "src/api"));
  await fs.writeFile(
    path.join(root, "src/index.ts"),
    `import { run } from "./commands/run.js";\nrun();\n`,
  );
  await fs.writeFile(path.join(root, "src/commands/run.ts"), `export function run() {}\n`);
}

interface McpResponseLike {
  result?: unknown;
  error?: { code: number; message: string };
}

function toolPayload(response: McpResponseLike | null | undefined) {
  return response?.result as {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  };
}

function toolErrorText(response: McpResponseLike | null | undefined): string {
  const payload = toolPayload(response);
  expect(payload?.isError).toBe(true);
  return payload?.content?.[0]?.text ?? "";
}

function toolData<T = Record<string, unknown>>(response: McpResponseLike | null | undefined): T {
  const payload = toolPayload(response);
  expect(payload?.isError).toBe(false);
  return payload?.structuredContent as T;
}

const repoFile = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));

describe("package metadata", () => {
  it("keeps the advertised version in sync with package.json", async () => {
    // The constant is what `--version` prints and what the npx fallback in
    // .mcp.json pins, so drift here ships a config nobody can install.
    const pkg = await fs.readJson(repoFile("package.json"));
    expect(CONTEXTUM_VERSION).toBe(pkg.version);
  });

  it("ships a license file for the declared license", async () => {
    const pkg = await fs.readJson(repoFile("package.json"));
    expect(pkg.license).toBe("MIT");
    expect(await fs.pathExists(repoFile("LICENSE"))).toBe(true);
  });
});

describe("detectRepo", () => {
  it("detects a TypeScript node repo with capabilities", async () => {
    await seedTsRepo();
    const profile = await detectRepo(root);
    expect(profile.name).toBe("fixture-repo");
    expect(profile.primaryLanguage).toBe("TypeScript");
    expect(profile.type).toBe("node");
    expect(profile.capabilities).toContain("application code");
    expect(profile.capabilities).toContain("api");
    expect(profile.topLevelDirs).toContain("src");
  });

  it("falls back to UNKNOWN for an empty repo", async () => {
    const profile = await detectRepo(root);
    expect(profile.primaryLanguage).toBe("UNKNOWN");
    expect(profile.type).toBe("UNKNOWN");
  });
});

describe("generate", () => {
  it("creates all required context files", async () => {
    await seedTsRepo();
    await generate({ root, quiet: true });

    for (const f of CONTEXT_MARKDOWN_FILES) {
      expect(await fs.pathExists(path.join(root, CONTEXT_DIR, f))).toBe(true);
    }
    expect(await fs.pathExists(path.join(root, CONTEXT_DIR, "context.yml"))).toBe(true);
  });

  it("is idempotent: re-running skips existing files", async () => {
    await seedTsRepo();
    await generate({ root, quiet: true });
    const second = await generate({ root, quiet: true });
    expect(second.every((r) => r.status === "skipped")).toBe(true);
  });

  it("overwrites with force", async () => {
    await seedTsRepo();
    await generate({ root, quiet: true });
    const forced = await generate({ root, quiet: true, force: true });
    expect(forced.every((r) => r.status === "updated")).toBe(true);
  });
});

describe("agents", () => {
  it("writes canonical AGENTS.md and core wrappers", async () => {
    await seedTsRepo();
    await agents({ root, coreOnly: true, quiet: true });
    expect(await fs.pathExists(path.join(root, CANONICAL_AGENT_FILE))).toBe(true);
    expect(await fs.pathExists(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(await fs.pathExists(path.join(root, ".cursor/rules/contextum.mdc"))).toBe(true);

    const claude = await fs.readFile(path.join(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain("AGENTS.md");
  });
});

describe("init", () => {
  it("can include the agent pack", async () => {
    await seedTsRepo();
    await init({ root, agentPack: true });

    expect(
      await fs.pathExists(
        path.join(root, ".claude/skills/context-orientation/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(root, ".claude/agents/context-maintainer.md")),
    ).toBe(true);

    const score = await computeScore(root);
    expect(score.agentReadiness).toBe(100);
  });

  it("preserves an existing AI-driven repository unless force is used", async () => {
    await seedTsRepo();
    await fs.ensureDir(path.join(root, CONTEXT_DIR));
    await fs.ensureDir(path.join(root, ".claude/agents"));
    await fs.writeFile(path.join(root, CANONICAL_AGENT_FILE), "# Existing team agent rules\n");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "# Existing Claude entrypoint\n");
    await fs.writeFile(path.join(root, CONTEXT_DIR, "context.yml"), "repo: existing-ai-repo\n");
    await fs.writeFile(path.join(root, ".claude/agents/reviewer.md"), "# Existing reviewer\n");

    await init({ root, agentPack: true });

    await expect(fs.readFile(path.join(root, CANONICAL_AGENT_FILE), "utf8")).resolves.toBe(
      "# Existing team agent rules\n",
    );
    await expect(fs.readFile(path.join(root, "CLAUDE.md"), "utf8")).resolves.toBe(
      "# Existing Claude entrypoint\n",
    );
    await expect(fs.readFile(path.join(root, CONTEXT_DIR, "context.yml"), "utf8")).resolves.toBe(
      "repo: existing-ai-repo\n",
    );
    await expect(fs.readFile(path.join(root, ".claude/agents/reviewer.md"), "utf8")).resolves.toBe(
      "# Existing reviewer\n",
    );
  });
});

describe("skills", () => {
  it("writes orientation skill and role prompts", async () => {
    await seedTsRepo();
    await skills({ root, quiet: true });

    expect(
      await fs.pathExists(
        path.join(root, ".claude/skills/context-orientation/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(root, ".claude/agents/reviewer.md")),
    ).toBe(true);

    const skill = await fs.readFile(
      path.join(root, ".claude/skills/context-orientation/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("AGENTS.md");
    expect(skill).toContain("ai-context/context.yml");
  });
});

describe("center", () => {
  it("creates a local multi-agent coordination center", async () => {
    await seedTsRepo();
    const results = await centerInit({ root, quiet: true });

    expect(results.map((r) => r.rel)).toEqual([
      ".contextum/README.md",
      ".contextum/.gitignore",
      ".contextum/center.yml",
      ".contextum/project.json",
      ".contextum/mcp.json",
      ".contextum/tasks.json",
      ".contextum/agents.json",
      ".contextum/locks.json",
      ".contextum/execution-state.json",
      ".contextum/events.jsonl",
      ".contextum/schemas/task.schema.json",
      ".contextum/schemas/agent.schema.json",
      ".contextum/schemas/lock.schema.json",
      ".contextum/schemas/event.schema.json",
      ".contextum/schemas/execution-state.schema.json",
    ]);

    const project = await fs.readJson(path.join(root, ".contextum/project.json"));
    expect(project).toMatchObject({ schema: "contextum-project/v1", storage: "repo-local-json" });
    // Committed metadata must not carry machine-specific paths.
    expect(JSON.stringify(project)).not.toContain(root);
    expect(project.id).toMatch(/^project_/);

    const tasks = await fs.readJson(path.join(root, ".contextum/tasks.json"));
    expect(tasks).toMatchObject({ schema: "contextum-tasks/v1", tasks: [] });

    const center = await fs.readFile(path.join(root, ".contextum/center.yml"), "utf8");
    expect(center).toContain("schema: contextum-center/v1");
    expect(center).toContain("ai-context/");

    const taskSchema = await fs.readJson(
      path.join(root, ".contextum/schemas/task.schema.json"),
    );
    expect(taskSchema.required).toContain("status");

    const executionState = await fs.readJson(path.join(root, ".contextum/execution-state.json"));
    expect(executionState).toMatchObject({ schema: "contextum-execution-state/v1", states: [] });
  });
});


describe("mcp install", () => {
  it("writes a launcher that exists on this machine", async () => {
    await seedTsRepo();

    const status = await installMcp({ root, quiet: true });
    const config = await fs.readJson(path.join(root, ".mcp.json"));
    const server = config.mcpServers.contextum;

    expect(status).toBe("created");
    expect(server.type).toBe("stdio");
    expect(server.args.slice(-3)).toEqual(["mcp", "--cwd", "${CLAUDE_PROJECT_DIR:-.}"]);

    const launcher = await resolveServerLauncher(root);
    expect(server.command).toBe(launcher.command);
    // A bare `contextum` is only written when it is actually resolvable.
    if (server.command === "contextum") expect(launcher.source).toBe("path");
    else expect(server.command).toBe("npx");
  });

  it("honours an explicit launcher override", async () => {
    await seedTsRepo();
    await installMcp({ root, quiet: true, command: "/opt/contextum/cli.js" });
    const config = await fs.readJson(path.join(root, ".mcp.json"));
    expect(config.mcpServers.contextum.command).toBe("/opt/contextum/cli.js");
  });

  it("preserves an existing contextum MCP server unless force is used", async () => {
    await seedTsRepo();
    await fs.writeJson(path.join(root, ".mcp.json"), {
      mcpServers: {
        contextum: { command: "custom-contextum" },
        other: { command: "other-server" },
      },
    });

    const skipped = await installMcp({ root, quiet: true });
    let config = await fs.readJson(path.join(root, ".mcp.json"));
    expect(skipped).toBe("skipped");
    expect(config.mcpServers.contextum.command).toBe("custom-contextum");
    expect(config.mcpServers.other.command).toBe("other-server");

    const updated = await installMcp({ root, force: true, quiet: true, command: "contextum" });
    config = await fs.readJson(path.join(root, ".mcp.json"));
    expect(updated).toBe("updated");
    expect(config.mcpServers.contextum.command).toBe("contextum");
    expect(config.mcpServers.other.command).toBe("other-server");
  });
});

describe("setup", () => {
  it("runs non-interactive setup without overwriting existing AI context by default", async () => {
    await seedTsRepo();
    await fs.writeFile(path.join(root, CANONICAL_AGENT_FILE), "# Existing rules\n");

    await setup({ root, yes: true });

    await expect(fs.readFile(path.join(root, CANONICAL_AGENT_FILE), "utf8")).resolves.toBe(
      "# Existing rules\n",
    );
    expect(await fs.pathExists(path.join(root, CONTEXT_DIR, "context.yml"))).toBe(true);
    expect(await fs.pathExists(path.join(root, ".contextum/project.json"))).toBe(true);
    expect(await fs.pathExists(path.join(root, ".mcp.json"))).toBe(true);
  });
});

describe("mcp", () => {
  it("exposes context and center tools", async () => {
    await seedTsRepo();
    await init({ root });
    await centerInit({ root, quiet: true });

    expect(listMcpTools().map((tool) => tool.name)).toContain("contextum.read_context");
    expect(listMcpTools().map((tool) => tool.name)).toContain("contextum.search_context");
    expect(listMcpTools().map((tool) => tool.name)).toContain("contextum.shared_memory_status");
    expect(listMcpTools().map((tool) => tool.name)).toContain("contextum.list_tasks");
    expect(listMcpTools().map((tool) => tool.name)).toContain("contextum.read_execution_state");

    const initialized = await handleMcpMessage({ id: 1, method: "initialize" }, root);
    expect(initialized?.result).toMatchObject({ serverInfo: { name: "contextum" } });

    const status = await handleMcpMessage({
      id: 2,
      method: "tools/call",
      params: { name: "contextum.repo_status", arguments: {} },
    }, root);
    expect(JSON.stringify(status?.result)).toContain("has_context_dir");
    expect(JSON.stringify(status?.result)).toContain("has_center");

    const readme = await handleMcpMessage({
      id: 3,
      method: "tools/call",
      params: { name: "contextum.read_context", arguments: { path: "ai-context/README.md" } },
    }, root);
    expect(JSON.stringify(readme?.result)).toContain("Repository Context");
  });

  it("searches shared context without reading arbitrary files", async () => {
    await seedTsRepo();
    await init({ root });
    await centerInit({ root, quiet: true });

    const response = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: {
        name: "contextum.search_context",
        arguments: { query: "repository context", limit: 3 },
      },
    }, root);

    expect(JSON.stringify(response?.result)).toContain("matches");
    expect(JSON.stringify(response?.result)).toContain("ai-context/README.md");
  });

  it("reports project-scoped shared memory status", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const response = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: { name: "contextum.shared_memory_status", arguments: {} },
    }, root);

    expect(JSON.stringify(response?.result)).toContain("contextum-project/v1");
    expect(JSON.stringify(response?.result)).toContain("MCP-capable Codex reviewer");
  });

  it("refuses to read files outside the context whitelist", async () => {
    await seedTsRepo();
    await init({ root });

    const response = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: { name: "contextum.read_context", arguments: { path: "package.json" } },
    }, root);

    const result = response?.result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("not readable");
  });

  it("supports task claims with ownership conflict checks", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const created = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: { name: "contextum.create_task", arguments: { title: "Map checkout flow" } },
    }, root);
    const createdResult = created?.result as { structuredContent?: { id?: string } } | undefined;
    const task = createdResult?.structuredContent;
    expect(task?.id).toBeDefined();

    const claimed = await handleMcpMessage({
      id: 2,
      method: "tools/call",
      params: { name: "contextum.claim_task", arguments: { task_id: task!.id, agent_id: "agent-a" } },
    }, root);
    expect(JSON.stringify(claimed?.result)).toContain("agent-a");

    const conflict = await handleMcpMessage({
      id: 3,
      method: "tools/call",
      params: { name: "contextum.claim_task", arguments: { task_id: task!.id, agent_id: "agent-b" } },
    }, root);
    expect(toolErrorText(conflict)).toContain("already claimed");
  });

  it("supports cooperative locks with conflict checks", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const first = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: {
        name: "contextum.acquire_lock",
        arguments: { scope: "src/payments", owner_agent_id: "agent-a" },
      },
    }, root);
    expect(JSON.stringify(first?.result)).toContain("src/payments");

    const conflict = await handleMcpMessage({
      id: 2,
      method: "tools/call",
      params: {
        name: "contextum.acquire_lock",
        arguments: { scope: "src/payments", owner_agent_id: "agent-b" },
      },
    }, root);
    expect(toolErrorText(conflict)).toContain("already held");
  });

  it("patches compact execution state", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const response = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: {
        name: "contextum.patch_execution_state",
        arguments: {
          id: "run-1",
          patch: {
            current_goal: "Implement MCP writes",
            facts: ["center exists"],
            next_actions: ["run tests"],
          },
        },
      },
    }, root);

    expect(JSON.stringify(response?.result)).toContain("Implement MCP writes");
    const state = await fs.readJson(path.join(root, ".contextum/execution-state.json"));
    expect(state.states[0]).toMatchObject({ id: "run-1", facts: ["center exists"] });
  });
});

describe("fill", () => {
  it("builds agent-specific fill prompts", () => {
    const claudePrompt = buildFillPrompt("claude");
    const codexPrompt = buildFillPrompt("codex");

    expect(claudePrompt).toContain("running as claude");
    expect(codexPrompt).toContain("running as codex");
    expect(codexPrompt).toContain("ai-context/context.yml");
    expect(codexPrompt).toContain("Do not fabricate business features");
  });
});

describe("validate", () => {
  it("fails on a repo with no context layer", async () => {
    const report = await validate({ root });
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("passes after init", async () => {
    await seedTsRepo();
    await init({ root });
    const report = await validate({ root });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("detects invalid context.yml", async () => {
    await seedTsRepo();
    await init({ root });
    await fs.writeFile(path.join(root, CONTEXT_DIR, "context.yml"), ":\n::not yaml::\n  - [");
    const report = await validate({ root });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes("context.yml"))).toBe(true);
  });
});

describe("buildSymbolMap", () => {
  it("extracts exported symbols by name and kind", async () => {
    await seedTsRepo();
    await fs.writeFile(
      path.join(root, "src/domain.ts"),
      [
        "export function reserve() {}",
        "export class Vault {}",
        "export interface Offer {}",
        "export type Money = number;",
        "export const FLOOR = 1;",
      ].join("\n"),
    );

    const map = await buildSymbolMap(root);
    expect(map).not.toBeNull();
    const domain = map!.files.find((f) => f.file === "src/domain.ts");
    expect(domain).toBeDefined();
    const byName = Object.fromEntries(domain!.symbols.map((s) => [s.name, s.kind]));
    expect(byName).toMatchObject({
      reserve: "function",
      Vault: "class",
      Offer: "interface",
      Money: "type",
      FLOOR: "constant",
    });
  });
});

describe("relationships layer", () => {
  it("init creates relationships.md", async () => {
    await seedTsRepo();
    await init({ root });
    expect(await fs.pathExists(path.join(root, "ai-context/relationships.md"))).toBe(true);
  });
});

describe("context index", () => {
  const REL_DOC = [
    "# Relationships",
    "",
    "## Relationships",
    "",
    "### reservation-lock ⇄ money-precision",
    "- Type: shared-invariant",
    "- Why it matters: both protect no-double-sale",
    "- Evidence: src/vault.ts, src/pricing.ts",
    "- Non-obvious: yes",
    "",
    "### money-precision ⇄ floor-guard",
    "- Type: cause-effect",
    "- Why it matters: truncation breaks the floor",
    "- Non-obvious: no",
    "",
  ].join("\n");

  it("parses relationships and ignores the template/code fences", () => {
    const parsed = parseRelationships(
      "```\n### <A> ⇄ <B>\n- Type: x\n```\n" + REL_DOC,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      a: "reservation-lock",
      b: "money-precision",
      type: "shared-invariant",
      nonObvious: true,
    });
  });

  it("builds a vector-DB-ready index with derived triads and empty embedding slots", async () => {
    await seedTsRepo();
    await init({ root });
    await fs.writeFile(path.join(root, "ai-context/relationships.md"), REL_DOC);

    const idx = await buildContextIndex(root);
    expect(idx).not.toBeNull();
    expect(idx!.schema).toBe("contextum-context-index/v1");
    expect(idx!.embedding.status).toBe("pending");

    const rels = idx!.documents.filter((d) => d.kind === "relationship");
    const triads = idx!.documents.filter((d) => d.kind === "triad");
    expect(rels).toHaveLength(2);
    expect(triads).toHaveLength(1);
    expect(triads[0]!.level).toBe(1);
    expect(triads[0]!.derived).toBe(true);
    expect(idx!.documents.every((d) => d.embedding === null)).toBe(true);
  });

  it("emits one parseable JSON document per line as ndjson", async () => {
    await seedTsRepo();
    await init({ root });
    await fs.writeFile(path.join(root, "ai-context/relationships.md"), REL_DOC);

    const idx = await buildContextIndex(root);
    const lines = toNdjson(idx!).trim().split("\n");
    expect(lines).toHaveLength(idx!.documents.length);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("discoverExistingContext", () => {
  it("finds pre-existing docs and ignores the Contextum layer", async () => {
    await seedTsRepo();
    await fs.writeFile(path.join(root, "ARCHITECTURE.md"), "# Architecture\n");
    await fs.ensureDir(path.join(root, "docs"));
    await fs.writeFile(path.join(root, "docs/setup.md"), "# Setup\n");

    await init({ root });
    const found = await discoverExistingContext(root);

    expect(found).toContain("ARCHITECTURE.md");
    expect(found).toContain("docs/setup.md");
    expect(found.some((f) => f.startsWith("ai-context/"))).toBe(false);
    expect(found).not.toContain("AGENTS.md");
    expect(found.some((f) => f.startsWith(".claude/"))).toBe(false);
  });
});

describe("buildFillPrompt", () => {
  it("embeds discovered context and the code-graph pointer", () => {
    const prompt = buildFillPrompt("codex", {
      existingContext: ["ARCHITECTURE.md", "docs/setup.md"],
      hasCodeGraph: true,
    });
    expect(prompt).toContain("ARCHITECTURE.md");
    expect(prompt).toContain("docs/setup.md");
    expect(prompt).toContain("code-graph.mmd");
  });

  it("notes the absence of pre-existing docs", () => {
    const prompt = buildFillPrompt("claude", { existingContext: [], hasCodeGraph: false });
    expect(prompt).toContain("No pre-existing documentation");
  });
});

describe("mcp protocol", () => {
  it("never answers a notification", async () => {
    await seedTsRepo();
    await init({ root });

    expect(await handleMcpMessage({ method: "notifications/initialized" }, root)).toBeNull();
    expect(await handleMcpMessage({ method: "notifications/cancelled" }, root)).toBeNull();
    expect(await handleMcpMessage({ id: null, method: "notifications/progress" }, root)).toBeNull();
  });

  it("echoes a protocol version it supports and falls back otherwise", async () => {
    const older = await handleMcpMessage({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    }, root);
    expect(older?.result).toMatchObject({ protocolVersion: "2024-11-05" });

    const unknown = await handleMcpMessage({
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }, root);
    expect(unknown?.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("separates protocol errors from tool execution errors", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const unknownTool = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: { name: "contextum.nope", arguments: {} },
    }, root);
    expect(unknownTool?.error?.code).toBe(-32602);

    const businessError = await handleMcpMessage({
      id: 2,
      method: "tools/call",
      params: { name: "contextum.claim_task", arguments: { task_id: "missing", agent_id: "a" } },
    }, root);
    expect(businessError?.error).toBeUndefined();
    expect(toolErrorText(businessError)).toContain("Task not found");
  });

  it("answers a batch with a single JSON-RPC array", async () => {
    const payload = await handleWireMessage(
      JSON.stringify([
        { jsonrpc: "2.0", id: "b1", method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: "b2", method: "tools/list" },
      ]),
      root,
    );
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as unknown[]).length).toBe(2);
  });

  it("annotates read tools as read-only and write tools as mutating", () => {
    const tools = listMcpTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    expect(byName["contextum.read_context"]?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName["contextum.update_task"]?.annotations).toMatchObject({ readOnlyHint: false });
    expect(tools.every((t) => typeof t.title === "string" && t.title.length > 0)).toBe(true);
    expect(tools.map((t) => t.name)).toContain("contextum.list_events");
    expect(tools.map((t) => t.name)).toContain("contextum.update_task");
  });

  it("exposes handoffs and task lifecycle through tools", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const created = await handleMcpMessage({
      id: 1,
      method: "tools/call",
      params: { name: "contextum.create_task", arguments: { title: "Review me" } },
    }, root);
    const taskId = toolData<{ id: string }>(created).id;

    const reviewed = await handleMcpMessage({
      id: 2,
      method: "tools/call",
      params: { name: "contextum.update_task", arguments: { task_id: taskId, status: "review" } },
    }, root);
    expect(toolData<{ status: string }>(reviewed).status).toBe("review");

    await handleMcpMessage({
      id: 3,
      method: "tools/call",
      params: {
        name: "contextum.record_handoff",
        arguments: { message: "ready for Codex", task_id: taskId, to_agent_id: "codex" },
      },
    }, root);

    const events = await handleMcpMessage({
      id: 4,
      method: "tools/call",
      params: { name: "contextum.list_events", arguments: { type: "handoff.recorded" } },
    }, root);
    const payload = toolData<{ events: Array<{ message: string }> }>(events);
    expect(payload.events[0]?.message).toBe("ready for Codex");
  });
});

describe("center store concurrency", () => {
  it("persists every write when agents mutate the store in parallel", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const created = await Promise.all(
      Array.from({ length: 25 }, (_, i) => createTask(root, { title: `parallel ${i}` })),
    );

    const stored = await fs.readJson(path.join(root, ".contextum/tasks.json"));
    expect(stored.tasks).toHaveLength(created.length);
    expect(new Set(stored.tasks.map((t: { id: string }) => t.id)).size).toBe(created.length);
  });

  it("lets exactly one agent claim a task under contention", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    const task = await createTask(root, { title: "contended" });

    const attempts = await Promise.allSettled([
      claimTask(root, { task_id: task.id, agent_id: "claude-primary" }),
      claimTask(root, { task_id: task.id, agent_id: "claude-secondary" }),
    ]);

    const winners = attempts.filter((a) => a.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const stored = await fs.readJson(path.join(root, ".contextum/tasks.json"));
    expect(stored.tasks[0].owner_agent_id).toBe(
      (winners[0] as PromiseFulfilledResult<{ owner_agent_id: string }>).value.owner_agent_id,
    );
  });

  it("lets exactly one agent hold a lock scope under contention", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    const attempts = await Promise.allSettled([
      acquireLock(root, { scope: "src/payments", owner_agent_id: "claude-primary" }),
      acquireLock(root, { scope: "src/payments", owner_agent_id: "claude-secondary" }),
    ]);

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const stored = await fs.readJson(path.join(root, ".contextum/locks.json"));
    expect(stored.locks).toHaveLength(1);
  });

  it("keeps the store readable when a write is interleaved with reads", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    const writes = Array.from({ length: 15 }, (_, i) => createTask(root, { title: `w${i}` }));
    const reads = Array.from({ length: 15 }, () =>
      fs.readFile(path.join(root, ".contextum/tasks.json"), "utf8").then((raw) => JSON.parse(raw)));
    await Promise.all([...writes, ...reads]);
  });
});

describe("center store semantics", () => {
  it("merges agent registrations instead of resetting the session", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    await registerAgent(root, {
      id: "claude-a",
      tool: "claude",
      profile: "primary",
      role: "implementer",
      worktree: "rokky",
      current_task_id: "task-7",
    });
    const heartbeat = await registerAgent(root, { id: "claude-a" });

    expect(heartbeat).toMatchObject({
      tool: "claude",
      profile: "primary",
      role: "implementer",
      worktree: "rokky",
      current_task_id: "task-7",
    });
    expect(heartbeat.last_seen_at >= heartbeat.started_at).toBe(true);
  });

  it("moves a task through the review lifecycle", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    const task = await createTask(root, { title: "Add rate limiting" });
    await claimTask(root, { task_id: task.id, agent_id: "claude-a" });

    const inReview = await updateTask(root, { task_id: task.id, agent_id: "claude-a", status: "review" });
    expect(inReview.status).toBe("review");

    const done = await updateTask(root, { task_id: task.id, agent_id: "claude-a", status: "done" });
    expect(done.status).toBe("done");
    expect(done.owner_agent_id).toBeNull();

    await expect(claimTask(root, { task_id: task.id, agent_id: "claude-b" })).rejects.toThrow(/Cannot claim done/);
  });

  it("rejects a status change from an agent that does not own the task", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    const task = await createTask(root, { title: "Owned work" });
    await claimTask(root, { task_id: task.id, agent_id: "claude-a" });

    await expect(updateTask(root, { task_id: task.id, agent_id: "codex", status: "done" }))
      .rejects.toThrow(/owned by claude-a/);
  });

  it("appends to execution-state lists without dropping earlier entries", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });

    await patchExecutionState(root, {
      id: "run-1",
      patch: { facts: ["repo is node/JS"], current_goal: "add rate limiting" },
    });
    const merged = await patchExecutionState(root, {
      id: "run-1",
      patch: { facts_add: ["router has 4 routes", "repo is node/JS"] },
    });

    expect(merged.facts).toEqual(["repo is node/JS", "router has 4 routes"]);
    expect(merged.current_goal).toBe("add rate limiting");

    const replaced = await patchExecutionState(root, { id: "run-1", patch: { facts: ["only this"] } });
    expect(replaced.facts).toEqual(["only this"]);
  });

  it("reads handoffs back for the receiving agent", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    const task = await createTask(root, { title: "Ship review" });
    await recordHandoff(root, {
      message: "Diff ready for Codex review",
      task_id: task.id,
      from_agent_id: "claude-a",
      to_agent_id: "codex-reviewer",
    });

    const handoffs = await listEvents(root, { type: "handoff.recorded" });
    expect(handoffs.events).toHaveLength(1);
    expect(handoffs.events[0]?.message).toBe("Diff ready for Codex review");
    expect(handoffs.events[0]?.data).toMatchObject({ to_agent_id: "codex-reviewer" });

    const forTask = await listEvents(root, { task_id: task.id });
    expect(forTask.events.map((e) => e.type)).toContain("task.created");
  });

  it("reports a corrupted store with a recovery hint instead of a raw parse error", async () => {
    await seedTsRepo();
    await centerInit({ root, quiet: true });
    await fs.writeFile(path.join(root, ".contextum/tasks.json"), "{ broken");

    await expect(createTask(root, { title: "x" })).rejects.toThrow(/contextum center init --force/);
  });
});

describe("computeScore", () => {
  it("reports 0% with no layer and high readiness after init", async () => {
    await seedTsRepo();
    const before = await computeScore(root);
    expect(before.readiness).toBe(0);

    await init({ root });
    const after = await computeScore(root);
    expect(after.structureReadiness).toBe(100);
    expect(after.contextQuality).toBeLessThan(100);
    expect(after.agentReadiness).toBeLessThan(100);
    expect(after.trustState).toBe("auto_generated");
    expect(after.weak.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { init } from "../src/commands/init.js";
import { generate } from "../src/commands/generate.js";
import { agents } from "../src/commands/agents.js";
import { skills } from "../src/commands/skills.js";
import { buildFillPrompt } from "../src/commands/fill.js";
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

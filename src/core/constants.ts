export const CONTEXT_DIR = "ai-context";
export const DIAGRAMS_DIR = `${CONTEXT_DIR}/diagrams`;
export const CANONICAL_AGENT_FILE = "AGENTS.md";
export const CONTEXT_YAML_FILE = "context.yml";

export const CONTEXTUM_VERSION = "0.1.0";
export const CONTEXT_SCHEMA_VERSION = "1.0";

export const CONTEXT_MARKDOWN_FILES = [
  "README.md",
  "code-map.md",
  "business-features.md",
  "integrations.md",
  "runtime.md",
  "data-model.md",
  "architecture-flows.md",
  "change-impact.md",
  "repository-boundaries.md",
  "decisions.md",
  "relationships.md",
  "unknowns.md",
  "lifecycle.md",
  "freshness.md",
  "agent-workflows.md",
] as const;

export const DIAGRAM_FILES = [
  "runtime-flow.mmd",
  "dependency-graph.mmd",
  "blast-radius.mmd",
] as const;

export interface WrapperSpec {
  path: string;
  tool: string;
  core: boolean;
}

export interface SkillSpec {
  path: string;
  name: string;
}

export interface RoleSpec {
  path: string;
  name: string;
}

export const WRAPPERS = [
  { path: "CLAUDE.md", tool: "Claude Code", core: true },
  { path: "CODEX.md", tool: "Codex", core: true },
  { path: "GEMINI.md", tool: "Gemini", core: true },
  { path: ".cursor/rules/contextum.mdc", tool: "Cursor", core: true },
  { path: ".github/copilot-instructions.md", tool: "GitHub Copilot", core: true },
  { path: ".aiassistant/rules.md", tool: "JetBrains AI Assistant", core: true },
  { path: ".continue/context.md", tool: "Continue", core: false },
  { path: ".cline/instructions.md", tool: "Cline", core: false },
  { path: ".roo/rules.md", tool: "Roo", core: false },
  { path: ".windsurf/rules.md", tool: "Windsurf", core: false },
  { path: ".mcp/context.md", tool: "MCP agents", core: false },
] as const satisfies ReadonlyArray<WrapperSpec>;

export const SKILLS = [
  { path: ".claude/skills/context-orientation/SKILL.md", name: "context-orientation" },
] as const satisfies ReadonlyArray<SkillSpec>;

export const ROLES = [
  { path: ".claude/agents/context-auditor.md", name: "context-auditor" },
  { path: ".claude/agents/implementation-agent.md", name: "implementation-agent" },
  { path: ".claude/agents/reviewer.md", name: "reviewer" },
  { path: ".claude/agents/context-maintainer.md", name: "context-maintainer" },
] as const satisfies ReadonlyArray<RoleSpec>;

export function diagramPaths(): string[] {
  return DIAGRAM_FILES.map((file) => `${DIAGRAMS_DIR}/${file}`);
}

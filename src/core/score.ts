import path from "node:path";
import fs from "fs-extra";
import YAML from "yaml";
import {
  CANONICAL_AGENT_FILE,
  CONTEXT_DIR,
  CONTEXT_MARKDOWN_FILES,
  CONTEXT_YAML_FILE,
  ROLES,
  SKILLS,
  WRAPPERS,
} from "./constants.js";
import { exists } from "./files.js";
import type { RepoProfile } from "./detect.js";

export interface Scorecard {
  readiness: number;
  structureReadiness: number;
  contextQuality: number;
  agentReadiness: number;
  trustState: string;
  present: string[];
  missing: string[];
  weak: string[];
  missingAgentFiles: string[];
  recommendedActions: string[];
}

const CORE_FILES = [
  `${CONTEXT_DIR}/${CONTEXT_YAML_FILE}`,
  `${CONTEXT_DIR}/README.md`,
  `${CONTEXT_DIR}/code-map.md`,
  `${CONTEXT_DIR}/integrations.md`,
  `${CONTEXT_DIR}/business-features.md`,
  CANONICAL_AGENT_FILE,
];

const CONTEXT_FILES = [
  `${CONTEXT_DIR}/${CONTEXT_YAML_FILE}`,
  ...CONTEXT_MARKDOWN_FILES.map((file) => `${CONTEXT_DIR}/${file}`),
];

const AGENT_FILES = [
  CANONICAL_AGENT_FILE,
  ...WRAPPERS.filter((wrapper) => wrapper.core).map((wrapper) => wrapper.path),
  ...SKILLS.map((skill) => skill.path),
  ...ROLES.map((role) => role.path),
];

const STRUCTURE_CORE_WEIGHT = 70;
const STRUCTURE_REST_WEIGHT = 30;

const TODO_PATTERN = /\bTODO\b/g;
const YAML_PLACEHOLDER_PATTERN = /\b(TODO|UNKNOWN)\b/g;

function countPlaceholders(file: string, body: string): number {
  const pattern = file.endsWith(".yml") ? YAML_PLACEHOLDER_PATTERN : TODO_PATTERN;
  return body.match(pattern)?.length ?? 0;
}

export async function computeScore(root: string): Promise<Scorecard> {
  const allFiles = [CANONICAL_AGENT_FILE, ...CONTEXT_FILES];
  const present: string[] = [];
  const missing: string[] = [];

  for (const file of allFiles) {
    if (await exists(file, root)) present.push(file);
    else missing.push(file);
  }

  const weak = await detectWeak(root, present);
  const structureReadiness = computeStructureReadiness(present, allFiles);
  const contextQuality = await computeContextQuality(root, CONTEXT_FILES);
  const { agentReadiness, missingAgentFiles } = await computeAgentReadiness(root);
  const trustState = await readTrustState(root);

  return {
    readiness: structureReadiness,
    structureReadiness,
    contextQuality,
    agentReadiness,
    trustState,
    present,
    missing,
    weak,
    missingAgentFiles,
    recommendedActions: recommendActions({
      missing,
      weak,
      contextQuality,
      agentReadiness,
      trustState,
      missingAgentFiles,
    }),
  };
}

function computeStructureReadiness(present: string[], allFiles: string[]): number {
  const coreFound = CORE_FILES.filter((file) => present.includes(file)).length;
  const coreScore = (coreFound / CORE_FILES.length) * STRUCTURE_CORE_WEIGHT;
  const restFiles = allFiles.filter((file) => !CORE_FILES.includes(file));
  const restFound = restFiles.filter((file) => present.includes(file)).length;
  const restScore = restFiles.length
    ? (restFound / restFiles.length) * STRUCTURE_REST_WEIGHT
    : STRUCTURE_REST_WEIGHT;

  return Math.round(coreScore + restScore);
}

async function computeContextQuality(root: string, files: string[]): Promise<number> {
  let total = 0;
  let earned = 0;

  for (const file of files) {
    if (!(await exists(file, root))) continue;
    total += 1;
    const body = await fs.readFile(path.join(root, file), "utf8");
    const placeholders = countPlaceholders(file, body);
    const fileScore = Math.max(0, 1 - placeholders / 8);
    earned += fileScore;
  }

  if (total === 0) return 0;
  return Math.round((earned / total) * 100);
}

async function computeAgentReadiness(
  root: string,
): Promise<{ agentReadiness: number; missingAgentFiles: string[] }> {
  const missingAgentFiles: string[] = [];

  for (const file of AGENT_FILES) {
    if (!(await exists(file, root))) missingAgentFiles.push(file);
  }

  return {
    agentReadiness: Math.round(
      ((AGENT_FILES.length - missingAgentFiles.length) / AGENT_FILES.length) * 100,
    ),
    missingAgentFiles,
  };
}

async function detectWeak(root: string, present: string[]): Promise<string[]> {
  const weak: string[] = [];
  for (const file of present) {
    if (!file.endsWith(".md")) continue;
    try {
      const body = await fs.readFile(path.join(root, file), "utf8");
      if (/\bTODO\b/.test(body)) weak.push(file);
    } catch {
      continue;
    }
  }
  return weak;
}

async function readTrustState(root: string): Promise<string> {
  const yamlPath = path.join(root, CONTEXT_DIR, CONTEXT_YAML_FILE);
  if (await fs.pathExists(yamlPath)) {
    try {
      const data = YAML.parse(await fs.readFile(yamlPath, "utf8")) as {
        context_maturity?: { level?: unknown };
      } | null;
      const level = data?.context_maturity?.level;
      if (typeof level === "string" && level.length > 0) return level;
    } catch {
      return "unknown";
    }
  }

  return "unknown";
}

interface RecommendationInput {
  missing: string[];
  weak: string[];
  contextQuality: number;
  agentReadiness: number;
  trustState: string;
  missingAgentFiles: string[];
}

function recommendActions(input: RecommendationInput): string[] {
  const actions: string[] = [];

  if (input.missing.length > 0) actions.push("Run `contextum init` to add missing context files.");
  if (input.missingAgentFiles.length > 0) {
    actions.push("Run `contextum init --agent-pack` or `contextum skills` to add agent-pack files.");
  }
  if (input.weak.includes(`${CONTEXT_DIR}/business-features.md`)) {
    actions.push("Fill `ai-context/business-features.md` with real capabilities and flows.");
  }
  if (input.weak.includes(`${CONTEXT_DIR}/integrations.md`)) {
    actions.push("Fill `ai-context/integrations.md` with inbound/outbound contracts.");
  }
  if (input.weak.includes(`${CONTEXT_DIR}/runtime.md`)) {
    actions.push("Review `ai-context/runtime.md` and replace UNKNOWN commands.");
  }
  if (input.contextQuality < 50) {
    actions.push("Replace remaining TODO placeholders with verified facts before treating this context as reliable.");
  }
  if (input.agentReadiness < 100) actions.push("Install the complete agent pack before multi-agent workflows.");
  if (input.trustState === "auto_generated") {
    actions.push("Promote `ai-context/lifecycle.md` only after human review.");
  }

  return [...new Set(actions)];
}

interface ContextYamlShape {
  repository?: {
    type?: unknown;
    primary_language?: unknown;
    package_manager?: unknown;
    monorepo?: unknown;
    detected_capabilities?: unknown;
    detected_frameworks?: unknown;
  };
  signals?: {
    has_docker?: unknown;
    has_ci?: unknown;
    has_infra?: unknown;
    has_tests?: unknown;
    has_api_routes?: unknown;
  };
}

async function readContextYaml(root: string): Promise<ContextYamlShape | null> {
  const yamlPath = path.join(root, CONTEXT_DIR, CONTEXT_YAML_FILE);
  if (!(await fs.pathExists(yamlPath))) return null;
  try {
    const data = YAML.parse(await fs.readFile(yamlPath, "utf8")) as unknown;
    return data && typeof data === "object" ? (data as ContextYamlShape) : null;
  } catch {
    return null;
  }
}

export async function resolveDetected(
  root: string,
  profile: RepoProfile,
): Promise<Record<string, string>> {
  const summary = detectedSummary(profile);
  const context = await readContextYaml(root);
  if (!context) return summary;

  const repository = context.repository ?? {};
  const signals = context.signals ?? {};

  overlayString(summary, "type", repository.type);
  overlayString(summary, "language", repository.primary_language);
  overlayString(summary, "package manager", repository.package_manager);
  overlayBool(summary, "monorepo", repository.monorepo);
  overlayList(summary, "capabilities", repository.detected_capabilities ?? repository.detected_frameworks);
  overlayBool(summary, "docker", signals.has_docker);
  overlayBool(summary, "CI", signals.has_ci);
  overlayBool(summary, "infra-as-code", signals.has_infra);
  overlayBool(summary, "tests", signals.has_tests);
  overlayBool(summary, "api routes", signals.has_api_routes);

  return summary;
}

function overlayString(target: Record<string, string>, key: string, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed && trimmed.toUpperCase() !== "UNKNOWN") target[key] = trimmed;
}

function overlayBool(target: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === "boolean") target[key] = value ? "yes" : "no";
}

function overlayList(target: Record<string, string>, key: string, value: unknown): void {
  if (!Array.isArray(value)) return;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (items.length) target[key] = items.join(", ");
}

export function detectedSummary(profile: RepoProfile): Record<string, string> {
  return {
    type: profile.type,
    language: profile.primaryLanguage,
    "package manager": profile.packageManager,
    monorepo: profile.isMonorepo ? "yes" : "no",
    capabilities: profile.capabilities.length
      ? profile.capabilities.join(", ")
      : "none",
    docker: profile.hasDocker ? "yes" : "no",
    CI: profile.hasCi ? "yes" : "no",
    "infra-as-code": profile.hasInfra ? "yes" : "no",
    tests: profile.hasTests ? "yes" : "no",
    "api routes": profile.hasApiRoutes ? "yes" : "no",
  };
}

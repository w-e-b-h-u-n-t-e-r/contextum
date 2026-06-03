import YAML from "yaml";
import { CONTEXT_SCHEMA_VERSION, CONTEXTUM_VERSION } from "./constants.js";
import type { RepoProfile } from "./detect.js";

export function buildContextYaml(profile: RepoProfile, date: string): string {
  return YAML.stringify({
    context_schema_version: CONTEXT_SCHEMA_VERSION,
    contextum_version: CONTEXTUM_VERSION,
    repository: {
      name: profile.name,
      type: profile.type,
      primary_language: profile.primaryLanguage,
      package_manager: profile.packageManager,
      detected_capabilities: profile.capabilities,
      monorepo: profile.isMonorepo,
    },
    context_maturity: {
      level: "auto_generated",
      needs_human_review: true,
    },
    context_quality: {
      completeness: 0,
      runtime_accuracy: 0,
      business_mapping: 0,
      integration_mapping: 0,
      operational_safety: 0,
    },
    confidence: {
      technical: "low",
      business: "low",
      runtime: "low",
    },
    entrypoints: [],
    business_features: [],
    integrations: {
      inbound: [],
      outbound: [],
    },
    data_stores: [],
    runtime: {
      commands: {
        install: "UNKNOWN",
        build: "UNKNOWN",
        test: "UNKNOWN",
        lint: "UNKNOWN",
        dev: "UNKNOWN",
        deploy: "UNKNOWN",
      },
    },
    signals: {
      has_docker: profile.hasDocker,
      has_ci: profile.hasCi,
      has_infra: profile.hasInfra,
      has_tests: profile.hasTests,
      has_api_routes: profile.hasApiRoutes,
      top_level_dirs: profile.topLevelDirs,
    },
    staleness: {
      stale_score: 0,
      indicators: [
        "source code changed without context update",
        "runtime config changed",
        "dependency graph changed",
        "API contract changed",
      ],
    },
    freshness: {
      generated_at: date,
      generated_by: "contextum",
      source: "repository scan",
    },
  });
}

export interface ParsedContextYaml {
  valid: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export function parseContextYaml(raw: string): ParsedContextYaml {
  try {
    const data = YAML.parse(raw) as unknown;
    if (data === null || typeof data !== "object") {
      return { valid: false, error: "context.yml is empty or not a mapping" };
    }
    return { valid: true, data: data as Record<string, unknown> };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

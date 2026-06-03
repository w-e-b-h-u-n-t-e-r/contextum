import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";

export interface RepoProfile {
  name: string;
  type: string;
  primaryLanguage: string;
  packageManager: string;
  capabilities: string[];
  isMonorepo: boolean;
  hasDocker: boolean;
  hasCi: boolean;
  hasInfra: boolean;
  hasTests: boolean;
  hasApiRoutes: boolean;
  topLevelDirs: string[];
}

interface PackageJson {
  name?: string;
  workspaces?: unknown;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "vendor",
  "coverage",
]);

const IGNORE_GLOBS = [...IGNORED_DIRS].map((dir) => `**/${dir}/**`);

const LOCKFILE_MANAGERS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["composer.lock", "composer"],
  ["poetry.lock", "poetry"],
  ["requirements.txt", "pip"],
  ["go.sum", "go modules"],
  ["Cargo.lock", "cargo"],
] as const satisfies ReadonlyArray<readonly [string, string]>;

const LANGUAGE_PROBES = [
  { files: ["tsconfig.json"], language: "TypeScript", type: "node" },
  { files: ["composer.json", "artisan"], language: "PHP", type: "php" },
  {
    files: ["pyproject.toml", "requirements.txt", "setup.py"],
    language: "Python",
    type: "python",
  },
  { files: ["go.mod"], language: "Go", type: "go" },
  { files: ["Cargo.toml"], language: "Rust", type: "rust" },
] as const;

const MONOREPO_MARKERS = [
  "pnpm-workspace.yaml",
  "lerna.json",
  "nx.json",
  "turbo.json",
] as const;

const TEST_DIRS = ["tests", "test", "__tests__", "spec"] as const;
const TEST_GLOBS = ["**/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs}"] as const;

const DOCKER_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
] as const;

const CI_FILES = [
  ".github/workflows",
  ".gitlab-ci.yml",
  ".circleci/config.yml",
  "Jenkinsfile",
] as const;

const INFRA_FILES = [
  "terraform",
  "infra",
  "helm",
  "k8s",
  "kubernetes",
  "serverless.yml",
  "serverless.yaml",
] as const;

const API_ROUTE_DIRS = [
  "src/routes",
  "src/api",
  "app/api",
  "pages/api",
  "src/controllers",
  "src/router",
  "src/server",
] as const;

const SOURCE_DIRS = ["src", "app", "lib", "packages", "services"] as const;

export async function detectRepo(root: string): Promise<RepoProfile> {
  const pkg = await readPackageJson(root);
  const exists = (rel: string) => fs.pathExists(path.join(root, rel));
  const existsAny = async (rels: readonly string[]) =>
    (await Promise.all(rels.map(exists))).some(Boolean);

  const [
    packageManager,
    languageInfo,
    isMonorepo,
    hasDocker,
    hasCi,
    hasInfra,
    hasTests,
    hasApiRoutes,
    topLevelDirs,
  ] = await Promise.all([
    detectPackageManager(root, pkg),
    detectLanguageAndType(root, pkg),
    detectMonorepo(root, pkg),
    existsAny(DOCKER_FILES),
    existsAny(CI_FILES),
    existsAny(INFRA_FILES),
    detectTests(root),
    existsAny(API_ROUTE_DIRS),
    listTopLevelDirs(root),
  ]);

  return {
    name: pkg?.name ?? (path.basename(root) || "UNKNOWN"),
    type: languageInfo.type,
    primaryLanguage: languageInfo.language,
    packageManager,
    capabilities: detectCapabilities(pkg, {
      hasApiRoutes,
      hasDocker,
      hasInfra,
      hasTests,
      topLevelDirs,
    }),
    isMonorepo,
    hasDocker,
    hasCi,
    hasInfra,
    hasTests,
    hasApiRoutes,
    topLevelDirs,
  };
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const file = path.join(root, "package.json");
  if (!(await fs.pathExists(file))) return null;
  try {
    return (await fs.readJson(file)) as PackageJson;
  } catch {
    return null;
  }
}

async function detectPackageManager(
  root: string,
  pkg: PackageJson | null,
): Promise<string> {
  if (pkg?.packageManager) {
    return pkg.packageManager.split("@")[0] ?? "UNKNOWN";
  }
  for (const [file, manager] of LOCKFILE_MANAGERS) {
    if (await fs.pathExists(path.join(root, file))) return manager;
  }
  return "UNKNOWN";
}

async function detectLanguageAndType(
  root: string,
  pkg: PackageJson | null,
): Promise<{ language: string; type: string }> {
  for (const probe of LANGUAGE_PROBES) {
    for (const file of probe.files) {
      if (await fs.pathExists(path.join(root, file))) {
        return { language: probe.language, type: probe.type };
      }
    }
  }
  if (pkg) return { language: "JavaScript", type: "node" };
  return { language: "UNKNOWN", type: "UNKNOWN" };
}

interface CapabilityInputs {
  hasApiRoutes: boolean;
  hasDocker: boolean;
  hasInfra: boolean;
  hasTests: boolean;
  topLevelDirs: string[];
}

function detectCapabilities(
  pkg: PackageJson | null,
  inputs: CapabilityInputs,
): string[] {
  const found = new Set<string>();

  if (inputs.hasApiRoutes) found.add("api");
  if (inputs.hasDocker) found.add("containerized runtime");
  if (inputs.hasInfra) found.add("infrastructure");
  if (inputs.hasTests) found.add("tests");
  if (inputs.topLevelDirs.some((dir) => (SOURCE_DIRS as readonly string[]).includes(dir))) {
    found.add("application code");
  }

  if (pkg) found.add("package-managed project");

  return [...found].sort();
}

async function detectMonorepo(
  root: string,
  pkg: PackageJson | null,
): Promise<boolean> {
  if (pkg?.workspaces) return true;
  for (const marker of MONOREPO_MARKERS) {
    if (await fs.pathExists(path.join(root, marker))) return true;
  }
  return false;
}

async function detectTests(root: string): Promise<boolean> {
  for (const dir of TEST_DIRS) {
    if (await fs.pathExists(path.join(root, dir))) return true;
  }
  const matches = await globby(TEST_GLOBS, {
    cwd: root,
    gitignore: true,
    ignore: IGNORE_GLOBS,
    deep: 4,
  });
  return matches.length > 0;
}

async function listTopLevelDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !IGNORED_DIRS.has(entry.name) &&
        !entry.name.startsWith("."),
    )
    .map((entry) => entry.name)
    .sort();
}

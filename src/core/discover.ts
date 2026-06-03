import { globby } from "globby";
import {
  CANONICAL_AGENT_FILE,
  CONTEXT_DIR,
  ROLES,
  SKILLS,
  WRAPPERS,
} from "./constants.js";

const DISCOVERY_GLOBS = [
  "README*",
  "ARCHITECTURE*",
  "CONTRIBUTING*",
  "DESIGN*",
  "NOTES*",
  "ROADMAP*",
  "CHANGELOG*",
  "HACKING*",
  "docs/**/*.{md,mdx,txt,adoc,rst}",
  "doc/**/*.{md,mdx,txt}",
  "documentation/**/*.{md,mdx,txt}",
  "wiki/**/*.{md,mdx,txt}",
  "**/adr/**/*.{md,mdx}",
  "**/adrs/**/*.{md,mdx}",
  "**/decisions/**/*.{md,mdx}",
  "**/rfcs/**/*.{md,mdx}",
  ".cursorrules",
  ".clinerules",
  ".windsurfrules",
  ".github/**/*.md",
  "**/openapi*.{yml,yaml,json}",
  "**/swagger*.{yml,yaml,json}",
  "apps/*/README*",
  "packages/*/README*",
  "services/*/README*",
  "**/*.md",
];

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/vendor/**",
  "**/coverage/**",
  "**/.next/**",
];

const MAX_RESULTS = 80;

export async function discoverExistingContext(root: string): Promise<string[]> {
  const hits = await globby(DISCOVERY_GLOBS, {
    cwd: root,
    gitignore: true,
    ignore: IGNORE_GLOBS,
    dot: true,
    onlyFiles: true,
    unique: true,
    caseSensitiveMatch: false,
    deep: 6,
  });

  const managed = managedPaths();
  return hits
    .filter((rel) => !isManaged(rel, managed))
    .sort()
    .slice(0, MAX_RESULTS);
}

interface ManagedPaths {
  exact: Set<string>;
  prefixes: string[];
}

function managedPaths(): ManagedPaths {
  return {
    exact: new Set<string>([
      CANONICAL_AGENT_FILE,
      ...WRAPPERS.map((wrapper) => wrapper.path),
      ...SKILLS.map((skill) => skill.path),
      ...ROLES.map((role) => role.path),
    ]),
    prefixes: [`${CONTEXT_DIR}/`, ".claude/"],
  };
}

function isManaged(rel: string, managed: ManagedPaths): boolean {
  if (managed.exact.has(rel)) return true;
  return managed.prefixes.some((prefix) => rel.startsWith(prefix));
}

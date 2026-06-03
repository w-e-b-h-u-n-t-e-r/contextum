import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";

export interface SymbolEntry {
  name: string;
  kind: string;
}

export interface FileSymbols {
  file: string;
  symbols: SymbolEntry[];
}

export interface SymbolMap {
  generated_by: string;
  note: string;
  file_count: number;
  symbol_count: number;
  files: FileSymbols[];
}

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.*/**",
  "**/*.d.ts",
];

const EXPORT_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "function", pattern: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gm },
  { kind: "class", pattern: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/gm },
  { kind: "interface", pattern: /^\s*export\s+interface\s+([A-Za-z0-9_$]+)/gm },
  { kind: "type", pattern: /^\s*export\s+type\s+([A-Za-z0-9_$]+)/gm },
  { kind: "enum", pattern: /^\s*export\s+(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/gm },
  { kind: "constant", pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm },
];

const NAMED_REEXPORT = /export\s*\{([^}]*)\}/g;
const DEFAULT_EXPORT = /^\s*export\s+default\s+(?!function|class|async)/gm;

export async function buildSymbolMap(root: string): Promise<SymbolMap | null> {
  const sources = await globby(SOURCE_GLOBS, {
    cwd: root,
    gitignore: true,
    ignore: IGNORE_GLOBS,
  });
  if (sources.length === 0) return null;

  const files: FileSymbols[] = [];
  let symbolCount = 0;

  for (const file of sources.sort()) {
    const body = await fs.readFile(path.join(root, file), "utf8");
    const symbols = extractSymbols(body);
    if (symbols.length === 0) continue;
    files.push({ file, symbols });
    symbolCount += symbols.length;
  }

  if (files.length === 0) return null;

  return {
    generated_by: "contextum graph",
    note: "Heuristic export-symbol index (static name extraction). Approximate — verify against code.",
    file_count: files.length,
    symbol_count: symbolCount,
    files,
  };
}

function extractSymbols(body: string): SymbolEntry[] {
  const found = new Map<string, string>();

  for (const { kind, pattern } of EXPORT_PATTERNS) {
    for (const match of body.matchAll(pattern)) {
      const name = match[1];
      if (name && !found.has(name)) found.set(name, kind);
    }
  }

  for (const match of body.matchAll(NAMED_REEXPORT)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = exportedName(raw);
      if (name && name !== "default" && !found.has(name)) found.set(name, "re-export");
    }
  }

  if (DEFAULT_EXPORT.test(body) && !found.has("default")) found.set("default", "default");
  DEFAULT_EXPORT.lastIndex = 0;

  return [...found.entries()]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function exportedName(rawSpecifier: string): string | null {
  const trimmed = rawSpecifier.trim();
  if (!trimmed) return null;
  const asMatch = /(?:\s+as\s+)([A-Za-z0-9_$]+)$/.exec(trimmed);
  const name = asMatch ? asMatch[1]! : trimmed.replace(/^type\s+/, "");
  return /^[A-Za-z0-9_$]+$/.test(name) ? name : null;
}

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import {
  CANONICAL_AGENT_FILE,
  CONTEXT_DIR,
  CONTEXT_MARKDOWN_FILES,
  CONTEXT_YAML_FILE,
  WRAPPERS,
  diagramPaths,
} from "../core/constants.js";
import { exists, readFile } from "../core/files.js";
import { parseContextYaml } from "../core/contextYaml.js";
import { log } from "../core/log.js";

export interface ValidateOptions {
  root: string;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

const MERMAID_HEAD =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram)/m;
const LINK_PATTERN = /\(([^)]+\.md)\)|`(ai-context\/[^`]+)`/g;

export async function validate({ root }: ValidateOptions): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(await exists(CONTEXT_DIR, root))) {
    errors.push(`${CONTEXT_DIR}/ is missing — run \`contextum init\`.`);
    return finish(errors, warnings);
  }

  if (!(await exists(CANONICAL_AGENT_FILE, root))) {
    errors.push(`${CANONICAL_AGENT_FILE} is missing — run \`contextum agents\`.`);
  }

  for (const file of CONTEXT_MARKDOWN_FILES) {
    const rel = `${CONTEXT_DIR}/${file}`;
    if (!(await exists(rel, root))) errors.push(`missing required file: ${rel}`);
  }

  const yamlRel = `${CONTEXT_DIR}/${CONTEXT_YAML_FILE}`;
  if (!(await exists(yamlRel, root))) {
    errors.push(`missing required file: ${yamlRel}`);
  } else {
    const parsed = parseContextYaml(await readFile(yamlRel, root));
    if (!parsed.valid) {
      errors.push(`${yamlRel} is not valid YAML: ${parsed.error}`);
    } else if (!parsed.data?.freshness) {
      warnings.push(`${yamlRel} has no \`freshness\` block.`);
    }
  }

  for (const wrapper of WRAPPERS.filter((w) => w.core)) {
    if (!(await exists(wrapper.path, root))) {
      warnings.push(`missing ${wrapper.tool} wrapper: ${wrapper.path}`);
    }
  }

  for (const diagram of diagramPaths()) {
    if (!(await exists(diagram, root))) {
      warnings.push(`missing diagram: ${diagram}`);
      continue;
    }
    if (!MERMAID_HEAD.test(await readFile(diagram, root))) {
      warnings.push(`${diagram} does not start with a recognizable Mermaid diagram type.`);
    }
  }

  await collectBrokenLinks(root, warnings);
  return finish(errors, warnings);
}

async function collectBrokenLinks(root: string, warnings: string[]): Promise<void> {
  const files = await globby([`${CONTEXT_DIR}/**/*.md`], { cwd: root });

  for (const file of files) {
    const body = await fs.readFile(path.join(root, file), "utf8");
    for (const match of body.matchAll(LINK_PATTERN)) {
      const ref = (match[1] ?? match[2] ?? "").trim();
      if (!ref || ref.startsWith("http") || ref.startsWith("#")) continue;
      const resolved = ref.startsWith(CONTEXT_DIR)
        ? path.join(root, ref)
        : path.join(root, path.dirname(file), ref);
      if (!(await fs.pathExists(resolved))) {
        warnings.push(`${file} links to missing path: ${ref}`);
      }
    }
  }
}

function finish(errors: string[], warnings: string[]): ValidationReport {
  return { errors, warnings, ok: errors.length === 0 };
}

export function reportValidation(report: ValidationReport): number {
  log.title("contextum validate");
  for (const warning of report.warnings) log.warn(warning);
  for (const error of report.errors) log.err(error);

  if (report.ok && report.warnings.length === 0) {
    log.ok("Context layer is valid. No issues found.");
  } else if (report.ok) {
    log.ok(`Valid with ${report.warnings.length} warning(s).`);
  } else {
    log.err(
      `Invalid: ${report.errors.length} error(s), ${report.warnings.length} warning(s).`,
    );
  }

  return report.ok ? 0 : 1;
}

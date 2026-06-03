import {
  CONTEXT_DIR,
  CONTEXT_YAML_FILE,
  DIAGRAMS_DIR,
} from "../core/constants.js";
import { detectRepo } from "../core/detect.js";
import { buildContextYaml } from "../core/contextYaml.js";
import { writeFile, type WriteResult } from "../core/files.js";
import { log, reportWrites } from "../core/log.js";
import * as templates from "../core/templates.js";

export interface GenerateOptions {
  root: string;
  force?: boolean;
  quiet?: boolean;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function generate(opts: GenerateOptions): Promise<WriteResult[]> {
  const { root, force } = opts;
  if (!opts.quiet) log.title("contextum generate");

  const profile = await detectRepo(root);
  const date = today();
  const results: WriteResult[] = [];
  const write = async (rel: string, content: string) => {
    results.push(await writeFile(rel, content, { root, force }));
  };

  await write(`${CONTEXT_DIR}/${CONTEXT_YAML_FILE}`, buildContextYaml(profile, date));

  await write(`${CONTEXT_DIR}/README.md`, templates.readme(profile));
  await write(`${CONTEXT_DIR}/code-map.md`, templates.codeMap(profile));
  await write(`${CONTEXT_DIR}/business-features.md`, templates.businessFeatures());
  await write(`${CONTEXT_DIR}/integrations.md`, templates.integrations());
  await write(`${CONTEXT_DIR}/runtime.md`, templates.runtime(profile));
  await write(`${CONTEXT_DIR}/data-model.md`, templates.dataModel());
  await write(`${CONTEXT_DIR}/architecture-flows.md`, templates.architectureFlows());
  await write(`${CONTEXT_DIR}/change-impact.md`, templates.changeImpact());
  await write(`${CONTEXT_DIR}/repository-boundaries.md`, templates.repositoryBoundaries());
  await write(`${CONTEXT_DIR}/decisions.md`, templates.decisions());
  await write(`${CONTEXT_DIR}/relationships.md`, templates.relationships());
  await write(`${CONTEXT_DIR}/unknowns.md`, templates.unknowns());
  await write(`${CONTEXT_DIR}/lifecycle.md`, templates.lifecycle());
  await write(`${CONTEXT_DIR}/freshness.md`, templates.freshness(date));
  await write(`${CONTEXT_DIR}/agent-workflows.md`, templates.agentWorkflows());

  await write(`${DIAGRAMS_DIR}/runtime-flow.mmd`, templates.diagramRuntimeFlow());
  await write(`${DIAGRAMS_DIR}/dependency-graph.mmd`, templates.diagramDependencyGraph(profile));
  await write(`${DIAGRAMS_DIR}/blast-radius.mmd`, templates.diagramBlastRadius());

  if (!opts.quiet) reportWrites(results);
  return results;
}

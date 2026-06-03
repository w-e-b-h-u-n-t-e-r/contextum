import { DIAGRAMS_DIR } from "../core/constants.js";
import { buildCodeGraph, toMermaid } from "../core/codeGraph.js";
import { buildSymbolMap } from "../core/symbols.js";
import { writeFile, type WriteResult } from "../core/files.js";
import { log, reportWrites } from "../core/log.js";

export interface GraphOptions {
  root: string;
  force?: boolean;
  quiet?: boolean;
}

export async function graph({ root, force, quiet }: GraphOptions): Promise<WriteResult[]> {
  if (!quiet) log.title("contextum graph");

  const [data, symbolMap] = await Promise.all([
    buildCodeGraph(root),
    buildSymbolMap(root),
  ]);

  if (!data && !symbolMap) {
    if (!quiet) {
      log.warn("No analyzable source files found.");
      log.dim("  Language-specific graph adapters are not implemented yet.");
    }
    return [];
  }

  const results: WriteResult[] = [];

  if (data) {
    results.push(
      await writeFile(`${DIAGRAMS_DIR}/code-graph.mmd`, toMermaid(data), { root, force }),
      await writeFile(
        `${DIAGRAMS_DIR}/code-graph.json`,
        JSON.stringify(data, null, 2),
        { root, force },
      ),
    );
  }

  if (symbolMap) {
    results.push(
      await writeFile(
        `${DIAGRAMS_DIR}/code-symbols.json`,
        JSON.stringify(symbolMap, null, 2),
        { root, force },
      ),
    );
  }

  if (!quiet) {
    reportWrites(results);
    log.dim(
      `  → engine: ${data?.engine ?? "none"}, ${data?.nodes.length ?? 0} nodes, ` +
        `${data?.edges.length ?? 0} edges, ${symbolMap?.symbol_count ?? 0} symbols`,
    );
  }

  return results;
}

import { CONTEXT_DIR } from "../core/constants.js";
import { buildContextIndex, toNdjson } from "../core/contextIndex.js";
import { writeFile, type WriteResult } from "../core/files.js";
import { log, reportWrites } from "../core/log.js";

export type IndexFormat = "json" | "ndjson";

export interface IndexOptions {
  root: string;
  force?: boolean;
  quiet?: boolean;
  format?: IndexFormat | string;
}

export async function index(opts: IndexOptions): Promise<WriteResult[]> {
  const { root, force } = opts;
  const format = normalizeFormat(opts.format);
  if (!opts.quiet) log.title("contextum index");

  const contextIndex = await buildContextIndex(root);
  if (!contextIndex) {
    if (!opts.quiet) log.warn("Nothing to index yet (no symbols, graph, or relationships).");
    return [];
  }

  const results: WriteResult[] = [];
  if (format === "ndjson") {
    results.push(
      await writeFile(
        `${CONTEXT_DIR}/context-index.ndjson`,
        toNdjson(contextIndex),
        { root, force },
      ),
    );
  } else {
    results.push(
      await writeFile(
        `${CONTEXT_DIR}/context-index.json`,
        JSON.stringify(contextIndex, null, 2),
        { root, force },
      ),
    );
  }

  if (!opts.quiet) {
    reportWrites(results);
    const kinds = Object.entries(contextIndex.stats.by_kind)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ");
    log.dim(
      `  → ${contextIndex.stats.documents} documents (${kinds}), ` +
        `${contextIndex.adjacency.edges.length} structural edges, embedding: pending`,
    );
  }

  return results;
}

function normalizeFormat(format: IndexOptions["format"]): IndexFormat {
  if (format === undefined || format === "json") return "json";
  if (format === "ndjson") return "ndjson";
  throw new Error(`Unsupported index format: ${format}. Use json or ndjson.`);
}

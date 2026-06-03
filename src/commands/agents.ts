import { CANONICAL_AGENT_FILE, WRAPPERS } from "../core/constants.js";
import { detectRepo } from "../core/detect.js";
import { writeFile, type WriteResult } from "../core/files.js";
import { log, reportWrites } from "../core/log.js";
import { agentsMd, wrapper } from "../core/templates.js";

export interface AgentsOptions {
  root: string;
  force?: boolean;
  coreOnly?: boolean;
  quiet?: boolean;
}

export async function agents(opts: AgentsOptions): Promise<WriteResult[]> {
  const { root, force } = opts;
  if (!opts.quiet) log.title("contextum agents");

  const profile = await detectRepo(root);
  const results: WriteResult[] = [
    await writeFile(CANONICAL_AGENT_FILE, agentsMd(profile), { root, force }),
  ];

  const targets = opts.coreOnly ? WRAPPERS.filter((w) => w.core) : WRAPPERS;
  for (const target of targets) {
    results.push(await writeFile(target.path, wrapper(target.tool), { root, force }));
  }

  if (!opts.quiet) reportWrites(results);
  return results;
}

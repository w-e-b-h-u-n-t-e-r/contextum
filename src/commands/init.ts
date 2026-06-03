import { log, reportWrites } from "../core/log.js";
import { generate } from "./generate.js";
import { agents } from "./agents.js";
import { skills } from "./skills.js";
import { graph } from "./graph.js";
import { index } from "./indexCmd.js";

export interface InitOptions {
  root: string;
  force?: boolean;
  agentPack?: boolean;
}

export async function init(opts: InitOptions): Promise<void> {
  log.title("contextum init");
  log.dim(`  root: ${opts.root}`);

  const generated = await generate({ ...opts, quiet: true });
  const wrappers = await agents({ ...opts, coreOnly: true, quiet: true });
  const agentPack = opts.agentPack
    ? await skills({ ...opts, quiet: true })
    : [];
  const codeGraph = await graph({ ...opts, quiet: true });
  const contextIndex = await index({ ...opts, quiet: true });

  reportWrites([...generated, ...wrappers, ...agentPack, ...codeGraph, ...contextIndex]);

  log.ok("Contextum layer initialized.");
  log.dim("  Next: review ai-context/, then run `contextum doctor`.");
}

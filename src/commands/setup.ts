import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { init } from "./init.js";
import { centerInit } from "./center.js";
import { installMcp } from "./mcpInstall.js";
import { log } from "../core/log.js";

export interface SetupOptions {
  root: string;
  force?: boolean;
  yes?: boolean;
  command?: string;
}

export async function setup(opts: SetupOptions): Promise<void> {
  log.title("contextum setup");
  log.dim(`  root: ${opts.root}`);

  if (!opts.yes) {
    const confirmed = await confirm(
      "This will initialize Contextum files, create .contextum/, install project MCP config, and recommend Claude author + Codex reviewer workflow. Continue?",
    );
    if (!confirmed) {
      log.warn("Setup cancelled.");
      return;
    }
  }

  await init({ root: opts.root, force: opts.force, agentPack: true });
  await centerInit({ root: opts.root, force: opts.force });
  await installMcp({ root: opts.root, force: opts.force, command: opts.command });

  log.ok("Contextum setup complete.");
  log.dim("  Next: open Claude Code in this repository and run /mcp to approve or inspect the server.");
  log.dim("  For two Claude accounts, connect both profiles to this project MCP server.");
  log.dim("  For tango review, connect Codex/reviewer clients to the same MCP command: contextum mcp --cwd <repo-path>.");
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

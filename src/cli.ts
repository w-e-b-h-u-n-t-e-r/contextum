import path from "node:path";
import process from "node:process";
import { cac } from "cac";
import { CONTEXTUM_VERSION } from "./core/constants.js";
import { log } from "./core/log.js";
import { init } from "./commands/init.js";
import { generate } from "./commands/generate.js";
import { agents } from "./commands/agents.js";
import { validate, reportValidation } from "./commands/validate.js";
import { doctor } from "./commands/doctor.js";
import { graph } from "./commands/graph.js";
import { skills } from "./commands/skills.js";
import { fill } from "./commands/fill.js";
import { index } from "./commands/indexCmd.js";

interface CommonFlags {
  cwd?: string;
  force?: boolean;
}

interface FillFlags extends CommonFlags {
  dryRun?: boolean;
  agent?: string;
  agentCommand?: string;
  agentSandbox?: string;
  bypassAgentSandbox?: boolean;
}

const rootOf = (flags: CommonFlags) => path.resolve(flags.cwd ?? process.cwd());

const cli = cac("contextum");

cli
  .command("init", "Bootstrap the Contextum layer (ai-context/ + agent files)")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .option("--agent-pack", "Also write Contextum skills and role prompts")
  .action((flags: CommonFlags & { agentPack?: boolean }) =>
    init({
      root: rootOf(flags),
      force: flags.force,
      agentPack: flags.agentPack,
    }),
  );

cli
  .command("generate", "Generate or update ai-context/ documents")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .action((flags: CommonFlags) => generate({ root: rootOf(flags), force: flags.force }));

cli
  .command("agents", "Write canonical AGENTS.md and tool-specific wrappers")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .action((flags: CommonFlags) => agents({ root: rootOf(flags), force: flags.force }));

cli
  .command("validate", "Validate the structure of the Contextum layer")
  .option("--cwd <dir>", "Target repository root")
  .action(async (flags: CommonFlags) => {
    process.exitCode = reportValidation(await validate({ root: rootOf(flags) }));
  });

cli
  .command("doctor", "Print an AI-readiness scorecard")
  .option("--cwd <dir>", "Target repository root")
  .action((flags: CommonFlags) => doctor({ root: rootOf(flags) }));

cli
  .command("graph", "Generate the code dependency graph and symbol map")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .action((flags: CommonFlags) => graph({ root: rootOf(flags), force: flags.force }));

cli
  .command("index", "Build the vector-DB-ready context index (no DB required)")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .option("--format <format>", "Output format: json (default) or ndjson", { default: "json" })
  .action((flags: CommonFlags & { format?: string }) =>
    index({ root: rootOf(flags), force: flags.force, format: flags.format }),
  );

cli
  .command("skills", "Write Contextum skills and role prompts")
  .option("--cwd <dir>", "Target repository root")
  .option("--force", "Overwrite existing files")
  .action((flags: CommonFlags) => skills({ root: rootOf(flags), force: flags.force }));

cli
  .command("fill", "Use an AI coding agent to fill ai-context from the real repository")
  .option("--cwd <dir>", "Target repository root")
  .option("--agent <agent>", "Agent to run: claude or codex", { default: "claude" })
  .option("--agent-command <cmd>", "Override the agent binary command")
  .option("--agent-sandbox <mode>", "Codex sandbox: read-only, workspace-write, danger-full-access")
  .option("--bypass-agent-sandbox", "Ask Codex to bypass its approvals and sandbox")
  .option("--dry-run", "Print the fill prompt without running an agent")
  .action((flags: FillFlags) =>
    fill({
      root: rootOf(flags),
      dryRun: flags.dryRun,
      agent: flags.agent,
      agentCommand: flags.agentCommand,
      agentSandbox: flags.agentSandbox,
      bypassAgentSandbox: flags.bypassAgentSandbox,
    }),
  );

cli.help();
cli.version(CONTEXTUM_VERSION);

async function main(): Promise<void> {
  try {
    cli.parse(process.argv, { run: false });
    if (!cli.matchedCommand && cli.args.length === 0) {
      cli.outputHelp();
      return;
    }
    await cli.runMatchedCommand();
  } catch (error) {
    log.err((error as Error).message);
    if (process.env.CONTEXTUM_DEBUG) console.error(error);
    process.exitCode = 1;
  }
}

void main();

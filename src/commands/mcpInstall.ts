import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { CONTEXTUM_VERSION } from "../core/constants.js";
import { log } from "../core/log.js";

export interface McpInstallOptions {
  root: string;
  force?: boolean;
  quiet?: boolean;
  /** Override the launcher, e.g. an absolute path to a checked-out CLI. */
  command?: string;
}

const MCP_CONFIG = ".mcp.json";
const SERVER_NAME = "contextum";
const PROJECT_DIR_PLACEHOLDER = "${CLAUDE_PROJECT_DIR:-.}";

interface McpJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ServerLauncher {
  command: string;
  args: string[];
  /** How the command was chosen, for the install log and troubleshooting. */
  source: "override" | "path" | "local-install" | "npx-fallback";
}

export async function installMcp(opts: McpInstallOptions): Promise<"created" | "updated" | "skipped"> {
  const root = path.resolve(opts.root);
  const target = path.join(root, MCP_CONFIG);
  if (!opts.quiet) log.title("contextum mcp install");

  const existing = await readMcpJson(target);
  const servers = existing.mcpServers ?? {};
  if (servers[SERVER_NAME] && !opts.force) {
    if (!opts.quiet) {
      log.warn(`${MCP_CONFIG} already defines ${SERVER_NAME}; use --force to replace it.`);
    }
    return "skipped";
  }

  const launcher = await resolveServerLauncher(root, opts.command);
  const existed = await fs.pathExists(target);
  const next: McpJson = {
    ...existing,
    mcpServers: {
      ...servers,
      [SERVER_NAME]: {
        type: "stdio",
        command: launcher.command,
        args: [...launcher.args, "mcp", "--cwd", PROJECT_DIR_PLACEHOLDER],
      },
    },
  };

  await fs.writeJson(target, next, { spaces: 2 });
  const status = existed ? "updated" : "created";

  if (!opts.quiet) {
    log.ok(`${status} ${MCP_CONFIG}`);
    log.dim(`  launcher: ${[launcher.command, ...launcher.args].join(" ")} (${launcher.source})`);
    if (launcher.source === "npx-fallback") {
      log.warn("  `contextum` is not on PATH; the config falls back to npx.");
      log.dim("  Install it globally (npm i -g contextum) or pass --command <path> for a local checkout.");
    }
    log.dim("  Shared memory: connect every MCP-capable agent to this same project server.");
    log.dim("  Claude: project .mcp.json lets primary and secondary profiles share repo memory.");
    log.dim("  Codex/reviewers: configure the same command when your Codex client supports MCP.");
    log.dim("  Recommended workflow: Claude authors, Codex reviews the diff, then the author fixes findings.");
  }

  return status;
}

/**
 * A config that names a binary nobody can run is worse than no config, so the
 * launcher is resolved against what actually exists on this machine.
 */
export async function resolveServerLauncher(root: string, override?: string): Promise<ServerLauncher> {
  if (override) return { command: override, args: [], source: "override" };
  if (commandExists(SERVER_NAME)) return { command: SERVER_NAME, args: [], source: "path" };

  const localBin = path.join(root, "node_modules", ".bin", SERVER_NAME);
  if (await fs.pathExists(localBin)) {
    return { command: "npx", args: [SERVER_NAME], source: "local-install" };
  }

  return { command: "npx", args: ["-y", `${SERVER_NAME}@${CONTEXTUM_VERSION}`], source: "npx-fallback" };
}

function commandExists(command: string): boolean {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

async function readMcpJson(target: string): Promise<McpJson> {
  if (!(await fs.pathExists(target))) return {};
  const parsed = await fs.readJson(target) as unknown;
  if (!isRecord(parsed)) throw new Error(`${MCP_CONFIG} must contain a JSON object.`);
  return parsed;
}

function isRecord(value: unknown): value is McpJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import readline from "node:readline";
import path from "node:path";
import fs from "fs-extra";
import {
  CANONICAL_AGENT_FILE,
  CONTEXT_DIR,
  CONTEXT_MARKDOWN_FILES,
  CONTEXT_YAML_FILE,
  CONTEXTUM_VERSION,
} from "../core/constants.js";
import { tokenize } from "../core/contextIndex.js";
import {
  acquireLock,
  claimTask,
  createTask,
  patchExecutionState,
  recordHandoff,
  listEvents,
  registerAgent,
  releaseLock,
  releaseTask,
  updateTask,
} from "../core/centerStore.js";

export interface McpServerOptions {
  root: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: JsonValue;
  error?: {
    code: number;
    message: string;
  };
}

interface McpTool extends Record<string, JsonValue> {
  name: string;
  description: string;
  inputSchema: JsonValue;
}

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CENTER_DIR = ".contextum";

const CONTEXT_FILES = [
  CANONICAL_AGENT_FILE,
  `${CONTEXT_DIR}/${CONTEXT_YAML_FILE}`,
  ...CONTEXT_MARKDOWN_FILES.map((file) => `${CONTEXT_DIR}/${file}`),
  `${CONTEXT_DIR}/diagrams/code-graph.mmd`,
  `${CONTEXT_DIR}/diagrams/code-graph.json`,
  `${CONTEXT_DIR}/diagrams/code-symbols.json`,
  `${CONTEXT_DIR}/context-index.json`,
  `${CONTEXT_DIR}/context-index.ndjson`,
];

interface ToolSpec {
  name: string;
  title: string;
  description: string;
  schema: JsonValue;
  readOnly: boolean;
}

const READ_TOOLS: Array<Omit<ToolSpec, "readOnly">> = [
  {
    name: "contextum.repo_status",
    title: "Repository status",
    description: "Summarize Contextum files present in the repository.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.list_context_files",
    title: "List context files",
    description: "List context files this MCP server is allowed to read.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.shared_memory_status",
    title: "Shared memory status",
    description: "Describe this project's shared memory model for MCP-capable authors and reviewers.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.search_context",
    title: "Search context",
    description: "Search whitelisted context files and the vector-ready context index with lexical scoring.",
    schema: objectSchema({
      query: { type: "string" },
      limit: { type: "number" },
    }, ["query"]),
  },
  {
    name: "contextum.read_context",
    title: "Read context file",
    description: "Read a whitelisted AGENTS.md or ai-context file by repo-relative path.",
    schema: objectSchema({
      path: { type: "string", description: "Repo-relative context path, for example ai-context/README.md." },
    }, ["path"]),
  },
  {
    name: "contextum.list_tasks",
    title: "List tasks",
    description: "Read .contextum/tasks.json when the multi-agent center exists.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.list_agents",
    title: "List agent sessions",
    description: "Read .contextum/agents.json when the multi-agent center exists.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.list_locks",
    title: "List locks",
    description: "Read .contextum/locks.json when the multi-agent center exists.",
    schema: objectSchema({}),
  },
  {
    name: "contextum.list_events",
    title: "List events and handoffs",
    description:
      "Read recent entries from .contextum/events.jsonl, including handoffs addressed to another agent.",
    schema: objectSchema({
      limit: { type: "number", description: "How many recent events to return (1-200, default 20)." },
      type: { type: "string", description: "Filter by event type, for example handoff.recorded." },
      task_id: { type: "string" },
      agent_id: { type: "string" },
    }),
  },
  {
    name: "contextum.read_execution_state",
    title: "Read execution state",
    description: "Read .contextum/execution-state.json when the multi-agent center exists.",
    schema: objectSchema({}),
  },
];

const WRITE_TOOLS: Array<Omit<ToolSpec, "readOnly">> = [
  {
    name: "contextum.create_task",
    title: "Create task",
    description: "Create a task in .contextum/tasks.json and append an event.",
    schema: objectSchema({
      title: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
      role: { type: "string" },
      context_areas: { type: "array", items: { type: "string" } },
      affected_paths: { type: "array", items: { type: "string" } },
      acceptance_checks: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    }, ["title"]),
  },
  {
    name: "contextum.claim_task",
    title: "Claim task",
    description: "Claim an open task for an agent unless another agent owns it.",
    schema: objectSchema({
      task_id: { type: "string" },
      agent_id: { type: "string" },
    }, ["task_id", "agent_id"]),
  },
  {
    name: "contextum.update_task",
    title: "Update task",
    description:
      "Move a task through the review lifecycle (open, claimed, blocked, review, done, cancelled) and update its metadata.",
    schema: objectSchema({
      task_id: { type: "string" },
      agent_id: { type: "string", description: "Checked against the current owner when the task is claimed." },
      status: { type: "string", enum: ["open", "claimed", "blocked", "review", "done", "cancelled"] },
      priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
      role: { type: "string" },
      notes: { type: "string" },
      context_areas: { type: "array", items: { type: "string" } },
      affected_paths: { type: "array", items: { type: "string" } },
      acceptance_checks: { type: "array", items: { type: "string" } },
    }, ["task_id"]),
  },
  {
    name: "contextum.release_task",
    title: "Release task",
    description: "Release a claimed task back to open state.",
    schema: objectSchema({
      task_id: { type: "string" },
      agent_id: { type: "string" },
    }, ["task_id"]),
  },
  {
    name: "contextum.register_agent",
    title: "Register agent session",
    description:
      "Register or refresh an agent session in .contextum/agents.json. Only the fields you pass are updated.",
    schema: objectSchema({
      id: { type: "string" },
      tool: { type: "string", enum: ["claude", "codex", "cursor", "copilot", "gemini", "human", "other"] },
      profile: { type: "string" },
      role: { type: "string" },
      status: { type: "string", enum: ["active", "idle", "blocked", "done"] },
      worktree: { type: "string" },
      current_task_id: { type: "string" },
    }),
  },
  {
    name: "contextum.acquire_lock",
    title: "Acquire lock",
    description: "Acquire a cooperative lock over a path or context area.",
    schema: objectSchema({
      scope: { type: "string" },
      scope_type: { type: "string", enum: ["path", "context_area", "task", "other"] },
      owner_agent_id: { type: "string" },
      task_id: { type: "string" },
      reason: { type: "string" },
      ttl_seconds: { type: "number" },
    }, ["scope", "owner_agent_id"]),
  },
  {
    name: "contextum.release_lock",
    title: "Release lock",
    description: "Release a cooperative lock by id or scope.",
    schema: objectSchema({
      id: { type: "string" },
      scope: { type: "string" },
      owner_agent_id: { type: "string" },
    }),
  },
  {
    name: "contextum.record_handoff",
    title: "Record handoff",
    description: "Append a handoff event to .contextum/events.jsonl for another agent to read back.",
    schema: objectSchema({
      message: { type: "string" },
      task_id: { type: "string" },
      from_agent_id: { type: "string" },
      to_agent_id: { type: "string" },
    }, ["message"]),
  },
  {
    name: "contextum.patch_execution_state",
    title: "Patch execution state",
    description:
      "Upsert compact execution state for a long-running task. A list field replaces the list; the matching <field>_add key appends to it.",
    schema: objectSchema({
      id: { type: "string" },
      patch: { type: "object" },
    }, ["id", "patch"]),
  },
];

const KNOWN_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS].map((spec) => spec.name));

export function listMcpTools(): McpTool[] {
  return [
    ...READ_TOOLS.map((spec) => toTool(spec, true)),
    ...WRITE_TOOLS.map((spec) => toTool(spec, false)),
  ];
}

function toTool(spec: Omit<ToolSpec, "readOnly">, readOnly: boolean): McpTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.schema,
    // Clients use these hints to decide which tools need confirmation.
    annotations: {
      title: spec.title,
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
  };
}

export async function runMcpServer(opts: McpServerOptions): Promise<void> {
  const root = path.resolve(opts.root);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const payload = await handleWireMessage(line, root);
    // A batch request gets one JSON array back, a single request one object,
    // and a notification-only payload gets nothing at all.
    if (payload !== null) process.stdout.write(JSON.stringify(payload) + "\n");
  }
}

export async function handleWireMessage(
  line: string,
  root: string,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return errorResponse(null, -32700, "Parse error");
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return errorResponse(null, -32600, "Invalid Request");
    const responses = await Promise.all(
      parsed.map((message) => handleMcpMessage(message as JsonRpcRequest, root)),
    );
    const answered = responses.filter((response): response is JsonRpcResponse => response !== null);
    return answered.length ? answered : null;
  }

  return handleMcpMessage(parsed as JsonRpcRequest, root);
}

export async function handleMcpMessage(
  message: JsonRpcRequest,
  root: string,
): Promise<JsonRpcResponse | null> {
  const method = message.method;
  // JSON-RPC forbids replying to a notification. Claude Code sends
  // notifications/cancelled on interrupt, so an answer here is a protocol error.
  const isNotification = message.id === undefined || message.id === null;
  const id = message.id ?? null;

  try {
    if (!method) return isNotification ? null : errorResponse(id, -32600, "Invalid Request");
    if (isNotification) return null;

    if (method === "initialize") {
      return okResponse(id, {
        protocolVersion: negotiateProtocolVersion(message.params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "contextum", version: CONTEXTUM_VERSION },
      });
    }

    if (method === "ping") return okResponse(id, {});

    if (method === "tools/list") {
      return okResponse(id, { tools: listMcpTools() });
    }

    if (method === "tools/call") {
      return okResponse(id, await callTool(root, message.params ?? {}));
    }

    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    if (error instanceof ProtocolError) return errorResponse(id, error.code, error.message);
    return errorResponse(id, -32000, (error as Error).message);
  }
}

class ProtocolError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

function negotiateProtocolVersion(params: Record<string, unknown> | undefined): string {
  const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
  // Echo the client's version when we speak it, otherwise offer ours and let
  // the client decide whether it can continue.
  return requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION;
}

async function callTool(root: string, params: Record<string, unknown>): Promise<JsonValue> {
  const name = typeof params.name === "string" ? params.name : "";
  if (!name) throw new ProtocolError(-32602, "tools/call requires a tool name.");
  const args = isRecord(params.arguments) ? params.arguments : {};
  if (!KNOWN_TOOLS.has(name)) throw new ProtocolError(-32602, `Unknown tool: ${name}`);

  try {
    return await dispatchTool(root, name, args);
  } catch (error) {
    // Business-logic and validation failures are reported in-band so the model
    // can read them and self-correct, per the MCP tools specification.
    return toolError((error as Error).message);
  }
}

async function dispatchTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonValue> {
  if (name === "contextum.repo_status") return toolResult(await repoStatus(root));
  if (name === "contextum.list_context_files") return toolResult(await listContextFiles(root));
  if (name === "contextum.shared_memory_status") return toolResult(await sharedMemoryStatus(root));
  if (name === "contextum.search_context") return toolResult(await searchContext(root, args));
  if (name === "contextum.read_context") return toolResult(await readContext(root, args));
  if (name === "contextum.list_tasks") return toolResult(await readCenterJson(root, "tasks.json"));
  if (name === "contextum.list_agents") return toolResult(await readCenterJson(root, "agents.json"));
  if (name === "contextum.list_locks") return toolResult(await readCenterJson(root, "locks.json"));
  if (name === "contextum.list_events") return toolResult(await listEvents(root, args));
  if (name === "contextum.read_execution_state") return toolResult(await readCenterJson(root, "execution-state.json"));
  if (name === "contextum.create_task") return toolResult(await createTask(root, args));
  if (name === "contextum.claim_task") return toolResult(await claimTask(root, args));
  if (name === "contextum.update_task") return toolResult(await updateTask(root, args));
  if (name === "contextum.release_task") return toolResult(await releaseTask(root, args));
  if (name === "contextum.register_agent") return toolResult(await registerAgent(root, args));
  if (name === "contextum.acquire_lock") return toolResult(await acquireLock(root, args));
  if (name === "contextum.release_lock") return toolResult(await releaseLock(root, args));
  if (name === "contextum.record_handoff") return toolResult(await recordHandoff(root, args));
  if (name === "contextum.patch_execution_state") return toolResult(await patchExecutionState(root, args));

  throw new ProtocolError(-32602, `Unknown tool: ${name}`);
}

async function repoStatus(root: string): Promise<JsonValue> {
  const contextFiles = await listContextFiles(root);
  const centerPath = path.join(root, CENTER_DIR);
  const hasCenter = await fs.pathExists(centerPath);
  const project = hasCenter && await fs.pathExists(path.join(centerPath, "project.json"))
    ? await fs.readJson(path.join(centerPath, "project.json"))
    : null;
  return {
    root,
    project,
    has_agents_md: await fs.pathExists(path.join(root, CANONICAL_AGENT_FILE)),
    has_context_dir: await fs.pathExists(path.join(root, CONTEXT_DIR)),
    has_center: hasCenter,
    readable_context_files: contextFiles,
  };
}

async function sharedMemoryStatus(root: string): Promise<JsonValue> {
  const centerPath = path.join(root, CENTER_DIR);
  const mcpConfigPath = path.join(centerPath, "mcp.json");
  const projectPath = path.join(centerPath, "project.json");
  return {
    root,
    project: await readOptionalJson(projectPath),
    mcp_config: await readOptionalJson(mcpConfigPath),
    memory_model: {
      durable_repo_memory: [CANONICAL_AGENT_FILE, `${CONTEXT_DIR}/`],
      operational_memory: [
        `${CENTER_DIR}/tasks.json`,
        `${CENTER_DIR}/agents.json`,
        `${CENTER_DIR}/locks.json`,
        `${CENTER_DIR}/execution-state.json`,
        `${CENTER_DIR}/events.jsonl`,
      ],
      vector_ready_index: `${CONTEXT_DIR}/context-index.json`,
      access_rule: "Every Claude profile and MCP-capable Codex reviewer that should share project memory must connect to this same MCP server command for this repo.",
      recommended_workflow: "Claude authors, Codex reviews the diff, then the author fixes findings.",
    },
  };
}

async function searchContext(root: string, args: Record<string, unknown>): Promise<JsonValue> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("Missing required string: query");
  const limit = readLimit(args.limit);
  const queryTokens = new Set(tokenize(query));
  // One incidental word in a multi-word query is noise, not a match.
  const minimumHits = Math.min(2, queryTokens.size);
  const docs = await searchDocuments(root);

  const matches = docs
    .map((doc) => {
      const matched = matchedTerms(queryTokens, doc.text);
      return { ...doc, matched, score: matched.length };
    })
    .filter((doc) => doc.score >= minimumHits)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((doc) => ({
      path: doc.path,
      kind: doc.kind,
      score: doc.score,
      match_ratio: Number((doc.score / queryTokens.size).toFixed(2)),
      matched_terms: doc.matched,
      preview: doc.text.slice(0, 500),
    }));

  return { query, searched_terms: [...queryTokens], matches };
}

interface SearchDocument {
  path: string;
  kind: string;
  text: string;
}

async function searchDocuments(root: string): Promise<SearchDocument[]> {
  const docs: SearchDocument[] = [];
  for (const rel of await listContextFiles(root)) {
    const abs = path.join(root, rel);
    const text = await fs.readFile(abs, "utf8");
    docs.push({ path: rel, kind: "context_file", text });
  }

  const indexPath = path.join(root, CONTEXT_DIR, "context-index.json");
  if (await fs.pathExists(indexPath)) {
    const parsed = await fs.readJson(indexPath) as { documents?: Array<{ id?: unknown; text?: unknown; kind?: unknown }> };
    for (const doc of parsed.documents ?? []) {
      if (typeof doc.text === "string" && typeof doc.id === "string") {
        docs.push({ path: doc.id, kind: typeof doc.kind === "string" ? doc.kind : "index_document", text: doc.text });
      }
    }
  }
  return docs;
}

function matchedTerms(queryTokens: Set<string>, text: string): string[] {
  const textTokens = new Set(tokenize(text));
  return [...queryTokens].filter((token) => textTokens.has(token));
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null) return 5;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("limit must be an integer between 1 and 20");
  }
  return value;
}

async function readOptionalJson(file: string): Promise<JsonValue> {
  if (!(await fs.pathExists(file))) return null;
  return await fs.readJson(file);
}

async function listContextFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const rel of CONTEXT_FILES) {
    if (await fs.pathExists(path.join(root, rel))) found.push(rel);
  }
  return found;
}

async function readContext(root: string, args: Record<string, unknown>): Promise<JsonValue> {
  const rel = String(args.path ?? "");
  if (!CONTEXT_FILES.includes(rel)) {
    throw new Error(`Path is not readable through Contextum MCP: ${rel}`);
  }

  const abs = safeJoin(root, rel);
  if (!(await fs.pathExists(abs))) {
    throw new Error(`Context file does not exist: ${rel}`);
  }

  return {
    path: rel,
    text: await fs.readFile(abs, "utf8"),
  };
}

async function readCenterJson(root: string, file: string): Promise<JsonValue> {
  const abs = safeJoin(root, `${CENTER_DIR}/${file}`);
  if (!(await fs.pathExists(abs))) {
    return { schema: `contextum-${file.replace(".json", "")}/v1`, missing: true };
  }
  return await fs.readJson(abs);
}

function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(normalizedRoot)) {
    throw new Error(`Refusing to read outside repository root: ${rel}`);
  }
  return abs;
}

function toolError(message: string): JsonValue {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function toolResult(value: unknown): JsonValue {
  const jsonValue = toJsonValue(value);
  const text = typeof jsonValue === "string" ? jsonValue : JSON.stringify(jsonValue, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: jsonValue,
    isError: false,
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function objectSchema(
  properties: Record<string, JsonValue>,
  required: string[] = [],
): JsonValue {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function okResponse(id: string | number | null, result: JsonValue): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { withCenterLock, writeJsonAtomic } from "./centerLock.js";

export type TaskStatus = "open" | "claimed" | "blocked" | "review" | "done" | "cancelled";
export type Priority = "low" | "normal" | "high" | "critical";
export type AgentStatus = "active" | "idle" | "blocked" | "done";
export type LockScopeType = "path" | "context_area" | "task" | "other";
export type ExecutionStatus = "active" | "blocked" | "review" | "done";

export interface CenterTask {
  id: string;
  title: string;
  status: TaskStatus;
  owner_agent_id: string | null;
  role: string | null;
  priority: Priority;
  context_areas: string[];
  affected_paths: string[];
  acceptance_checks: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CenterAgent {
  id: string;
  tool: "claude" | "codex" | "cursor" | "copilot" | "gemini" | "human" | "other";
  profile: string | null;
  role: string;
  status: AgentStatus;
  current_task_id: string | null;
  worktree: string | null;
  started_at: string;
  last_seen_at: string;
}

export interface CenterLock {
  id: string;
  scope: string;
  scope_type: LockScopeType;
  owner_agent_id: string;
  task_id: string | null;
  reason: string;
  created_at: string;
  expires_at: string | null;
}

export interface ExecutionState {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  status: ExecutionStatus;
  phase: string | null;
  current_goal: string | null;
  latest_observation: string | null;
  facts: string[];
  decisions: string[];
  open_questions: string[];
  risks: string[];
  touched_paths: string[];
  next_actions: string[];
  updated_at: string;
}

export interface CenterEvent {
  id: string;
  type: string;
  task_id: string | null;
  agent_id: string | null;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

interface TasksFile {
  schema: "contextum-tasks/v1";
  tasks: CenterTask[];
}

interface AgentsFile {
  schema: "contextum-agents/v1";
  agents: CenterAgent[];
}

interface LocksFile {
  schema: "contextum-locks/v1";
  locks: CenterLock[];
}

interface ExecutionStateFile {
  schema: "contextum-execution-state/v1";
  states: ExecutionState[];
}

const CENTER_DIR = ".contextum";

const ARRAY_FIELDS = [
  "facts",
  "decisions",
  "open_questions",
  "risks",
  "touched_paths",
  "next_actions",
] as const;

type ArrayField = (typeof ARRAY_FIELDS)[number];

export async function createTask(root: string, args: Record<string, unknown>): Promise<CenterTask> {
  return mutate(root, async () => {
    const tasks = await readTasks(root);
    const now = timestamp();
    const task: CenterTask = {
      id: optionalString(args.id) ?? newId("task"),
      title: requiredString(args.title, "title"),
      status: "open",
      owner_agent_id: null,
      role: optionalString(args.role),
      priority: optionalPriority(args.priority) ?? "normal",
      context_areas: stringArray(args.context_areas),
      affected_paths: stringArray(args.affected_paths),
      acceptance_checks: stringArray(args.acceptance_checks),
      notes: optionalString(args.notes) ?? "",
      created_at: now,
      updated_at: now,
    };
    if (tasks.tasks.some((existing) => existing.id === task.id)) {
      throw new Error(`Task already exists: ${task.id}`);
    }
    tasks.tasks.push(task);
    await writeTasks(root, tasks);
    await appendEvent(root, "task.created", task.id, null, task.title, { task });
    return task;
  });
}

export async function claimTask(root: string, args: Record<string, unknown>): Promise<CenterTask> {
  return mutate(root, async () => {
    const taskId = requiredString(args.id ?? args.task_id, "task_id");
    const agentId = requiredString(args.agent_id, "agent_id");
    const tasks = await readTasks(root);
    const task = findTask(tasks, taskId);

    if (task.status === "done" || task.status === "cancelled") {
      throw new Error(`Cannot claim ${task.status} task: ${taskId}`);
    }
    if (task.owner_agent_id && task.owner_agent_id !== agentId) {
      throw new Error(`Task ${taskId} is already claimed by ${task.owner_agent_id}`);
    }

    task.status = "claimed";
    task.owner_agent_id = agentId;
    task.updated_at = timestamp();
    await writeTasks(root, tasks);
    await appendEvent(root, "task.claimed", task.id, agentId, `Task claimed: ${task.title}`, {});
    return task;
  });
}

export async function releaseTask(root: string, args: Record<string, unknown>): Promise<CenterTask> {
  return mutate(root, async () => {
    const taskId = requiredString(args.id ?? args.task_id, "task_id");
    const agentId = optionalString(args.agent_id);
    const tasks = await readTasks(root);
    const task = findTask(tasks, taskId);

    assertTaskOwnership(task, agentId);

    task.status = "open";
    task.owner_agent_id = null;
    task.updated_at = timestamp();
    await writeTasks(root, tasks);
    await appendEvent(root, "task.released", task.id, agentId ?? null, `Task released: ${task.title}`, {});
    return task;
  });
}

/**
 * Move a task through the review lifecycle. Without this, `done`, `review`,
 * `blocked`, and `cancelled` are unreachable and the author -> reviewer ->
 * fixes flow cannot be represented in the store.
 */
export async function updateTask(root: string, args: Record<string, unknown>): Promise<CenterTask> {
  return mutate(root, async () => {
    const taskId = requiredString(args.id ?? args.task_id, "task_id");
    const agentId = optionalString(args.agent_id);
    const tasks = await readTasks(root);
    const task = findTask(tasks, taskId);

    assertTaskOwnership(task, agentId);

    const status = optionalTaskStatus(args.status);
    if (status) task.status = status;
    if ("priority" in args) task.priority = optionalPriority(args.priority) ?? task.priority;
    if ("role" in args) task.role = optionalString(args.role);
    if ("notes" in args) task.notes = optionalString(args.notes) ?? "";
    if ("context_areas" in args) task.context_areas = stringArray(args.context_areas);
    if ("affected_paths" in args) task.affected_paths = stringArray(args.affected_paths);
    if ("acceptance_checks" in args) task.acceptance_checks = stringArray(args.acceptance_checks);
    if (status === "done" || status === "cancelled") task.owner_agent_id = null;
    task.updated_at = timestamp();

    await writeTasks(root, tasks);
    const eventType = status === "done" ? "task.completed" : status === "review" ? "review.recorded" : "task.updated";
    await appendEvent(root, eventType, task.id, agentId, `Task ${task.status}: ${task.title}`, {
      status: task.status,
    });
    return task;
  });
}

export async function registerAgent(root: string, args: Record<string, unknown>): Promise<CenterAgent> {
  return mutate(root, async () => {
    const agents = await readAgents(root);
    const now = timestamp();
    const id = optionalString(args.id) ?? newId("agent");
    const existing = agents.agents.find((candidate) => candidate.id === id);

    // A heartbeat sends only `id`. Merging instead of replacing keeps the
    // session registry (tool, profile, role, worktree, current task) intact.
    const base: CenterAgent = existing ?? {
      id,
      tool: "other",
      profile: null,
      role: "agent",
      status: "active",
      current_task_id: null,
      worktree: null,
      started_at: now,
      last_seen_at: now,
    };

    const agent: CenterAgent = {
      ...base,
      tool: "tool" in args ? optionalTool(args.tool) ?? base.tool : base.tool,
      profile: "profile" in args ? optionalString(args.profile) : base.profile,
      role: "role" in args ? optionalString(args.role) ?? base.role : base.role,
      status: "status" in args ? optionalAgentStatus(args.status) ?? base.status : base.status,
      current_task_id: "current_task_id" in args ? optionalString(args.current_task_id) : base.current_task_id,
      worktree: "worktree" in args ? optionalString(args.worktree) : base.worktree,
      last_seen_at: now,
    };

    if (existing) {
      agents.agents[agents.agents.indexOf(existing)] = agent;
    } else {
      agents.agents.push(agent);
    }

    await writeAgents(root, agents);
    await appendEvent(root, "agent.registered", agent.current_task_id, agent.id, `Agent registered: ${agent.id}`, {
      agent,
    });
    return agent;
  });
}

export async function acquireLock(root: string, args: Record<string, unknown>): Promise<CenterLock> {
  return mutate(root, async () => {
    const locks = await readLocks(root);
    const now = timestamp();
    locks.locks = locks.locks.filter((lock) => !isExpired(lock, now));

    const scope = requiredString(args.scope, "scope");
    const ownerAgentId = requiredString(args.owner_agent_id ?? args.agent_id, "owner_agent_id");
    const existing = locks.locks.find((lock) => lock.scope === scope);
    if (existing && existing.owner_agent_id !== ownerAgentId) {
      throw new Error(`Lock ${scope} is already held by ${existing.owner_agent_id}`);
    }
    if (existing) return existing;

    const ttlSeconds = optionalNumber(args.ttl_seconds);
    const lock: CenterLock = {
      id: optionalString(args.id) ?? newId("lock"),
      scope,
      scope_type: optionalScopeType(args.scope_type) ?? "path",
      owner_agent_id: ownerAgentId,
      task_id: optionalString(args.task_id),
      reason: optionalString(args.reason) ?? "",
      created_at: now,
      expires_at: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null,
    };

    locks.locks.push(lock);
    await writeLocks(root, locks);
    await appendEvent(root, "lock.acquired", lock.task_id, lock.owner_agent_id, `Lock acquired: ${lock.scope}`, { lock });
    return lock;
  });
}

export async function releaseLock(root: string, args: Record<string, unknown>): Promise<CenterLock> {
  return mutate(root, async () => {
    const locks = await readLocks(root);
    const id = optionalString(args.id);
    const scope = optionalString(args.scope);
    const ownerAgentId = optionalString(args.owner_agent_id ?? args.agent_id);
    if (!id && !scope) throw new Error("Provide lock id or scope.");

    const index = locks.locks.findIndex((lock) => (id ? lock.id === id : lock.scope === scope));
    if (index === -1) throw new Error(`Lock not found: ${id ?? scope}`);

    const lock = locks.locks[index]!;
    if (ownerAgentId && lock.owner_agent_id !== ownerAgentId) {
      throw new Error(`Lock ${lock.id} is owned by ${lock.owner_agent_id}, not ${ownerAgentId}`);
    }

    locks.locks.splice(index, 1);
    await writeLocks(root, locks);
    await appendEvent(root, "lock.released", lock.task_id, ownerAgentId ?? lock.owner_agent_id, `Lock released: ${lock.scope}`, { lock });
    return lock;
  });
}

export async function recordHandoff(root: string, args: Record<string, unknown>): Promise<CenterEvent> {
  return mutate(root, async () => {
    const message = requiredString(args.message, "message");
    return appendEvent(
      root,
      "handoff.recorded",
      optionalString(args.task_id),
      optionalString(args.from_agent_id ?? args.agent_id),
      message,
      {
        from_agent_id: optionalString(args.from_agent_id),
        to_agent_id: optionalString(args.to_agent_id),
      },
    );
  });
}

export interface ListEventsResult {
  schema: "contextum-events/v1";
  total: number;
  returned: number;
  events: CenterEvent[];
}

/**
 * Handoffs are only useful if the receiving agent can read them back.
 */
export async function listEvents(root: string, args: Record<string, unknown>): Promise<ListEventsResult> {
  await assertCenter(root);
  const file = path.join(root, CENTER_DIR, "events.jsonl");
  const limit = boundedInteger(args.limit, 20, 1, 200);
  const type = optionalString(args.type);
  const taskId = optionalString(args.task_id);
  const agentId = optionalString(args.agent_id);

  const raw = (await fs.pathExists(file)) ? await fs.readFile(file, "utf8") : "";
  const events: CenterEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as CenterEvent);
    } catch {
      // A truncated trailing line should not hide the rest of the history.
    }
  }

  const filtered = events.filter((event) =>
    (!type || event.type === type) &&
    (!taskId || event.task_id === taskId) &&
    (!agentId || event.agent_id === agentId));

  return {
    schema: "contextum-events/v1",
    total: filtered.length,
    returned: Math.min(filtered.length, limit),
    events: filtered.slice(-limit),
  };
}

export async function patchExecutionState(root: string, args: Record<string, unknown>): Promise<ExecutionState> {
  return mutate(root, async () => {
    const states = await readExecutionStates(root);
    const id = requiredString(args.id, "id");
    const patch = isRecord(args.patch) ? args.patch : args;
    const now = timestamp();
    let state = states.states.find((candidate) => candidate.id === id);

    if (!state) {
      state = emptyState(id, now);
      states.states.push(state);
    }

    applyExecutionPatch(state, patch, now);
    await writeExecutionStates(root, states);
    await appendEvent(root, "note.added", state.task_id, state.agent_id, `Execution state patched: ${state.id}`, {
      state_id: state.id,
    });
    return state;
  });
}

async function mutate<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await assertCenter(root);
  return withCenterLock(path.join(root, CENTER_DIR), fn);
}

async function assertCenter(root: string): Promise<void> {
  if (!(await fs.pathExists(path.join(root, CENTER_DIR)))) {
    throw new Error("Missing .contextum. Run `contextum center init` first.");
  }
}

function assertTaskOwnership(task: CenterTask, agentId: string | null): void {
  if (agentId && task.owner_agent_id && task.owner_agent_id !== agentId) {
    throw new Error(`Task ${task.id} is owned by ${task.owner_agent_id}, not ${agentId}`);
  }
}

async function readTasks(root: string): Promise<TasksFile> {
  return readJson(root, "tasks.json", { schema: "contextum-tasks/v1", tasks: [] });
}

async function writeTasks(root: string, value: TasksFile): Promise<void> {
  await writeJson(root, "tasks.json", value);
}

async function readAgents(root: string): Promise<AgentsFile> {
  return readJson(root, "agents.json", { schema: "contextum-agents/v1", agents: [] });
}

async function writeAgents(root: string, value: AgentsFile): Promise<void> {
  await writeJson(root, "agents.json", value);
}

async function readLocks(root: string): Promise<LocksFile> {
  return readJson(root, "locks.json", { schema: "contextum-locks/v1", locks: [] });
}

async function writeLocks(root: string, value: LocksFile): Promise<void> {
  await writeJson(root, "locks.json", value);
}

async function readExecutionStates(root: string): Promise<ExecutionStateFile> {
  return readJson(root, "execution-state.json", { schema: "contextum-execution-state/v1", states: [] });
}

async function writeExecutionStates(root: string, value: ExecutionStateFile): Promise<void> {
  await writeJson(root, "execution-state.json", value);
}

async function readJson<T>(root: string, file: string, fallback: T): Promise<T> {
  const abs = path.join(root, CENTER_DIR, file);
  if (!(await fs.pathExists(abs))) return fallback;
  try {
    return await fs.readJson(abs) as T;
  } catch (error) {
    throw new Error(
      `${CENTER_DIR}/${file} is not valid JSON (${(error as Error).message}). ` +
        "Restore it from Git or reset it with `contextum center init --force`.",
    );
  }
}

async function writeJson(root: string, file: string, value: unknown): Promise<void> {
  await writeJsonAtomic(path.join(root, CENTER_DIR, file), value);
}

async function appendEvent(
  root: string,
  type: string,
  taskId: string | null,
  agentId: string | null,
  message: string,
  data: Record<string, unknown>,
): Promise<CenterEvent> {
  const event: CenterEvent = {
    id: newId("evt"),
    type,
    task_id: taskId,
    agent_id: agentId,
    message,
    data,
    created_at: timestamp(),
  };
  await fs.appendFile(path.join(root, CENTER_DIR, "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
  return event;
}

function findTask(tasks: TasksFile, id: string): CenterTask {
  const task = tasks.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

function emptyState(id: string, now: string): ExecutionState {
  return {
    id,
    task_id: null,
    agent_id: null,
    status: "active",
    phase: null,
    current_goal: null,
    latest_observation: null,
    facts: [],
    decisions: [],
    open_questions: [],
    risks: [],
    touched_paths: [],
    next_actions: [],
    updated_at: now,
  };
}

function applyExecutionPatch(
  state: ExecutionState,
  patch: Record<string, unknown>,
  now: string,
): void {
  const stringFields = ["task_id", "agent_id", "phase", "current_goal", "latest_observation"] as const;

  for (const field of stringFields) {
    if (field in patch) state[field] = optionalString(patch[field]);
  }

  for (const field of ARRAY_FIELDS) {
    // `<field>` replaces the list; `<field>_add` appends to it, so an agent can
    // record one new fact without resending everything it already knows.
    if (field in patch) state[field] = stringArray(patch[field]);
    const addKey = `${field}_add` satisfies `${ArrayField}_add`;
    if (addKey in patch) {
      state[field] = dedupe([...state[field], ...stringArray(patch[addKey])]);
    }
  }

  if ("status" in patch) state.status = optionalExecutionStatus(patch.status) ?? state.status;
  state.updated_at = now;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isExpired(lock: CenterLock, now: string): boolean {
  return Boolean(lock.expires_at && lock.expires_at <= now);
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function requiredString(value: unknown, name: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Missing required string: ${name}`);
  return parsed;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Expected string value.");
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Expected string array.");
  return value.map((item) => requiredString(item, "array item"));
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Expected positive number.");
  }
  return value;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return value;
}

function optionalPriority(value: unknown): Priority | null {
  if (value === undefined || value === null) return null;
  if (value === "low" || value === "normal" || value === "high" || value === "critical") return value;
  throw new Error(`Unsupported priority: ${String(value)}`);
}

function optionalTaskStatus(value: unknown): TaskStatus | null {
  if (value === undefined || value === null) return null;
  if (
    value === "open" || value === "claimed" || value === "blocked" ||
    value === "review" || value === "done" || value === "cancelled"
  ) return value;
  throw new Error(`Unsupported task status: ${String(value)}`);
}

function optionalTool(value: unknown): CenterAgent["tool"] | null {
  if (value === undefined || value === null) return null;
  if (
    value === "claude" || value === "codex" || value === "cursor" ||
    value === "copilot" || value === "gemini" || value === "human" || value === "other"
  ) return value;
  throw new Error(`Unsupported agent tool: ${String(value)}`);
}

function optionalAgentStatus(value: unknown): AgentStatus | null {
  if (value === undefined || value === null) return null;
  if (value === "active" || value === "idle" || value === "blocked" || value === "done") return value;
  throw new Error(`Unsupported agent status: ${String(value)}`);
}

function optionalScopeType(value: unknown): LockScopeType | null {
  if (value === undefined || value === null) return null;
  if (value === "path" || value === "context_area" || value === "task" || value === "other") return value;
  throw new Error(`Unsupported lock scope type: ${String(value)}`);
}

function optionalExecutionStatus(value: unknown): ExecutionStatus | null {
  if (value === undefined || value === null) return null;
  if (value === "active" || value === "blocked" || value === "review" || value === "done") return value;
  throw new Error(`Unsupported execution status: ${String(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

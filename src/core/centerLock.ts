import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";

/**
 * Cross-process mutual exclusion for the .contextum store.
 *
 * Multiple agents (two Claude profiles, a Codex reviewer, CI) run separate
 * processes against the same repository, so read-modify-write cycles must be
 * serialized. `fs.mkdir` is atomic on Linux, macOS, and Windows, which makes a
 * lock directory the portable primitive here.
 */

const LOCK_DIR = ".lock";
const OWNER_FILE = "owner.json";

export interface LockOptions {
  /** Give up after this long instead of blocking an agent forever. */
  timeoutMs?: number;
  /** Treat a lock older than this as abandoned by a crashed process. */
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;

/**
 * Same-process callers queue in memory instead of spinning on the filesystem;
 * the directory lock then only has to arbitrate between processes.
 */
const inProcessQueues = new Map<string, Promise<unknown>>();

export async function withCenterLock<T>(
  centerDir: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const key = path.resolve(centerDir);
  const previous = inProcessQueues.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => withFileLock(centerDir, fn, options));
  inProcessQueues.set(key, run);
  try {
    return await run;
  } finally {
    if (inProcessQueues.get(key) === run) inProcessQueues.delete(key);
  }
}

async function withFileLock<T>(
  centerDir: string,
  fn: () => Promise<T>,
  options: LockOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockPath = path.join(centerDir, LOCK_DIR);
  const token = await acquire(lockPath, timeoutMs, staleMs);

  try {
    return await fn();
  } finally {
    await release(lockPath, token);
  }
}

async function acquire(lockPath: string, timeoutMs: number, staleMs: number): Promise<string> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + timeoutMs;
  let delay = 5;

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, OWNER_FILE),
        JSON.stringify({ token, pid: process.pid, acquired_at: new Date().toISOString() }),
        "utf8",
      );
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await breakIfStale(lockPath, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the Contextum center lock at ${lockPath}. ` +
            "Another agent may be mid-write; remove the directory only if no agent is running.",
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 100);
    }
  }
}

async function breakIfStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs < staleMs) return false;
    await fs.remove(lockPath);
    return true;
  } catch {
    // The lock disappeared underneath us; the next mkdir attempt decides.
    return true;
  }
}

async function release(lockPath: string, token: string): Promise<void> {
  try {
    const owner = await fs.readJson(path.join(lockPath, OWNER_FILE)) as { token?: string };
    // A stale-breaker may have handed the lock to someone else already.
    if (owner.token !== token) return;
  } catch {
    // No owner file: still ours to clean up.
  }
  await fs.remove(lockPath).catch(() => undefined);
}

/**
 * Replace a file in one step so readers never observe a partially written
 * document, and a crash mid-write cannot truncate the store.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.ensureDir(path.dirname(file));
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.remove(tmp).catch(() => undefined);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

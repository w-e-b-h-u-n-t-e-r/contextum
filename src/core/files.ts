import path from "node:path";
import fs from "fs-extra";

export type WriteStatus = "created" | "updated" | "skipped";

export interface WriteResult {
  rel: string;
  status: WriteStatus;
}

export interface WriteOptions {
  root: string;
  force?: boolean;
}

export async function writeFile(
  rel: string,
  content: string,
  { root, force }: WriteOptions,
): Promise<WriteResult> {
  const abs = path.join(root, rel);
  const existed = await fs.pathExists(abs);

  if (existed && !force) {
    return { rel, status: "skipped" };
  }

  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, normalizeEol(content), "utf8");

  return { rel, status: existed ? "updated" : "created" };
}

export function readFile(rel: string, root: string): Promise<string> {
  return fs.readFile(path.join(root, rel), "utf8");
}

export function exists(rel: string, root: string): Promise<boolean> {
  return fs.pathExists(path.join(root, rel));
}

function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
}

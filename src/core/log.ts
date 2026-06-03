import pc from "picocolors";
import type { WriteResult, WriteStatus } from "./files.js";

export const log = {
  title: (s: string) => console.log("\n" + pc.bold(pc.cyan(s))),
  info: (s: string) => console.log(s),
  dim: (s: string) => console.log(pc.dim(s)),
  ok: (s: string) => console.log(pc.green("✓ ") + s),
  warn: (s: string) => console.log(pc.yellow("! ") + s),
  err: (s: string) => console.error(pc.red("✗ ") + s),
  step: (s: string) => console.log(pc.bold("• ") + s),
};

const STATUS_STYLE: Record<WriteStatus, (s: string) => string> = {
  created: pc.green,
  updated: pc.yellow,
  skipped: pc.dim,
};

export function reportWrites(results: WriteResult[]): void {
  for (const result of results) {
    const label = STATUS_STYLE[result.status](result.status.padEnd(7));
    console.log(`  ${label} ${result.rel}`);
  }

  const counts = results.reduce<Record<WriteStatus, number>>(
    (acc, result) => {
      acc[result.status] += 1;
      return acc;
    },
    { created: 0, updated: 0, skipped: 0 },
  );

  log.dim(
    `  → ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped`,
  );
}
